import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

// ── Environment schema ─────────────────────────────────────────────────────────
//
// Rules:
//  • REQUIRED  — missing value crashes the server immediately (fail-fast)
//  • OPTIONAL  — missing value logs a warning but server starts normally
//  • Stripe keys are OPTIONAL so development works without a payment gateway.
//    When you're ready to enable payments, move them to REQUIRED.
//
const envSchema = z.object({

  // ── Core ────────────────────────────────────────────────────────────────────
  PORT: z
    .string()
    .default('5000')
    .transform((v) => parseInt(v, 10)),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // ── Database (REQUIRED) ─────────────────────────────────────────────────────
  // Accept both MONGODB_URI (standard) and MONGO_URI (legacy alias in .env).
  // MONGO_URI takes precedence when both are set, so existing .env files keep working.
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI cannot be empty')
    .default('mongodb://localhost:27017/ecommerce'),

  MONGO_URI: z.string().optional(),

  // ── Redis (optional — server degrades gracefully without it) ────────────────
  REDIS_URL: z
    .string()
    .default('redis://localhost:6379'),

  // ── JWT (REQUIRED — weak defaults only allowed in development) ──────────────
  JWT_ACCESS_SECRET: isProd
    ? z
        .string({ required_error: 'JWT_ACCESS_SECRET is required in production' })
        .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    : z
        .string()
        .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
        .default('dev-access-secret-change-in-production-32c'),

  JWT_REFRESH_SECRET: isProd
    ? z
        .string({ required_error: 'JWT_REFRESH_SECRET is required in production' })
        .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
    : z
        .string()
        .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
        .default('dev-refresh-secret-change-in-production-32c'),

  JWT_ACCESS_EXPIRY: z
    .string()
    .default('15m'),

  // ── CORS ────────────────────────────────────────────────────────────────────
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((v) => v.split(',').map((o) => o.trim())),

  // ── Stripe (OPTIONAL — payment routes will be disabled without these) ───────
  // Remove .optional() and add .min(1) when you're ready to go live with Stripe.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── Stripe Price IDs (OPTIONAL — subscription billing disabled without these) ─
  // Set these to the Price IDs from your Stripe dashboard (test or live).
  // Use test Price IDs (price_xxx from test mode) during development.
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),

  // ── Paymob (OPTIONAL — MENA payment gateway) ────────────────────────────────
  // Obtain from: Paymob Dashboard → Settings → Account Info / API Keys
  // ⚠️  Never commit real values — use .env file only, never hardcode.
  PAYMOB_API_KEY: z.string().optional(),
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  // Paymob integration IDs (card, wallet, etc.) — found in Paymob dashboard under Developers > Payment Integrations
  PAYMOB_INTEGRATION_ID_CARD: z.string().optional(),
  PAYMOB_INTEGRATION_ID_WALLET: z.string().optional(),
  // Iframe ID — from Paymob Dashboard → Developers → Iframes
  // This is DIFFERENT from the Integration ID used in payment key generation.
  PAYMOB_IFRAME_ID: z.string().optional(),

  // ── Checkout ────────────────────────────────────────────────────────────────
  // Orders are created (and stock decremented) BEFORE the customer pays, so an
  // abandoned online checkout would otherwise hold inventory forever. Pending
  // online orders older than this are auto-cancelled and their stock released.
  // Cash-on-delivery orders are never expired — they legitimately sit pending
  // until a human fulfils them.
  PENDING_ORDER_TTL_MINUTES: z
    .string()
    .default('30')
    .transform((v) => parseInt(v, 10)),

  // ── Reviews ─────────────────────────────────────────────────────────────────
  // Verified-purchase enforcement is ON unless explicitly disabled.
  // This was previously derived from NODE_ENV (`NODE_ENV !== 'production'`
  // skipped the check), which meant a host that forgot to set NODE_ENV silently
  // let anyone review any product. Security controls must be opt-OUT by explicit
  // intent, never a side effect of an unrelated environment variable.
  ALLOW_UNVERIFIED_REVIEWS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // ── AI / Chatbot (OPTIONAL) ─────────────────────────────────────────────────
  OPENAI_API_KEY: z.string().optional(),

  // ── Email (OPTIONAL — email features silently disabled without these) ────────
  EMAIL_HOST: z.string().optional(),                          // SMTP host (default: smtp.gmail.com)
  EMAIL_PORT: z.string().default('587').transform((v) => parseInt(v, 10)),
  EMAIL_SECURE: z.string().default('false').transform((v) => v === 'true'),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('Ecommerce Store'),

  // ── Resend (replaces Brevo) — transactional email via resend.com ─────────
  // Obtain API key from: https://resend.com → API Keys
  // EMAIL_FROM_ADDRESS must be a verified sender domain in your Resend account.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().optional(),
  // Optional — BCC every order confirmation to this address for admin visibility.
  ADMIN_BCC_EMAIL: z.string().optional(),

  // ── Frontend ────────────────────────────────────────────────────────────────
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // ── Backend public URL (used for webhook callback_url in Paymob requests) ──
  // Set to your Railway domain in production, or your ngrok URL when testing locally.
  // Example: https://my-app.up.railway.app  OR  https://abc.ngrok-free.dev
  BACKEND_URL: z.string().default('http://localhost:5000'),

  // ── Cloudinary (OPTIONAL) ───────────────────────────────────────────────────
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

// ── Parse & validate ───────────────────────────────────────────────────────────
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌  Environment variable validation failed — server cannot start:\n');
  parsed.error.errors.forEach((e) => {
    console.error(`   • ${e.path.join('.')}: ${e.message}`);
  });
  console.error('\n   Fix the above variables in your .env file and restart.\n');
  process.exit(1);
}

export const config = parsed.data;

// ── MONGO_URI alias resolution ─────────────────────────────────────────────────
// If MONGO_URI is set (legacy .env naming), use it as the effective connection string.
// This MUST run before the named exports below so MONGODB_URI is correct when read.
if (config.MONGO_URI) {
  (config as any).MONGODB_URI = config.MONGO_URI;
}

// Warn if we're silently using the localhost default (means neither var was set)
if (config.MONGODB_URI === 'mongodb://localhost:27017/ecommerce' && !config.MONGO_URI) {
  console.warn('⚠️   MONGODB_URI not set — using localhost fallback. Set MONGODB_URI or MONGO_URI in .env for production.');
}

// ── Warn about missing optional-but-important variables ───────────────────────
// These won't crash the server, but features that depend on them will silently
// fail at runtime without this warning.
const optionalWarnings: Array<{ key: keyof typeof config; feature: string }> = [
  { key: 'STRIPE_SECRET_KEY',      feature: 'Stripe payments' },
  { key: 'STRIPE_WEBHOOK_SECRET',  feature: 'Stripe webhooks' },
  { key: 'STRIPE_PRICE_STARTER',   feature: 'Stripe subscription billing (starter plan)' },
  { key: 'STRIPE_PRICE_PRO',       feature: 'Stripe subscription billing (pro plan)' },
  { key: 'STRIPE_PRICE_ENTERPRISE', feature: 'Stripe subscription billing (enterprise plan)' },
  { key: 'PAYMOB_API_KEY',          feature: 'Paymob payments (MENA)' },
  { key: 'PAYMOB_SECRET_KEY',       feature: 'Paymob payments (MENA)' },
  { key: 'PAYMOB_HMAC_SECRET',      feature: 'Paymob webhook verification' },
  { key: 'OPENAI_API_KEY',          feature: 'AI chatbot / recommendations' },
  { key: 'EMAIL_USER',             feature: 'Transactional email (SMTP fallback)' },
  { key: 'RESEND_API_KEY',         feature: 'Transactional email (Resend)' },
  { key: 'CLOUDINARY_CLOUD_NAME',  feature: 'Cloudinary image uploads' },
];

const missing = optionalWarnings.filter(({ key }) => !config[key]);
if (missing.length > 0) {
  console.warn('\n⚠️   Optional env vars not set (features will be disabled):');
  missing.forEach(({ key, feature }) => {
    console.warn(`     • ${key.padEnd(26)} → ${feature}`);
  });
  console.warn('');
}

// ── Named exports for convenience ─────────────────────────────────────────────
export const {
  PORT,
  NODE_ENV,
  MONGODB_URI,
  MONGO_URI,
  REDIS_URL,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY,
  CORS_ORIGINS,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_STARTER,
  STRIPE_PRICE_PRO,
  STRIPE_PRICE_ENTERPRISE,
  OPENAI_API_KEY,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM_NAME,
  RESEND_API_KEY,
  EMAIL_FROM_ADDRESS,
  ADMIN_BCC_EMAIL,
  FRONTEND_URL,
  BACKEND_URL,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  PAYMOB_API_KEY,
  PAYMOB_SECRET_KEY,
  PAYMOB_HMAC_SECRET,
  PAYMOB_INTEGRATION_ID_CARD,
  PAYMOB_INTEGRATION_ID_WALLET,
  PAYMOB_IFRAME_ID,
} = config;
