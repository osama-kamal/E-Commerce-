import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Store } from '../stores/store.model';
import { User } from '../auth/user.model';
import { signAccessToken } from '../../utils/jwt';
import { createError } from '../../middleware/errorHandler';
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

  // ── Create store first (so we have the storeId for the user) ──────────────
  const store = await Store.create({
    name: storeName,
    slug,
    ownerId: new Types.ObjectId(), // placeholder — updated after user creation
    subscriptionPlan: 'free',
    subscriptionStatus: 'trialing',
    isActive: true,
    metadata: { category: storeCategory },
  });

  // ── Create owner user scoped to this store ────────────────────────────────
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await User.create({
    storeId: store._id,
    email: email.toLowerCase(),
    passwordHash,
    role: 'admin',
    isActive: true,
    fullName, // stored as a virtual/extra field — harmless if schema ignores it
  });

  // ── Update store with real ownerId ────────────────────────────────────────
  await Store.updateOne({ _id: store._id }, { ownerId: user._id });

  // ── Issue tokens ──────────────────────────────────────────────────────────
  const userId = (user._id as Types.ObjectId).toString();
  const storeId = (store._id as Types.ObjectId).toString();

  const accessToken = signAccessToken(user._id as Types.ObjectId, 'admin', storeId);

  // Simple refresh token (same pattern as auth.service)
  const crypto = await import('crypto');
  const rawRefresh = `${userId}.${crypto.randomBytes(64).toString('hex')}`;
  const refreshHash = await bcrypt.hash(rawRefresh, BCRYPT_ROUNDS);

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          token: refreshHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    }
  );

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
