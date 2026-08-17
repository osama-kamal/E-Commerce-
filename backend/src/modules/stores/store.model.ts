import mongoose, { Document, Schema, Types } from 'mongoose';
import { isSupportedCurrency } from '../checkout/currency';

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
  /**
   * When this store's free trial ends.
   *
   * MUST be server-owned. This was previously not stored at all: the client
   * derived it as `createdAt + 7 days` in useTrialStatus.ts and rendered a
   * paywall from that, which meant trial state existed only in the browser and
   * every API endpoint stayed fully open to an expired trial.
   *
   * `null` means "not on a trial" — either the store never had one or it has
   * since moved onto a paid plan. Absent (undefined) means the document predates
   * this field; `resolveSubscriptionAccess` treats that as a non-expiring trial
   * so an un-migrated store is never locked out by surprise. Run
   * `npm run migrate:trial-ends-at` to backfill.
   */
  trialEndsAt?: Date | null;
  stripeCustomerId?: string;          // cus_xxx — sparse unique index
  stripeSubscriptionId?: string;      // sub_xxx — sparse unique index
  subscriptionDunningStartedAt?: Date; // set on first invoice.payment_failed
  suspensionScheduled?: boolean;      // cleared when payment is recovered
  customDomain?: string;
  isActive: boolean;
  /**
   * Whether catalogue prices already contain tax.
   *
   *  • `false` (default) — US style. Listed prices are pre-tax and tax is added
   *    at checkout, so the customer pays more than the sticker price.
   *  • `true`            — EU/UK/MENA style. Listed prices already contain tax;
   *    the invoice breaks out the component that was always there and the
   *    customer pays exactly the sticker price.
   *
   * This is a property of how the MERCHANT lists prices, not of the buyer's
   * jurisdiction, which is why it lives on the store rather than on a tax rate.
   * Defaults to `false` so existing stores — whose prices were never
   * tax-inclusive, because tax did not exist — keep their current meaning.
   */
  pricesIncludeTax: boolean;
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
    //
    // Constrained to SUPPORTED_CURRENCIES, not just the three-letter shape.
    // Every gateway amount is scaled by this code's ISO 4217 minor-unit
    // exponent; a code outside the table would fall back to the 2-decimal
    // default and be charged at a plausible-looking but wrong scale. Refusing
    // the configuration is the only outcome that cannot silently move money.
    // There is no API that writes this field today — the guard is here so that
    // stays true of whatever adds one.
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
      validate: {
        validator: (value: string) => isSupportedCurrency(value),
        message: (props: { value: string }) =>
          `"${props.value}" is not a supported currency. See SUPPORTED_CURRENCIES in modules/checkout/currency.ts.`,
      },
    },
    customDomain: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    requestedPlan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: null,
    },
    subscriptionEndsAt: { type: Date, default: null },
    // Server-owned trial deadline. No schema default: a default would apply on
    // CREATE only, so it would silently disagree with the migration backfill for
    // every store written before this field existed. Both creation paths
    // (onboarding.service, store.service.createStore) set it explicitly.
    trialEndsAt: { type: Date, default: null },
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
    // `false` is the safe default: every existing store's prices were quoted
    // with no tax model at all, so treating them as tax-inclusive would
    // retroactively reinterpret the catalogue as containing VAT it never did.
    pricesIncludeTax: { type: Boolean, default: false },
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
