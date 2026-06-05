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

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRawRefreshToken(userId: string): string {
  const random = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  return `${userId}.${random}`;
}

function redisRefreshKey(userId: string, tokenHash: string): string {
  return `refresh:${userId}:${tokenHash}`;
}

async function storeRefreshToken(userId: string, rawToken: string): Promise<void> {
  const hash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

  // Always persist to MongoDB (source of truth)
  await User.updateOne(
    { _id: userId },
    {
      $push: {
        refreshTokens: {
          token: hash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
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

async function findAndInvalidateRefreshToken(
  userId: string,
  rawToken: string
): Promise<boolean> {
  const user = await User.findById(userId).select('+refreshTokens');
  if (!user) return false;

  for (const stored of user.refreshTokens) {
    const match = await bcrypt.compare(rawToken, stored.token);
    if (match) {
      // Remove from DB
      await User.updateOne(
        { _id: userId },
        { $pull: { refreshTokens: { token: stored.token } } }
      );
      // Remove from Redis if available
      if (isRedisAvailable()) {
        try {
          const redis = getRedisClient();
          await redis.del(redisRefreshKey(userId, stored.token));
        } catch {
          // Redis delete failed — DB removal is sufficient
        }
      }
      return true;
    }
  }
  return false;
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
  } else {
    // Global lookup — find the admin user with this email across all stores.
    // Prefer admin role so store owners can always log in without knowing their store ID.
    user = await User.findOne({
      email: email.toLowerCase(),
      role: 'admin',
    }).select('+passwordHash').sort({ createdAt: 1 }) as IUser | null;

    // Fallback: any role
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
