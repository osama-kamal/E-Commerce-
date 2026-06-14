import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';

import { CORS_ORIGINS } from './config/index';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { resolveStore } from './middleware/resolveStore';
// authLimiter lives in its own file to avoid circular imports with auth.routes.ts
export { authLimiter } from './middleware/rateLimiter';

import authRoutes from './modules/auth/auth.routes';
import categoryRoutes from './modules/categories/category.routes';
import productRoutes from './modules/products/product.routes';
import cartRoutes from './modules/cart/cart.routes';
import orderRoutes from './modules/orders/order.routes';
import paymentRoutes from './modules/payments/payment.routes';
import reviewRoutes from './modules/reviews/review.routes';
import wishlistRoutes from './modules/users/wishlist.routes';
import adminRoutes from './modules/admin/admin.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import reportsRoutes from './modules/reports/reports.routes';
import newsletterRoutes from './modules/newsletter/newsletter.routes';
import recommendationsRoutes from './modules/recommendations/recommendations.routes';
import chatbotRoutes from './modules/chatbot/chatbot.routes';
import couponRoutes from './modules/coupons/coupon.routes';
import storeRoutes from './modules/stores/store.routes';
import onboardingRoutes from './modules/onboarding/onboarding.routes';
import supportRoutes from './modules/support/support.routes';
import planRoutes from './modules/plans/plan.routes';

const app = express();

// ── Trust Railway / reverse-proxy forwarded headers ───────────────────────────
// Required to prevent ERR_ERL_UNEXPECTED_X_FORWARDED_FOR from express-rate-limit
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Store-ID', 'X-Store-Slug'],
  })
);

// ── Cookie parser (required for httpOnly refresh-token cookies) ───────────────
app.use(cookieParser());

// ── Global rate limiting ──────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // storefront pages fire multiple concurrent requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.',
  },
});
app.use(limiter);

// ── Strict auth rate limiter ───────────────────────────────────────────────────
// Defined in middleware/rateLimiter.ts and re-exported above.
// Applied per-route in auth.routes.ts to avoid circular import issues.

// ── NoSQL injection sanitization ──────────────────────────────────────────────
app.use(mongoSanitize());

// ── Webhook routes — raw body MUST be registered before express.json() ────────
// express.json() consumes the request stream. Any webhook route that needs the
// raw Buffer for HMAC verification (Stripe, Paymob) must be mounted here, BEFORE
// the global JSON parser runs, so express.raw() on those routes gets first access
// to the unconsumed stream.
app.use('/api/v1/payments', paymentRoutes);

// ── Body parsing (applies to all routes registered after this point) ──────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Store management routes (no store context needed) ─────────────────────────
app.use('/api/v1/stores', storeRoutes);

// ── Onboarding — public, no store context needed ──────────────────────────────
app.use('/api/v1/onboarding', onboardingRoutes);

// ── Auth routes — work without store context ──────────────────────────────────
app.use('/api/v1/auth', authRoutes);

// ── Support / lead-capture routes — public, no store context needed ───────────
app.use('/api/v1/support', supportRoutes);

// ── Plan display config — public GET, super-admin PUT ─────────────────────────
app.use('/api/v1/plans', planRoutes);

// ── Admin plan management — no store context needed (super-admin acts globally) ─
// Only the plan-specific endpoints are registered here without resolveStore.
// All other admin routes (dashboard, users, orders, etc.) need store context
// and are registered in the tenant router below.
import { Router as ExpressRouter } from 'express';
const globalAdminRouter = ExpressRouter();
import { authenticateJWT, authorizeRole } from './middleware/authenticate';
import { updateStorePlan, listAllStoresAdmin, listPendingUpgrades } from './modules/admin/admin.controller';
globalAdminRouter.use(authenticateJWT, authorizeRole('admin', 'super-admin'));
globalAdminRouter.patch('/stores/:id/plan', updateStorePlan);
globalAdminRouter.get('/stores', listAllStoresAdmin);
globalAdminRouter.get('/stores/pending-upgrades', listPendingUpgrades);
app.use('/api/v1/admin', globalAdminRouter);

// ── Store-scoped API routes ───────────────────────────────────────────────────
// All routes below require a store context resolved from X-Store-ID / X-Store-Slug / subdomain.
const tenantRouter = express.Router();
tenantRouter.use(resolveStore);

tenantRouter.use('/auth', authRoutes);
tenantRouter.use('/categories', categoryRoutes);
tenantRouter.use('/products', productRoutes);
tenantRouter.use('/cart', cartRoutes);
tenantRouter.use('/orders', orderRoutes);
tenantRouter.use('/reviews', reviewRoutes);
tenantRouter.use('/wishlist', wishlistRoutes);
tenantRouter.use('/admin', adminRoutes);
tenantRouter.use('/admin/analytics', analyticsRoutes);
tenantRouter.use('/admin/reports', reportsRoutes);
tenantRouter.use('/newsletter', newsletterRoutes);
tenantRouter.use('/recommendations', recommendationsRoutes);
tenantRouter.use('/chatbot', chatbotRoutes);
tenantRouter.use('/coupons', couponRoutes);

app.use('/api/v1', tenantRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFound);

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
