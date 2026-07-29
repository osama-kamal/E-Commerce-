import { Types } from 'mongoose';
import { Review } from './review.model';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { createError } from '../../middleware/errorHandler';
import { config } from '../../config/index';

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
  page: number;
  totalPages: number;
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

/** Hard ceiling on reviews returned per request. */
const MAX_REVIEW_PAGE_SIZE = 100;
const DEFAULT_REVIEW_PAGE_SIZE = 20;

export async function getProductReviews(
  storeId: string,
  productId: string,
  page = 1,
  limit = DEFAULT_REVIEW_PAGE_SIZE
): Promise<ReviewsResponse> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const storeObjId = new Types.ObjectId(storeId);
  const productObjId = new Types.ObjectId(productId);

  const safeLimit = Math.min(Math.max(1, Math.floor(limit) || DEFAULT_REVIEW_PAGE_SIZE), MAX_REVIEW_PAGE_SIZE);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const filter = { storeId: storeObjId, productId: productObjId, isDeleted: false };

  // The rating summary is computed in the database over the WHOLE set, so it
  // stays correct regardless of which page is being returned. Previously the
  // endpoint loaded every review for the product and averaged them in JS.
  const [reviews, summary] = await Promise.all([
    // `_id` is the tiebreaker: sorting on createdAt alone is unstable when
    // several reviews share a timestamp (bulk import, or simply the same
    // millisecond), which lets the same review appear on two pages while
    // another is skipped entirely.
    Review.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(safeLimit).lean(),
    Review.aggregate<{ avg: number; count: number }>([
      { $match: filter },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);

  const total = summary[0]?.count ?? 0;
  const averageRating = total > 0 ? Math.round((summary[0]!.avg) * 100) / 100 : 0;

  return {
    reviews: reviews as unknown as ReviewDoc[],
    averageRating,
    total,
    page: safePage,
    totalPages: Math.ceil(total / safeLimit),
  };
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

  // Verified-purchase enforcement is driven by an explicit, default-on flag.
  // It was previously `process.env.NODE_ENV !== 'production'`, so any host that
  // left NODE_ENV unset let anyone review anything.
  if (!config.ALLOW_UNVERIFIED_REVIEWS) {
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
