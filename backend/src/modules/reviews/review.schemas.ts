import { z } from 'zod';

export const submitReviewSchema = z.object({
  params: z.object({ productId: z.string().min(1, 'Product ID is required') }),
  body: z.object({
    rating: z.coerce.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
    comment: z.string().min(1, 'Comment is required').max(2000, 'Comment must be at most 2000 characters'),
  }),
});

export const productIdParamSchema = z.object({
  params: z.object({ productId: z.string().min(1, 'Product ID is required') }),
  // Reviews are paginated. The service also hard-caps the page size, so an
  // oversized limit is clamped rather than shipping the whole review set.
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const reviewIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Review ID is required') }),
});
