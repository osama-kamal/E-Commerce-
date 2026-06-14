import mongoose, { Document, Schema } from 'mongoose';
import { SubscriptionPlan } from '../../config/planLimits';

/**
 * PlanConfig stores the *display* metadata for each subscription plan.
 * The enforcement logic (limits, feature flags) stays in planLimits.ts —
 * this collection only controls what users see on the Pricing page.
 */
export interface IPlanConfig extends Document {
  planId: SubscriptionPlan;        // matches the hardcoded plan IDs
  displayName: string;
  price: string;                   // e.g. "$29" or "Custom"
  period: string;                  // e.g. "/month" or "forever" or ""
  features: string[];
  badge: string | null;            // e.g. "⭐ Most Popular" or null
  ctaLabel: string;                // button text
  isContactSales: boolean;         // true → show Contact Sales modal on CTA click
  isHighlighted: boolean;          // true → use indigo button style
  sortOrder: number;               // display order on pricing page
  updatedAt: Date;
}

const PlanConfigSchema = new Schema<IPlanConfig>(
  {
    planId: {
      type: String,
      required: true,
      unique: true,
      enum: ['free', 'starter', 'pro', 'enterprise'],
    },
    displayName: { type: String, required: true, maxlength: 60 },
    price: { type: String, required: true, maxlength: 20 },
    period: { type: String, default: '', maxlength: 20 },
    features: { type: [String], default: [] },
    badge: { type: String, default: null, maxlength: 60 },
    ctaLabel: { type: String, required: true, maxlength: 60 },
    isContactSales: { type: Boolean, default: false },
    isHighlighted: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const PlanConfig = mongoose.model<IPlanConfig>('PlanConfig', PlanConfigSchema);
