import mongoose, { Document, Schema, Types } from 'mongoose';

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'suspended' | 'pending_upgrade';

/**
 * Storefront presentation themes.
 *
 * Presentation only — a theme never changes catalogue, pricing, checkout,
 * permissions or any other behaviour.
 *
 * `default` is the current design and the schema default for new stores.
 *
 * IMPORTANT: Mongoose applies schema defaults when a document is CREATED, not
 * when one is read — and `.lean()` returns the raw BSON regardless. Stores
 * written before this field existed therefore come back with `theme: undefined`,
 * not `'default'`. Two things close that gap:
 *   1. `npm run migrate:store-theme` backfills existing documents;
 *   2. `resolveTheme()` below normalises anything unexpected, so a store that
 *      has not been migrated still renders the default design.
 *
 * Exported so the controller, service, migration and tests share one list.
 */
export const STORE_THEMES = ['default', 'luxury', 'modern', 'minimal', 'fashion', 'marketplace'] as const;
export type StoreTheme = typeof STORE_THEMES[number];

export const DEFAULT_STORE_THEME: StoreTheme = 'default';

/**
 * Coerces any stored value to a known theme.
 *
 * Guards three cases that all mean "render the current design": a document
 * written before the field existed (undefined), a value removed from the list
 * in a later release, and anything unexpected in the database.
 */
export function resolveTheme(value: unknown): StoreTheme {
  return STORE_THEMES.includes(value as StoreTheme) ? (value as StoreTheme) : DEFAULT_STORE_THEME;
}

export interface IStoreSettings {
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
}

export interface IStore extends Document {
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  currency: string;                   // ISO 4217, e.g. 'USD' / 'EGP'
  requestedPlan?: SubscriptionPlan;
  subscriptionEndsAt?: Date;          // when the current paid plan cycle expires
  stripeCustomerId?: string;          // cus_xxx — sparse unique index
  stripeSubscriptionId?: string;      // sub_xxx — sparse unique index
  subscriptionDunningStartedAt?: Date; // set on first invoice.payment_failed
  suspensionScheduled?: boolean;      // cleared when payment is recovered
  customDomain?: string;
  isActive: boolean;
  /** Storefront presentation theme. Never affects behaviour. */
  theme: StoreTheme;
  settings: IStoreSettings;
  createdAt: Date;
  updatedAt: Date;
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    logoUrl:      { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    facebook:     { type: String, default: '' },
    instagram:    { type: String, default: '' },
    twitter:      { type: String, default: '' },
    tiktok:       { type: String, default: '' },
    youtube:      { type: String, default: '' },
  },
  { _id: false }
);

const storeSchema = new Schema<IStore>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'],
    },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscriptionPlan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free',
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'cancelled', 'suspended', 'pending_upgrade'],
      default: 'trialing',
    },
    // ISO 4217 code the store prices and charges in.
    // Payment providers previously hardcoded their own currency ('usd' for
    // Stripe, 'egp' for Paymob) while the UI always rendered "$", so a Paymob
    // customer saw dollars and was billed pounds.
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'],
    },
    customDomain: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    requestedPlan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: null,
    },
    subscriptionEndsAt: { type: Date, default: null },
    // ── Stripe billing fields ────────────────────────────────────────────────
    // IMPORTANT: default must be `undefined` (not `null`) so sparse indexes
    // skip documents that have no Stripe customer/subscription yet.
    // `null` is a real BSON value — sparse indexes still index it and will
    // throw E11000 on the second store created without a Stripe customer.
    stripeCustomerId: {
      type: String,
      sparse: true,
      unique: true,
      default: undefined,
    },
    stripeSubscriptionId: {
      type: String,
      sparse: true,
      unique: true,
      default: undefined,
    },
    subscriptionDunningStartedAt: { type: Date, default: null },
    suspensionScheduled: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    // Presentation only. Existing documents have no `theme` key at all; Mongoose
    // applies this default on read, so every store already in the database
    // reports 'default' without needing a migration or backfill.
    theme: {
      type: String,
      enum: STORE_THEMES,
      default: 'default',
    },
    settings: { type: storeSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Note: slug and customDomain indexes are already defined at the field level
// (unique: true / sparse: true) — no need for separate schema.index() calls.

export const Store = mongoose.model<IStore>('Store', storeSchema);
