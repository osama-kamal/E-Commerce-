import { Router } from 'express';
import * as reportsController from './reports.controller';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';

const router = Router();

// All reports routes require admin authentication
router.use(authenticateJWT);
router.use(authorizeRole('admin'));

// Reports endpoints
router.get('/inventory', reportsController.getInventoryReport);
router.get('/inventory/export', reportsController.exportInventoryReport);
router.get('/sales', reportsController.getSalesReport);
router.get('/sales/export', reportsController.exportSalesReport);
router.get('/product-performance', reportsController.getProductPerformance);

export default router;
