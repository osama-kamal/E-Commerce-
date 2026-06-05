import { Request, Response } from 'express';
import { newsletterService } from './newsletter.service';
import { sendSuccess, sendError } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export const newsletterController = {
  async subscribe(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const result = await newsletterService.subscribe(getStoreId(req), email);
      return sendSuccess(res, { subscriber: result.subscriber, message: result.message }, 201);
    } catch (err: any) {
      return sendError(res, 'SUBSCRIBE_ERROR', err.message, 400);
    }
  },

  async unsubscribe(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const result = await newsletterService.unsubscribe(getStoreId(req), email);
      return sendSuccess(res, { subscriber: result.subscriber, message: result.message });
    } catch (err: any) {
      return sendError(res, 'UNSUBSCRIBE_ERROR', err.message, 400);
    }
  },

  async getAllSubscribers(req: Request, res: Response) {
    try {
      const activeOnly = req.query.activeOnly !== 'false';
      const subscribers = await newsletterService.getAllSubscribers(getStoreId(req), activeOnly);
      return sendSuccess(res, subscribers);
    } catch (err: any) {
      return sendError(res, 'FETCH_ERROR', err.message, 500);
    }
  },

  async getStats(req: Request, res: Response) {
    try {
      const stats = await newsletterService.getSubscriberCount(getStoreId(req));
      return sendSuccess(res, stats);
    } catch (err: any) {
      return sendError(res, 'STATS_ERROR', err.message, 500);
    }
  },

  async sendNewsletter(req: Request, res: Response) {
    try {
      const { subject, message } = req.body;
      if (!subject || !message) {
        return sendError(res, 'VALIDATION_ERROR', 'Subject and message are required', 400);
      }
      const result = await newsletterService.sendNewsletter(getStoreId(req), subject, message);
      return sendSuccess(res, result);
    } catch (err: any) {
      return sendError(res, 'SEND_ERROR', err.message, 500);
    }
  },
};
