import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { User, IUser } from './user.model';
import { getRedisClient, isRedisAvailable } from '../../config/redis';
import { signAccessToken } from '../../utils/jwt';
import { createError } from '../../middleware/errorHandler';
import { emailService } from '../../services/email.service';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 64;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;        // 1 hour

/**
 * Upper bound on concurrent sessions retained per account.
 * Every login pushes a record and only the consumed one is pulled on refresh,
 * so without a cap the array grew forever.
 */
const MAX_ACTIVE_SESSIONS = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRawRefreshToken(userId: string): string {
  const random = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  return `${userId}.${random}`;
}

/**
 * Refresh tokens carry 512 bits of CSPRNG entropy, so they are not guessable and
 * gain nothing from a slow KDF. They were previously bcrypt-hashed, which forced
 * an O(n) sequential compare (~250ms each) on every /auth/refresh — a
 * single-account DoS. A SHA-256 digest allows an exact-match lookup instead.
 */
function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Records written before the SHA-256 migration are bcrypt hashes ($2a$/$2b$/$2y$). */
function isLegacyBcryptHash(hash: string): boolean {
  return hash.startsWith('$2');
}

/** Constant-time comparison of two same-length hex digests. */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function redisRefreshKey(userId: string, tokenHash: string): string {
  return `refresh:${userId}:${tokenHash}`;
}

async function storeRefreshToken(userId: string, rawToken: string): Promise<void> {
  const hash = hashRefreshToken(rawToken);

  // Always persist to MongoDB (source of truth).
  // $slice keeps only the most recent MAX_ACTIVE_SESSIONS records, so a user who
  // never logs out cannot grow this array without bound.
  await User.updateOne(
    { _id: userId },
    {
      $push: {
        refreshTokens: {
          $each: [{
            token: hash,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
          }],
          $slice: -MAX_ACTIVE_SESSIONS,
        },
      },
    }
  );

  // Redis is optional — skip silently if unavailable
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      await redis.set(redisRefreshKey(userId, hash), '1', 'EX', REFRESH_TOKEN_TTL_SECONDS);
    } catch {
      // Redis write failed — DB record is sufficient
    }
  }
}

async function revokeStoredToken(userId: string, storedHash: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    { $pull: { refreshTokens: { token: storedHash } } }
  );
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      await redis.del(redisRefreshKey(userId, storedHash));
    } catch {
      // Redis delete failed — DB removal is sufficient
    }
  }
}

async function findAndInvalidateRefreshToken(
  userId: string,
  rawToken: string
): Promise<boolean> {
  const user = await User.findById(userId).select('+refreshTokens');
  if (!user) return false;

  const now = new Date();

  // `expiresAt` was previously written and never read, so a token remained valid
  // indefinitely. Expired records are now excluded from matching AND purged.
  const live = user.refreshTokens.filter((t) => t.expiresAt > now);
  if (live.length !== user.refreshTokens.length) {
    await User.updateOne(
      { _id: userId },
      { $pull: { refreshTokens: { expiresAt: { $lte: now } } } }
    );
  }

  // Fast path — current SHA-256 records, exact match, no KDF cost.
  const candidateHash = hashRefreshToken(rawToken);
  const direct = live.find(
    (t) => !isLegacyBcryptHash(t.token) && digestsMatch(t.token, candidateHash)
  );
  if (direct) {
    await revokeStoredToken(userId, direct.token);
    return true;
  }

  // Compatibility path — sessions issued before the migration. Bounded by both
  // the expiry filter above and MAX_ACTIVE_SESSIONS, and disappears naturally as
  // old tokens rotate or expire.
  for (const stored of live) {
    if (!isLegacyBcryptHash(stored.token)) continue;
    if (await bcrypt.compare(rawToken, stored.token)) {
      await revokeStoredToken(userId, stored.token);
      return true;
    }
  }

  return false;
}

/**
 * Generates a refresh token, persists it, and returns the raw value.
 * Exported so other modules (e.g. onboarding) reuse this instead of
 * re-implementing token creation with a different hash format.
 */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = generateRawRefreshToken(userId);
  await storeRefreshToken(userId, raw);
  return raw;
}

// ── Service methods ───────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export async function register(
  storeId: string,
  email: string,
  password: string
): Promise<{ user: IUser; tokens: AuthTokens }> {
  const existing = await User.findOne({
    storeId: new Types.ObjectId(storeId),
    email: email.toLowerCase(),
  });
  if (existing) {
    throw createError('Email is already registered', 409, 'CONFLICT');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({
    storeId: new Types.ObjectId(storeId),
    email,
    passwordHash,
    role: 'customer',
  });

  const userId = (user._id as Types.ObjectId).toString();
  const accessToken = signAccessToken(user._id as Types.ObjectId, user.role, storeId);
  const rawRefresh = generateRawRefreshToken(userId);
  await storeRefreshToken(userId, rawRefresh);

  emailService.sendWelcomeEmail(storeId, user.email);

  return { user, tokens: { accessToken, refreshToken: rawRefresh } };
}

/** Issues a session for an already-authenticated account. */
async function issueSession(user: IUser): Promise<{ user: IUser; tokens: AuthTokens }> {
  const userId = (user._id as Types.ObjectId).toString();
  const accessToken = signAccessToken(
    user._id as Types.ObjectId,
    user.role,
    user.storeId.toString()
  );
  const rawRefresh = generateRawRefreshToken(userId);
  await storeRefreshToken(userId, rawRefresh);

  return { user, tokens: { accessToken, refreshToken: rawRefresh } };
}

/**
 * Storefront sign-in. Resolves within ONE store and nowhere else.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * Login used to fall back through a chain of GLOBAL by-email lookups: any
 * super-admin, then any admin, then the oldest account of any role. Combined
 * with a route-mounting bug that meant `req.store` was never populated (see
 * auth.tenant.routes.ts), that chain ran for every login in the system.
 *
 * Two things followed, both proven in `login-tenant-scope.integration.test.ts`:
 *
 *   • A shopper's password on store A could authenticate an ADMIN account
 *     belonging to store B — one compromised credential crossing tenants.
 *   • More often, a customer whose address collided with any older or more
 *     privileged account could not sign in to their own store AT ALL, because
 *     only the other account's hash was ever compared.
 *
 * The unique index is `{ storeId, email }`, so one address legitimately holds
 * separate accounts in separate stores. This function now honours that: the
 * store decides which account, full stop. Merchants and operators sign in
 * through `platformLogin` instead.
 */
export async function login(
  storeId: string,
  email: string,
  password: string
): Promise<{ user: IUser; tokens: AuthTokens }> {
  if (!storeId || !Types.ObjectId.isValid(storeId)) {
    // Refusing beats guessing. Resolving a store-less login globally is the
    // exact behaviour that produced the cross-tenant escalation.
    throw createError('Store context is required to sign in', 400, 'BAD_REQUEST');
  }

  const user = (await User.findOne({
    storeId: new Types.ObjectId(storeId),
    email: email.toLowerCase(),
  }).select('+passwordHash')) as IUser | null;

  // Deliberately identical failures for "no such account here" and "wrong
  // password" — distinguishing them turns the endpoint into a per-store
  // membership oracle.
  if (!user) {
    throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
  }
  if (!user.isActive) {
    throw createError('Account is deactivated', 401, 'UNAUTHORIZED');
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
  }

  return issueSession(user);
}

/**
 * Upper bound on accounts examined during a platform sign-in.
 *
 * Each candidate costs one bcrypt comparison (~250 ms at 12 rounds), so an
 * address with many rows would otherwise be a cheap way to tie up a worker.
 * In a healthy dataset this is 1; more than that means duplicate admin rows,
 * which `repair:owners` consolidates.
 */
const MAX_PLATFORM_CANDIDATES = 5;

/**
 * Platform sign-in for merchants and platform operators.
 *
 * Store-independent by design: a merchant may own several stores, and which one
 * they are managing is chosen afterwards in the store switcher rather than by
 * whichever URL they happened to open. Customers never authenticate here —
 * only `admin` and `super-admin` accounts are considered.
 *
 * ── Resolving duplicates ──────────────────────────────────────────────────────
 * Historically a repeat signup could mint several admin rows for one address
 * (the unique index is per-store), so candidates are ranked deterministically:
 * super-admin first, then admins that actually OWN a store, then oldest.
 *
 * Ranking alone is not enough, though. Those duplicates may carry DIFFERENT
 * password hashes, and picking one row then rejecting a valid password would
 * lock a merchant out of their own account. So candidates are tried in order
 * and the one whose password matches wins — bounded by MAX_PLATFORM_CANDIDATES.
 */
export async function platformLogin(
  email: string,
  password: string
): Promise<{ user: IUser; tokens: AuthTokens }> {
  const candidates = (await User.find({
    email: email.toLowerCase(),
    role: { $in: ['super-admin', 'admin'] },
  })
    .select('+passwordHash')
    .sort({ createdAt: 1 })
    .limit(MAX_PLATFORM_CANDIDATES)) as IUser[];

  if (candidates.length === 0) {
    throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
  }

  // Which candidates own a store — preferred, because that is the account the
  // store switcher and every ownership check will resolve against.
  const { Store } = await import('../stores/store.model');
  const ownerIds = new Set(
    (
      await Store.find({ ownerId: { $in: candidates.map((c) => c._id) } })
        .select('ownerId')
        .lean()
    ).map((s) => s.ownerId.toString())
  );

  const ranked = [...candidates].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'super-admin' ? -1 : 1;
    const aOwns = ownerIds.has((a._id as Types.ObjectId).toString());
    const bOwns = ownerIds.has((b._id as Types.ObjectId).toString());
    if (aOwns !== bOwns) return aOwns ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  for (const candidate of ranked) {
    if (!(await bcrypt.compare(password, candidate.passwordHash))) continue;

    // Checked only AFTER the password matches, so a deactivated account cannot
    // be distinguished from a non-existent one without the correct credential.
    if (!candidate.isActive) {
      throw createError('Account is deactivated', 401, 'UNAUTHORIZED');
    }
    return issueSession(candidate);
  }

  throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
}

export async function refresh(rawRefreshToken: string): Promise<AuthTokens> {
  const [userIdHex, ...rest] = rawRefreshToken.split('.');
  const randomPart = rest.join('.');

  if (!userIdHex || !randomPart) {
    throw createError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  const user = await User.findById(userIdHex).select('+refreshTokens');
  if (!user || !user.isActive) {
    throw createError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  const invalidated = await findAndInvalidateRefreshToken(userIdHex, rawRefreshToken);
  if (!invalidated) {
    throw createError('Invalid or expired refresh token', 401, 'UNAUTHORIZED');
  }

  const accessToken = signAccessToken(user._id as Types.ObjectId, user.role, user.storeId.toString());
  const newRawRefresh = generateRawRefreshToken(userIdHex);
  await storeRefreshToken(userIdHex, newRawRefresh);

  return { accessToken, refreshToken: newRawRefresh };
}

export async function logout(userId: string, rawRefreshToken: string): Promise<void> {
  await findAndInvalidateRefreshToken(userId, rawRefreshToken);
}

export async function forgotPassword(storeId: string, email: string): Promise<string | null> {
  const user = await User.findOne({
    storeId: new Types.ObjectId(storeId),
    email: email.toLowerCase(),
  });
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  await User.updateOne(
    { _id: user._id },
    {
      passwordResetToken: hashedToken,
      passwordResetExpires: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
    }
  );

  emailService.sendPasswordResetEmail(storeId, user.email, rawToken);

  return rawToken;
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  });

  if (!user) {
    throw createError('Reset token is invalid or has expired', 400, 'BAD_REQUEST');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash, refreshTokens: [] },
      $unset: { passwordResetToken: '', passwordResetExpires: '' },
    }
  );
}
