import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IWishlist extends Document {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  productIds: Types.ObjectId[];
  updatedAt: Date;
}

const wishlistSchema = new Schema<IWishlist>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productIds: { type: [Schema.Types.ObjectId], ref: 'Product', default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

// One wishlist per customer per store
wishlistSchema.index({ storeId: 1, customerId: 1 }, { unique: true });

export const Wishlist = mongoose.model<IWishlist>('Wishlist', wishlistSchema);
