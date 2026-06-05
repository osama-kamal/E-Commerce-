import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICartItem {
  productId: Types.ObjectId;
  quantity: number;
  priceSnapshot: number;
  selectedSize?: string;
}

export interface ICart extends Document {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: ICartItem[];
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    priceSnapshot: { type: Number, required: true, min: 0 },
    selectedSize: { type: String, default: null },
  },
  { _id: false }
);

const cartSchema = new Schema<ICart>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

// One cart per customer per store
cartSchema.index({ storeId: 1, customerId: 1 }, { unique: true });

export const Cart = mongoose.model<ICart>('Cart', cartSchema);
