import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { submitReviewSchema, productIdParamSchema, reviewIdParamSchema } from './review.schemas';
import { getProductReviews, submitReview, deleteReview } from './review.controller';

const router = Router();

// Public — anyone can read reviews
router.get('/products/:productId', validate(productIdParamSchema), getProductReviews);

// Customer — submit a review (verified purchase enforced in service)
router.post(
  '/products/:productId',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(submitReviewSchema),
  submitReview
);

// Admin — soft delete a review
router.delete(
  '/:id',
  authenticateJWT,
  authorizeRole('admin'),
  validate(reviewIdParamSchema),
  deleteReview
);

export default router;
