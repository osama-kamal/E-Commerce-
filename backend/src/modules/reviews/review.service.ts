import { Types } from 'mongoose';
import { Review } from './review.model';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { createError } from '../../middleware/errorHandler';

export interface ReviewDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  customerId: Types.ObjectId;
  rating: number;
  comment: string;
  isDeleted: boolean;
  createdAt: Date;
}

export interface ReviewsResponse {
  reviews: ReviewDoc[];
  averageRating: number;
  total: number;
}

async function recalculateProductRating(storeId: Types.ObjectId, productId: Types.ObjectId): Promise<void> {
  const result = await Review.aggregate([
    { $match: { storeId, productId, isDeleted: false } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  const avg = result[0]?.avg ?? 0;
  const count = result[0]?.count ?? 0;

  await Product.updateOne(
    { _id: productId, storeId },
    {
      averageRating: Math.round(avg * 100) / 100,
      reviewCount: count,
    }
  );
}

export async function getProductReviews(storeId: string, productId: string): Promise<ReviewsResponse> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const reviews = await Review.find({
    storeId: new Types.ObjectId(storeId),
    productId: new Types.ObjectId(productId),
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  const total = reviews.length;
  const averageRating =
    total > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / total) * 100) / 100
      : 0;

  return { reviews: reviews as unknown as ReviewDoc[], averageRating, total };
}

export async function submitReview(
  storeId: string,
  customerId: string,
  productId: string,
  rating: number,
  comment: string
): Promise<ReviewDoc> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const storeObjId = new Types.ObjectId(storeId);
  const productObjId = new Types.ObjectId(productId);
  const customerObjId = new Types.ObjectId(customerId);

  const product = await Product.findOne({ _id: productObjId, storeId: storeObjId, isDeleted: false }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');

  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev) {
    const deliveredOrder = await Order.findOne({
      storeId: storeObjId,
      customerId: customerObjId,
      status: 'delivered',
      'items.productId': productObjId,
    }).lean();

    if (!deliveredOrder) {
      throw createError('You can only review products from delivered orders', 403, 'FORBIDDEN');
    }
  }

  const existing = await Review.findOne({
    storeId: storeObjId,
    productId: productObjId,
    customerId: customerObjId,
  }).lean();

  if (existing) {
    throw createError('You have already reviewed this product', 409, 'CONFLICT');
  }

  const review = await Review.create({
    storeId: storeObjId,
    productId: productObjId,
    customerId: customerObjId,
    rating,
    comment,
  });

  await recalculateProductRating(storeObjId, productObjId);

  return review.toObject() as unknown as ReviewDoc;
}

export async function softDeleteReview(storeId: string, reviewId: string): Promise<void> {
  if (!Types.ObjectId.isValid(reviewId)) {
    throw createError('Invalid review ID', 400, 'BAD_REQUEST');
  }

  const review = await Review.findOne({
    _id: reviewId,
    storeId: new Types.ObjectId(storeId),
  });
  if (!review || review.isDeleted) {
    throw createError('Review not found', 404, 'NOT_FOUND');
  }

  review.isDeleted = true;
  await review.save();

  await recalculateProductRating(new Types.ObjectId(storeId), review.productId);
}
