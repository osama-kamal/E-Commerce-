import { Router } from 'express';
import express from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createIntentSchema } from './payment.schemas';
import { createPaymentIntent, initiatePaymobPayment, paymobWebhook, stripeWebhook } from './payment.controller';

const router = Router();

// POST /api/v1/payments/webhook — Stripe event delivery
router.post(
  '/webhook',
  express.raw({ type: ['application/json', 'application/octet-stream'] }),
  stripeWebhook
);

// POST /api/v1/payments/paymob/webhook — Paymob HMAC-signed transaction callback
router.post(
  '/paymob/webhook',
  express.raw({ type: 'application/json' }),
  paymobWebhook
);

// POST /api/v1/payments/intent — Stripe PaymentIntent (returns clientSecret)
router.post(
  '/intent',
  express.json(),
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(createIntentSchema),
  createPaymentIntent
);

// POST /api/v1/payments/paymob/initiate — Paymob 3-step init (returns iframeUrl)
router.post(
  '/paymob/initiate',
  express.json(),
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(createIntentSchema), // reuses same { orderId } body schema
  initiatePaymobPayment
);

export default router;
