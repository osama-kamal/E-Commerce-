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

export async function login(
  storeId: string | null,
  email: string,
  password: string
): Promise<{ user: IUser; tokens: AuthTokens }> {
  let user: IUser | null = null;

  if (storeId) {
    // Store-scoped lookup (normal flow when X-Store-ID is present)
    user = await User.findOne({
      storeId: new Types.ObjectId(storeId),
      email: email.toLowerCase(),
    }).select('+passwordHash') as IUser | null;

    // If the store-scoped user is a customer (or lower-privileged), check whether
    // this email has a higher-privileged account (super-admin or admin) in any store.
    // Privilege order: super-admin > admin > customer.
    if (user?.role === 'customer') {
      const privilegedUser = await User.findOne({
        email: email.toLowerCase(),
        role: { $in: ['super-admin', 'admin'] },
      }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;

      if (privilegedUser) {
        const valid = await bcrypt.compare(password, privilegedUser.passwordHash);
        if (valid) user = privilegedUser;
      }
    }

    // If no store-scoped user found at all, fall back to global privileged lookup
    if (!user) {
      user = await User.findOne({
        email: email.toLowerCase(),
        role: { $in: ['super-admin', 'admin'] },
      }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;
    }
  } else {
    // Global lookup — prefer highest privilege level.
    // super-admin > admin > customer
    user = await User.findOne({
      email: email.toLowerCase(),
      role: 'super-admin',
    }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;

    if (!user) {
      user = await User.findOne({
        email: email.toLowerCase(),
        role: 'admin',
      }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;
    }

    // Fallback: any role (e.g. customer logging in from main site)
    if (!user) {
      user = await User.findOne({
        email: email.toLowerCase(),
      }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;
    }
  }

  if (!user) {
    throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
  }

  if (!user.isActive) {
    throw createError('Account is deactivated', 401, 'UNAUTHORIZED');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw createError('Invalid email or password', 401, 'UNAUTHORIZED');
  }

  const userId = (user._id as Types.ObjectId).toString();
  const resolvedStoreId = user.storeId.toString();
  const accessToken = signAccessToken(user._id as Types.ObjectId, user.role, resolvedStoreId);
  const rawRefresh = generateRawRefreshToken(userId);
  await storeRefreshToken(userId, rawRefresh);

  return { user, tokens: { accessToken, refreshToken: rawRefresh } };
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
