import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICategory extends Document {
  storeId: Types.ObjectId;
  name: string;
  slug: string;
  parentId: Types.ObjectId | null;
  level: number;
  createdAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    level: { type: Number, default: 0 }, // 0 = root, 1 = sub-category
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Slug is unique per store
categorySchema.index({ storeId: 1, slug: 1 }, { unique: true });

export const Category = mongoose.model<ICategory>('Category', categorySchema);
