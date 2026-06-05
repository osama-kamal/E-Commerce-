import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { uploadImage } from '../../middleware/upload';
import {
  createProductSchema,
  updateProductSchema,
  productIdSchema,
  listProductsSchema,
} from './product.schemas';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
  bulkDeleteProducts,
  bulkUpdateProducts,
} from './product.controller';
import { recommendationsController } from './recommendations.controller';

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/', validate(listProductsSchema), listProducts);
router.get('/:id', validate(productIdSchema), getProduct);

// AI Recommendations routes
router.get('/:id/recommendations', validate(productIdSchema), recommendationsController.getProductRecommendations);

// ── Admin-only routes ─────────────────────────────────────────────────────────
router.post(
  '/',
  authenticateJWT,
  authorizeRole('admin'),
  validate(createProductSchema),
  createProduct
);

router.put(
  '/:id',
  authenticateJWT,
  authorizeRole('admin'),
  validate(updateProductSchema),
  updateProduct
);

router.delete(
  '/:id',
  authenticateJWT,
  authorizeRole('admin'),
  validate(productIdSchema),
  deleteProduct
);

// Bulk operations
router.post(
  '/bulk/delete',
  authenticateJWT,
  authorizeRole('admin'),
  bulkDeleteProducts
);

router.put(
  '/bulk/update',
  authenticateJWT,
  authorizeRole('admin'),
  bulkUpdateProducts
);

// Image management — admin only
router.post(
  '/:id/images',
  authenticateJWT,
  authorizeRole('admin'),
  uploadImage,
  uploadProductImage
);

router.delete(
  '/:id/images',
  authenticateJWT,
  authorizeRole('admin'),
  deleteProductImage
);

export default router;
