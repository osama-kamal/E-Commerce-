import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { Store } from '../stores/store.model';
import { User } from '../auth/user.model';
import { signAccessToken } from '../../utils/jwt';
import { issueRefreshToken } from '../auth/auth.service';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { emailService } from '../../services/email.service';

const BCRYPT_ROUNDS = 12;

export interface OnboardingInput {
  fullName: string;
  email: string;
  password: string;
  storeName: string;
  storeCategory: string;
  storeSlug?: string;
}

export interface OnboardingResult {
  store: {
    _id: string;
    name: string;
    slug: string;
    subscriptionPlan: string;
  };
  user: {
    _id: string;
    email: string;
    fullName: string;
    role: string;
  };
  accessToken: string;
  refreshToken: string;
}

/**
 * Generates a URL-safe slug from a store name.
 * e.g. "My Fashion Store!" → "my-fashion-store"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

/**
 * Ensures the slug is unique by appending a numeric suffix if needed.
 */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let attempt = 0;
  while (await Store.findOne({ slug: candidate })) {
    attempt++;
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

export async function onboardStore(input: OnboardingInput): Promise<OnboardingResult> {
  const { fullName, email, password, storeName, storeCategory, storeSlug } = input;

  // ── Derive slug ────────────────────────────────────────────────────────────
  const baseSlug = storeSlug ? storeSlug.toLowerCase() : slugify(storeName);
  const slug = await uniqueSlug(baseSlug);

  // ── Check email uniqueness across ALL stores (global email check for onboarding) ──
  // We allow the same email in different stores, but not in the same store.
  // For onboarding we create a brand-new store, so we just need to make sure
  // no store with this slug already has this email (which can't happen since slug is new).
  // We do a global check to give a friendly error if they already own a store.
  const existingGlobal = await User.findOne({ email: email.toLowerCase(), role: 'admin' });
  if (existingGlobal) {
    // Check if they already own a store — if so, tell them to log in instead
    const existingStore = await Store.findOne({ ownerId: existingGlobal._id });
    if (existingStore) {
      throw createError(
        'An account with this email already owns a store. Please log in instead.',
        409,
        'CONFLICT'
      );
    }
  }

  // ── Create store + owner atomically ───────────────────────────────────────
  // Both _ids are generated up front so each document can reference the other
  // on insert. This removes the placeholder ownerId entirely — there is no
  // longer an intermediate state where a store points at a non-existent user,
  // and no follow-up update that could fail and strand it.
  const storeObjId = new Types.ObjectId();
  const userObjId = new Types.ObjectId();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const storeDoc = {
    _id: storeObjId,
    name: storeName,
    slug,
    ownerId: userObjId,
    subscriptionPlan: 'free' as const,
    subscriptionStatus: 'trialing' as const,
    isActive: true,
  };

  const userDoc = {
    _id: userObjId,
    storeId: storeObjId,
    email: email.toLowerCase(),
    fullName,
    passwordHash,
    role: 'admin' as const,
    isActive: true,
  };

  let store: Awaited<ReturnType<typeof Store.create>>[number] | null = null;
  let user: Awaited<ReturnType<typeof User.create>>[number] | null = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [store] = await Store.create([storeDoc], { session });
      [user] = await User.create([userDoc], { session });
    });
  } catch (txErr) {
    const message = (txErr as Error)?.message ?? '';
    const transactionsUnsupported =
      message.includes('Transaction numbers are only allowed on a replica set') ||
      message.includes('Transactions are not supported');

    if (!transactionsUnsupported) throw txErr;

    // Standalone MongoDB (e.g. Atlas M0): emulate atomicity with a compensating
    // delete so a failed user insert cannot leave an orphaned store behind.
    logger.warn('[onboardStore] Transactions unsupported — using compensating write');
    [store] = await Store.create([storeDoc]);
    try {
      [user] = await User.create([userDoc]);
    } catch (userErr) {
      await Store.deleteOne({ _id: storeObjId });
      throw userErr;
    }
  } finally {
    await session.endSession();
  }

  if (!store || !user) {
    throw createError('Onboarding failed — please try again', 500, 'INTERNAL_ERROR');
  }

  // ── Issue tokens ──────────────────────────────────────────────────────────
  const userId = (user._id as Types.ObjectId).toString();
  const storeId = (store._id as Types.ObjectId).toString();

  const accessToken = signAccessToken(user._id as Types.ObjectId, 'admin', storeId);

  // Delegate to auth.service so onboarding sessions use the same hash format,
  // TTL and session cap as every other login. This block previously duplicated
  // the logic with a bcrypt hash, which the refresh path then had to special-case.
  const rawRefresh = await issueRefreshToken(userId);

  // ── Fire-and-forget welcome email ─────────────────────────────────────────
  emailService.sendWelcomeEmail(storeId, user.email);

  return {
    store: {
      _id: storeId,
      name: store.name,
      slug: store.slug,
      subscriptionPlan: store.subscriptionPlan,
    },
    user: {
      _id: userId,
      email: user.email,
      fullName,
      role: 'admin',
    },
    accessToken,
    refreshToken: rawRefresh,
  };
}
