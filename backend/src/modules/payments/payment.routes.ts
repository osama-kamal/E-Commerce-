import { Router } from 'express';
import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createIntentSchema } from './payment.schemas';
import { createPaymentIntent, initiatePaymobPayment, paymobWebhook, stripeWebhook } from './payment.controller';

const router = Router();

// This router is mounted in app.ts BEFORE the global express.json() (the webhook
// routes below need the unparsed Buffer for HMAC verification). That also places
// it before the global mongoSanitize(), so the JSON routes here apply the
// sanitizer themselves, immediately after their own body parser.
// The webhook routes deliberately skip it — their body is a raw Buffer that must
// reach the signature check byte-for-byte.
const jsonBody = [express.json(), mongoSanitize()];

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
  ...jsonBody,
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(createIntentSchema),
  createPaymentIntent
);

// POST /api/v1/payments/paymob/initiate — Paymob 3-step init (returns iframeUrl)
router.post(
  '/paymob/initiate',
  ...jsonBody,
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(createIntentSchema), // reuses same { orderId } body schema
  initiatePaymobPayment
);

export default router;
