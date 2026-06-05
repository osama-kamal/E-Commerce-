import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createCategorySchema, updateCategorySchema, categoryIdSchema } from './category.schemas';
import {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
} from './category.controller';

const router = Router();

// Public
router.get('/', listCategories);
router.get('/:id', validate(categoryIdSchema), getCategory);

// Admin only
router.post('/', authenticateJWT, authorizeRole('admin'), validate(createCategorySchema), createCategory);
router.put('/:id', authenticateJWT, authorizeRole('admin'), validate(updateCategorySchema), updateCategory);
router.delete('/:id', authenticateJWT, authorizeRole('admin'), validate(categoryIdSchema), deleteCategory);

export default router;
