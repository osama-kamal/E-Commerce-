import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IProduct extends Document {
  storeId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  discount: number;
  stock: number;
  categoryId: Types.ObjectId;
  images: string[];
  sizes: string[]; // e.g. ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  isDeleted: boolean;
  averageRating: number;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 }, // Discount percentage
    stock: { type: Number, required: true, min: 0, default: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    images: { type: [String], default: [] },
    sizes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false, index: true },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Compound index for filtered catalog queries (tenant-scoped)
productSchema.index({ storeId: 1, isDeleted: 1, categoryId: 1, price: 1 });

// Index for discount filtering
productSchema.index({ storeId: 1, isDeleted: 1, discount: 1 });

// Regex search index — supports partial/prefix matching on name
productSchema.index({ storeId: 1, name: 1 });

export const Product = mongoose.model<IProduct>('Product', productSchema);
