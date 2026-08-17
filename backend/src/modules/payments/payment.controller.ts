import { Request, Response, NextFunction } from 'express';
import * as paymentService from './payment.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';
import { paymentProviderFactory } from './providers/payment-provider.factory';
import { Order } from '../orders/order.model';
import { toMinorUnits } from '../checkout/currency';
import { Types } from 'mongoose';
import { logger } from '../../utils/logger';

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

// ── Paymob: initiate payment ──────────────────────────────────────────────────
//
// POST /api/v1/payments/paymob/initiate
// Body: { orderId: string }
//
// Returns: { paymentToken, iframeUrl } so the frontend can open the Paymob iframe.

export async function initiatePaymobPayment(
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
    const storeId    = req.user.storeId!.toString();

    if (!Types.ObjectId.isValid(orderId)) {
      return next(createError('Invalid order ID', 400, 'BAD_REQUEST'));
    }

    // Load the order to get the total amount
    const order = await Order.findOne({
      _id:        new Types.ObjectId(orderId),
      customerId: new Types.ObjectId(customerId),
      storeId:    new Types.ObjectId(storeId),
    }).lean();

    if (!order) {
      return next(createError('Order not found', 404, 'NOT_FOUND'));
    }

    // Paymob settles in EGP. Previously this charged 'egp' for ANY order while
    // the UI rendered "$", so a USD-priced order was billed as pounds. Refuse
    // rather than silently charge in a different currency than the one quoted.
    const orderCurrency = (order.currency ?? 'USD').toUpperCase();
    if (orderCurrency !== 'EGP') {
      return next(
        createError(
          `Paymob can only process EGP orders; this order is in ${orderCurrency}. Please choose another payment method.`,
          400,
          'CURRENCY_NOT_SUPPORTED'
        )
      );
    }

    const adapter = paymentProviderFactory.get('paymob');

    const result = await adapter.initiatePayment({
      orderId,
      customerId,
      storeId,
      // Paymob expects the amount in the smallest currency unit (piastres for
      // EGP). Scaled through the shared helper rather than a literal 100 — the
      // guard above pins this to EGP today, so the two agree, but if Paymob
      // ever settles a three-decimal Gulf currency the literal would be wrong
      // by 10× and nothing here would say so.
      amountInSmallestUnit: toMinorUnits(order.totalAmount, orderCurrency),
      currency: 'egp',
      idempotencyKey: `paymob_order_${orderId}`,
    });

    sendSuccess(res, {
      paymentToken: result.clientData.paymentToken,
      iframeUrl:    result.clientData.iframeUrl,
      paymobOrderId: result.providerPaymentId,
    });
  } catch (err) {
    next(err);
  }
}

// ── Paymob: webhook callback ───────────────────────────────────────────────────
//
// POST /api/v1/payments/paymob/webhook
//
// Paymob sends a POST with JSON body containing `obj` (transaction) and `hmac`.
// We verify the HMAC-SHA512 signature before processing.
// The route uses express.raw() so we receive the raw buffer needed for signature
// verification — same pattern as the Stripe webhook route.

export async function paymobWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adapter = paymentProviderFactory.get('paymob');

    // req.body is the raw Buffer here (set by express.raw in the route).
    // Paymob sends the HMAC as a query parameter (?hmac=...), not in the body.
    // We inject it into the headers map under a synthetic key so the adapter
    // can retrieve it without needing a separate query-params argument.
    const rawBody = req.body as Buffer;
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      'x-paymob-hmac': typeof req.query.hmac === 'string' ? req.query.hmac : undefined,
    };

    // Structured entry log. Deliberately records only non-sensitive shape
    // metadata — the previous version logged `bodyPreview`, the first 200 bytes
    // of the raw payload, which carries transaction and customer detail into
    // whatever aggregates the logs. Payment payloads must not be echoed.
    logger.info('Paymob webhook received', {
      contentType: req.headers['content-type'],
      isBuffer: Buffer.isBuffer(rawBody),
      bodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : String(rawBody).length,
      hasHmac: typeof req.query.hmac === 'string',
    });

    let event;
    try {
      event = await adapter.verifyWebhookSignature(rawBody, headers);
    } catch (sigErr) {
      const err = sigErr as Error;
      logger.warn('Paymob webhook: signature verification failed', { message: err.message });
      // Return 200 to prevent Paymob from flooding retries on a misconfigured secret,
      // but log the failure clearly. Change to 400 once HMAC secret is confirmed correct.
      res.status(200).json({ received: true, verified: false });
      return;
    }

    // Process the verified event — adapter handles order updates and idempotency.
    await adapter.handleProviderEvent(event);

    // Paymob expects a 200 quickly — any non-2xx may trigger retries.
    res.status(200).json({ received: true, verified: true });
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
