import { Router } from 'express';
import { recommendationsController } from '../products/recommendations.controller';
import { authenticateJWT } from '../../middleware/authenticate';

const router = Router();

// Public route - trending products
router.get('/trending', recommendationsController.getTrendingProducts);

// Protected route - personalized recommendations (requires login)
router.get('/personalized', authenticateJWT, recommendationsController.getPersonalizedRecommendations);

export default router;
