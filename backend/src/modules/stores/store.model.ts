import mongoose, { Document, Schema, Types } from 'mongoose';

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'suspended' | 'pending_upgrade';

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
  requestedPlan?: SubscriptionPlan;
  subscriptionEndsAt?: Date;          // when the current paid plan cycle expires
  stripeCustomerId?: string;          // cus_xxx — sparse unique index
  stripeSubscriptionId?: string;      // sub_xxx — sparse unique index
  subscriptionDunningStartedAt?: Date; // set on first invoice.payment_failed
  suspensionScheduled?: boolean;      // cleared when payment is recovered
  customDomain?: string;
  isActive: boolean;
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
    customDomain: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    requestedPlan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: null,
    },
    subscriptionEndsAt: { type: Date, default: null },
    // ── Stripe billing fields ────────────────────────────────────────────────
    stripeCustomerId: {
      type: String,
      sparse: true,
      unique: true,
      default: null,
    },
    stripeSubscriptionId: {
      type: String,
      sparse: true,
      unique: true,
      default: null,
    },
    subscriptionDunningStartedAt: { type: Date, default: null },
    suspensionScheduled: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    settings: { type: storeSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Note: slug and customDomain indexes are already defined at the field level
// (unique: true / sparse: true) — no need for separate schema.index() calls.

export const Store = mongoose.model<IStore>('Store', storeSchema);
