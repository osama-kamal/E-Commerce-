import { Router } from 'express';
import { newsletterController } from './newsletter.controller';
import { validate } from '../../middleware/validate';
import { subscribeSchema, unsubscribeSchema } from './newsletter.schemas';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';

const router = Router();

// Public routes
router.post('/subscribe', validate(subscribeSchema), newsletterController.subscribe);
router.post('/unsubscribe', validate(unsubscribeSchema), newsletterController.unsubscribe);

// Admin routes (require authentication and admin role)
router.get('/subscribers', authenticateJWT, authorizeRole('admin'), newsletterController.getAllSubscribers);
router.get('/stats', authenticateJWT, authorizeRole('admin'), newsletterController.getStats);
router.post('/send', authenticateJWT, authorizeRole('admin'), newsletterController.sendNewsletter);

export default router;
