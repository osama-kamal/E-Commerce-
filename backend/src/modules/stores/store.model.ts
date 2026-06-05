import mongoose, { Document, Schema, Types } from 'mongoose';

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'suspended';

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
      enum: ['active', 'trialing', 'past_due', 'cancelled', 'suspended'],
      default: 'trialing',
    },
    customDomain: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    isActive: { type: Boolean, default: true },
    settings: { type: storeSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Note: slug and customDomain indexes are already defined at the field level
// (unique: true / sparse: true) — no need for separate schema.index() calls.

export const Store = mongoose.model<IStore>('Store', storeSchema);
