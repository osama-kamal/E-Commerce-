import { Request, Response } from 'express';
import { chatbotService } from './chatbot.service';
import { sendSuccess, sendError } from '../../utils/response';

export const chatbotController = {
  /**
   * POST /api/v1/chatbot/chat
   * Send message to chatbot and get AI response
   */
  async chat(req: Request, res: Response) {
    try {
      const { message } = req.body;
      const userId = req.user?.userId?.toString(); // Optional - works for both guests and logged-in users
      // Resolve storeId from the JWT (most reliable) or from the resolved store context
      const storeId = req.user?.storeId?.toString() ?? req.store?._id?.toString();

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return sendError(res, 'INVALID_MESSAGE', 'Message is required', 400);
      }

      if (message.length > 500) {
        return sendError(res, 'MESSAGE_TOO_LONG', 'Message must be less than 500 characters', 400);
      }

      const response = await chatbotService.chat(message, userId, storeId);

      return sendSuccess(res, {
        message: response,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Chatbot error:', err);
      return sendError(res, 'CHATBOT_ERROR', 'Failed to process message', 500);
    }
  },
};
