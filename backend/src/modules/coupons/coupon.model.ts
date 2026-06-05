import { Schema, model, Document, Types } from 'mongoose';

export interface ICoupon extends Document {
  storeId: Types.ObjectId;
  code: string;
  type: 'percent' | 'fixed';
  discount: number;
  minOrderAmount: number;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['percent', 'fixed'],
      required: true,
    },
    discount: {
      type: Number,
      required: true,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUses: {
      type: Number,
      default: 0, // 0 = unlimited
      min: 0,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Coupon codes are unique per store (not globally)
couponSchema.index({ storeId: 1, code: 1 }, { unique: true });

export const Coupon = model<ICoupon>('Coupon', couponSchema);
