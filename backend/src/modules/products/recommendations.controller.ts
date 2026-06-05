import { Request, Response } from 'express';
import { recommendationsService } from '../../services/recommendations.service';
import { sendSuccess, sendError } from '../../utils/response';

export const recommendationsController = {
  /**
   * GET /api/v1/products/:id/recommendations
   * Get AI recommendations for a specific product
   */
  async getProductRecommendations(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 6;

      const recommendations = await recommendationsService.getRecommendations(id, limit);

      return sendSuccess(res, {
        recommendations,
        count: recommendations.length,
        message: 'AI recommendations generated successfully',
      });
    } catch (err: any) {
      return sendError(res, 'RECOMMENDATIONS_ERROR', err.message, 500);
    }
  },

  /**
   * GET /api/v1/recommendations/personalized
   * Get personalized recommendations for logged-in user
   */
  async getPersonalizedRecommendations(req: Request, res: Response) {
    try {
      const userId = req.user?.userId?.toString();
      if (!userId) {
        return sendError(res, 'UNAUTHORIZED', 'User not authenticated', 401);
      }

      const limit = parseInt(req.query.limit as string) || 8;
      const recommendations = await recommendationsService.getPersonalizedRecommendations(
        userId,
        limit
      );

      return sendSuccess(res, {
        recommendations,
        count: recommendations.length,
        message: 'Personalized recommendations generated successfully',
      });
    } catch (err: any) {
      return sendError(res, 'PERSONALIZED_RECOMMENDATIONS_ERROR', err.message, 500);
    }
  },

  /**
   * GET /api/v1/recommendations/trending
   * Get trending products
   */
  async getTrendingProducts(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 8;
      const trending = await recommendationsService.getTrendingProducts(limit);

      return sendSuccess(res, {
        products: trending,
        count: trending.length,
        message: 'Trending products fetched successfully',
      });
    } catch (err: any) {
      return sendError(res, 'TRENDING_ERROR', err.message, 500);
    }
  },
};
