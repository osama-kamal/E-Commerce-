import { Types } from 'mongoose';
import { Category } from './category.model';
import { createError } from '../../middleware/errorHandler';

export interface CategoryDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  slug: string;
  parentId: Types.ObjectId | null;
  level: number;
  createdAt: Date;
}

export async function getAllCategories(storeId: string): Promise<CategoryDoc[]> {
  return Category.find({ storeId: new Types.ObjectId(storeId) })
    .sort({ level: 1, name: 1 })
    .lean() as unknown as CategoryDoc[];
}

export async function getCategoryById(id: string, storeId: string): Promise<CategoryDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid category ID', 400, 'BAD_REQUEST');
  }
  const category = await Category.findOne({
    _id: id,
    storeId: new Types.ObjectId(storeId),
  }).lean() as unknown as CategoryDoc | null;
  if (!category) throw createError('Category not found', 404, 'NOT_FOUND');
  return category;
}

export async function createCategory(data: {
  storeId: string;
  name: string;
  slug: string;
  parentId?: string | null;
}): Promise<CategoryDoc> {
  const existing = await Category.findOne({
    storeId: new Types.ObjectId(data.storeId),
    slug: data.slug,
  });
  if (existing) throw createError('Slug already in use', 409, 'CONFLICT');

  let level = 0;
  if (data.parentId) {
    if (!Types.ObjectId.isValid(data.parentId)) {
      throw createError('Invalid parentId', 400, 'BAD_REQUEST');
    }
    const parent = await Category.findOne({
      _id: data.parentId,
      storeId: new Types.ObjectId(data.storeId),
    });
    if (!parent) throw createError('Parent category not found', 404, 'NOT_FOUND');
    level = parent.level + 1;
  }

  const doc = await Category.create({ ...data, level });
  return doc.toObject() as unknown as CategoryDoc;
}

export async function updateCategory(
  id: string,
  storeId: string,
  data: { name?: string; slug?: string; parentId?: string | null }
): Promise<CategoryDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid category ID', 400, 'BAD_REQUEST');
  }

  if (data.slug) {
    const conflict = await Category.findOne({
      storeId: new Types.ObjectId(storeId),
      slug: data.slug,
      _id: { $ne: id },
    });
    if (conflict) throw createError('Slug already in use', 409, 'CONFLICT');
  }

  const updated = await Category.findOneAndUpdate(
    { _id: id, storeId: new Types.ObjectId(storeId) },
    data,
    { new: true }
  ).lean() as unknown as CategoryDoc | null;
  if (!updated) throw createError('Category not found', 404, 'NOT_FOUND');
  return updated;
}

export async function deleteCategory(id: string, storeId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid category ID', 400, 'BAD_REQUEST');
  }
  const result = await Category.findOneAndDelete({
    _id: id,
    storeId: new Types.ObjectId(storeId),
  });
  if (!result) throw createError('Category not found', 404, 'NOT_FOUND');
}
