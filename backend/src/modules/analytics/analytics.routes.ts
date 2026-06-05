import { Router } from 'express';
import * as analyticsController from './analytics.controller';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';

const router = Router();

// All analytics routes require admin authentication
router.use(authenticateJWT);
router.use(authorizeRole('admin'));

// Analytics endpoints
router.get('/sales-trends', analyticsController.getSalesTrends);
router.get('/category-performance', analyticsController.getCategoryPerformance);
router.get('/customer-metrics', analyticsController.getCustomerMetrics);
router.get('/aov-metrics', analyticsController.getAOVMetrics);
router.get('/conversion-metrics', analyticsController.getConversionMetrics);
router.get('/today-metrics', analyticsController.getTodayMetrics);
router.get('/recent-orders', analyticsController.getRecentOrders);
router.get('/revenue-goal', analyticsController.getRevenueGoal);

export default router;
