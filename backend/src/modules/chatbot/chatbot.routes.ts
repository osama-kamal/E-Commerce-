import { Router } from 'express';
import { chatbotController } from './chatbot.controller';
import { validate } from '../../middleware/validate';
import { chatMessageSchema } from './chatbot.schemas';
import { authenticateJWT } from '../../middleware/authenticate';

const router = Router();

// Chatbot endpoint - works for both guests and logged-in users
// If user is logged in, we can provide personalized responses
router.post(
  '/chat',
  (req, res, next) => {
    // Try to authenticate, but don't fail if no token
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      return authenticateJWT(req, res, next);
    }
    next();
  },
  validate(chatMessageSchema),
  chatbotController.chat
);

export default router;
