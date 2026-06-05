import { Request, Response, NextFunction } from 'express';
import * as paymentService from './payment.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

export async function createPaymentIntent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { orderId } = req.body as { orderId: string };
    if (!req.user) {
      return next(createError('Authentication required', 401, 'UNAUTHORIZED'));
    }
    const customerId = req.user.userId.toString();
    // Pass storeId to enforce cross-store order ownership (item #10)
    const storeId = req.user.storeId!.toString();
    const result = await paymentService.createPaymentIntent(orderId, customerId, storeId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function stripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return next(createError('Missing Stripe signature header', 400, 'BAD_REQUEST'));
    }

    // req.body is the raw Buffer here (set by express.raw in the route)
    await paymentService.handleWebhook(req.body as Buffer, signature);

    // Stripe expects a 200 quickly — any non-2xx triggers a retry
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
