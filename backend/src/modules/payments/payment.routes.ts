import { Router } from 'express';
import express from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createIntentSchema } from './payment.schemas';
import { createPaymentIntent, stripeWebhook } from './payment.controller';

const router = Router();

// POST /api/v1/payments/webhook
// Must use express.raw BEFORE express.json() parses the body.
// Stripe signature verification requires the raw, unparsed request body.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

// POST /api/v1/payments/intent
router.post(
  '/intent',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(createIntentSchema),
  createPaymentIntent
);

export default router;
