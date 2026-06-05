import { Router } from 'express';
import { couponController } from './coupon.controller';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';

const router = Router();

// Public — validate a coupon code
router.post('/validate', couponController.validate);

// Admin — CRUD
router.get('/', authenticateJWT, authorizeRole('admin'), couponController.list);
router.post('/', authenticateJWT, authorizeRole('admin'), couponController.create);
router.put('/:id', authenticateJWT, authorizeRole('admin'), couponController.update);
router.delete('/:id', authenticateJWT, authorizeRole('admin'), couponController.remove);

export default router;
