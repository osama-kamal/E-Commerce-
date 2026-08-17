import { Request, Response, NextFunction } from 'express';
import { recommendationsService } from '../recommendations/recommendations.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

/**
 * Resolves the tenant for this request.
 *
 * Prefers `req.store` (set by resolveStore from the host or the X-Store-* header
 * on every tenant-router request) over the JWT's storeId, which is fixed at
 * login and goes stale when a merchant switches store. Mirrors the helper in
 * order.controller.ts.
 *
 * Throws rather than defaulting. These endpoints previously ran with no tenant
 * at all, and "no tenant" meant "every tenant" — a public endpoint returning the
 * whole platform's catalogue. There is no safe fallback here.
 */
function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString() ?? req.user?.storeId?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export const recommendationsController = {
  /**
   * GET /api/v1/products/:id/recommendations
   */
  async getProductRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 6, 1), 24);

      const recommendations = await recommendationsService.getRecommendations(
        getStoreId(req),
        id,
        limit
      );

      return sendSuccess(res, {
        recommendations,
        count: recommendations.length,
      });
    } catch (err) {
      // Routed to the shared error handler rather than swallowed into a blanket
      // 500 — a product in another tenant must surface as 404, and only genuine
      // faults should reach Sentry.
      return next(err);
    }
  },

  /**
   * GET /api/v1/recommendations/personalized
   */
  async getPersonalizedRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId?.toString();
      if (!userId) {
        return next(createError('Authentication required', 401, 'UNAUTHORIZED'));
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 8, 1), 24);
      const recommendations = await recommendationsService.getPersonalizedRecommendations(
        getStoreId(req),
        userId,
        limit
      );

      return sendSuccess(res, {
        recommendations,
        count: recommendations.length,
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * GET /api/v1/recommendations/trending
   *
   * Public. That is exactly why the missing tenant filter mattered: no
   * credential was needed to read the highest-rated products on the platform.
   */
  async getTrendingProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 8, 1), 24);
      const trending = await recommendationsService.getTrendingProducts(getStoreId(req), limit);

      return sendSuccess(res, {
        products: trending,
        count: trending.length,
      });
    } catch (err) {
      return next(err);
    }
  },
};
