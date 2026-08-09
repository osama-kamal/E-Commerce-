import { Request, Response, NextFunction } from 'express';
import { chatbotService } from './chatbot.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

/**
 * Resolves the tenant for this request.
 *
 * Prefers `req.store` (set by resolveStore from the host or X-Store-* header on
 * every tenant-router request) over the JWT's storeId. The previous order was
 * reversed — JWT first — which is stale for a merchant who switched stores after
 * signing in, and inconsistent with order.controller.ts and every other
 * controller here.
 *
 * Throws rather than passing undefined through. The service used to accept a
 * missing storeId and degrade to store-less queries.
 */
function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString() ?? req.user?.storeId?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export const chatbotController = {
  /**
   * POST /api/v1/chatbot/chat
   */
  async chat(req: Request, res: Response, next: NextFunction) {
    try {
      const { message } = req.body as { message?: unknown };
      // Optional — the assistant serves guests too, and only unlocks
      // get_order_status when someone is signed in.
      const userId = req.user?.userId?.toString();

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return next(createError('Message is required', 400, 'INVALID_MESSAGE'));
      }

      if (message.length > 500) {
        return next(
          createError('Message must be less than 500 characters', 400, 'MESSAGE_TOO_LONG')
        );
      }

      const response = await chatbotService.chat(getStoreId(req), message, userId);

      return sendSuccess(res, {
        message: response,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Routed to the shared error handler rather than collapsed into a blanket
      // 500, so a missing tenant surfaces as 400 and only genuine faults reach
      // Sentry.
      return next(err);
    }
  },
};
