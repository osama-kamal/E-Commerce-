# Production Deployment Checklist

This document is the definitive guide for deploying the platform to a production environment. Work through each section in order. Do not skip the Security Checklist — it must be completed before any real traffic hits the system.

**Stack:** React (Vite) → Vercel | Node/Express → Railway | MongoDB Atlas | Redis (Railway or Upstash)

---

## Table of Contents

1. [Environment Variables](#1-environment-variables)
2. [Database Setup](#2-database-setup)
3. [Backend Deployment — Railway](#3-backend-deployment--railway)
4. [Frontend Deployment — Vercel](#4-frontend-deployment--vercel)
5. [Domain & SSL](#5-domain--ssl)
6. [Security Checklist](#6-security-checklist)
7. [Monitoring & Logging](#7-monitoring--logging)
8. [Post-Deployment Smoke Tests](#8-post-deployment-smoke-tests)

---

## 1. Environment Variables

Never commit secrets to git. All values below must be configured as environment variables directly in Railway (backend) and Vercel (frontend).

### 1.1 Backend — Railway Environment Variables

Set every variable in **Railway → Project → Variables**. A value marked `REQUIRED` will crash the server at startup if missing.

```bash
# ── Server ──────────────────────────────────────────────────────────────────
NODE_ENV=production                          # REQUIRED — enables production error handling
PORT=5000                                    # Railway sets this automatically; leave as-is

# ── Database ────────────────────────────────────────────────────────────────
MONGO_URI=                                   # REQUIRED — MongoDB Atlas connection string (see Section 2)

# ── Redis ───────────────────────────────────────────────────────────────────
REDIS_URL=                                   # Optional — refresh token caching (degrades gracefully if absent)

# ── JWT ─────────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=                           # REQUIRED — min 32 chars, generate with: openssl rand -hex 32
JWT_REFRESH_SECRET=                          # REQUIRED — min 32 chars, generate with: openssl rand -hex 32
JWT_ACCESS_EXPIRY=15m                        # REQUIRED — keep at 15m for security

# ── CORS ────────────────────────────────────────────────────────────────────
CORS_ORIGINS=                                # REQUIRED — comma-separated list of your Vercel frontend URLs
                                             # e.g. https://yourapp.vercel.app,https://yourdomain.com

# ── URLs ────────────────────────────────────────────────────────────────────
BACKEND_URL=                                 # REQUIRED — your Railway public URL, e.g. https://yourapp.up.railway.app
FRONTEND_URL=                                # REQUIRED — your Vercel URL, e.g. https://yourapp.vercel.app

# ── Platform Admin ──────────────────────────────────────────────────────────
PLATFORM_STORE_ID=                           # REQUIRED — MongoDB ObjectId of the platform admin's store

# ── Stripe ──────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=                           # sk_live_...
STRIPE_WEBHOOK_SECRET=                       # whsec_... (from Stripe Dashboard → Webhooks)
STRIPE_PRICE_STARTER=                        # price_live_... (from Stripe Dashboard → Products)
STRIPE_PRICE_PRO=                            # price_live_...
STRIPE_PRICE_ENTERPRISE=                     # price_live_...

# ── Paymob ──────────────────────────────────────────────────────────────────
PAYMOB_API_KEY=                              # Long Base64 key from Paymob Dashboard
PAYMOB_SECRET_KEY=                           # egy_sk_live_...
PAYMOB_HMAC_SECRET=                          # HMAC key for webhook signature verification
PAYMOB_INTEGRATION_ID_CARD=                  # Numeric ID from Paymob → Developers → Payment Integrations
PAYMOB_IFRAME_ID=                            # Numeric ID from Paymob → Developers → Iframes

# ── Email — Resend ──────────────────────────────────────────────────────────
RESEND_API_KEY=                              # re_... from resend.com → API Keys
EMAIL_FROM_ADDRESS=                          # Verified sender address, e.g. orders@yourdomain.com
EMAIL_FROM_NAME=                             # Display name, e.g. "Your Store Name"
ADMIN_BCC_EMAIL=                             # Optional — BCC address for order confirmation copies

# ── Cloudinary ──────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=                       # From Cloudinary Dashboard
CLOUDINARY_API_KEY=                          # From Cloudinary Dashboard
CLOUDINARY_API_SECRET=                       # From Cloudinary Dashboard

# ── OpenAI ──────────────────────────────────────────────────────────────────
OPENAI_API_KEY=                              # From platform.openai.com → API Keys (required for AI chatbot)
```

### 1.2 Frontend — Vercel Environment Variables

Set in **Vercel → Project → Settings → Environment Variables**, scope to **Production**:

```bash
VITE_STORE_ID=                               # MongoDB ObjectId of the default store shown on the homepage
VITE_PLATFORM_STORE_ID=                      # Same as PLATFORM_STORE_ID — determines admin sidebar mode
VITE_STRIPE_PUBLISHABLE_KEY=                 # pk_live_... (safe to expose — this is the public key only)
```

---

## 2. Database Setup

### 2.1 Create a MongoDB Atlas Production Cluster

1. Log in to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a new **Project** for production (keep it separate from development)
3. Build a **Dedicated Cluster** (M10 or higher recommended for production workloads)
   - Region: choose the same region as your Railway deployment for lowest latency
   - MongoDB version: 6.0 or later
4. Under **Database Access**, create a new database user:
   - Username: `prod_app_user`
   - Password: generate a strong random password (save it securely)
   - Role: **Read and write to any database**
5. Under **Network Access**, add the Railway deployment IP, or use `0.0.0.0/0` temporarily then narrow it after confirming the connection works

### 2.2 Get the Connection String

1. Click **Connect → Connect your application**
2. Select **Node.js** driver, version **4.1 or later**
3. Copy the connection string — it looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with the credentials from step 2.4
5. Set this as `MONGO_URI` in Railway's environment variables

### 2.3 Create Database Indexes

After the first deployment, run the index creation script once to ensure query performance:

```bash
# From the Railway shell, or locally pointing at the Atlas URI:
npx ts-node backend/src/scripts/create-indexes.ts
```

### 2.4 Data Migration (if applicable)

If migrating data from a previous MongoDB instance:

```bash
# Export from source
mongodump --uri="SOURCE_CONNECTION_STRING" --out=./dump

# Import to Atlas
mongorestore --uri="ATLAS_CONNECTION_STRING" ./dump
```

Verify document counts match after migration before switching traffic.

---

## 3. Backend Deployment — Railway

### 3.1 Initial Setup

1. Create a new Railway project at [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Railway will auto-detect Node.js and use the `package.json` start script
4. Confirm the build command is: `npm run build`
5. Confirm the start command is: `npm start` (or `node dist/server.js`)

### 3.2 Set Environment Variables

Add all backend variables from Section 1.1 via **Railway → Variables**.

### 3.3 Configure the Public Domain

1. Go to **Railway → Settings → Networking**
2. Click **Generate Domain** to get a `*.up.railway.app` URL
3. Copy this URL into the `BACKEND_URL` environment variable
4. For a custom domain (e.g. `api.yourdomain.com`), add it under **Custom Domain** and follow Railway's DNS instructions

### 3.4 Health Check

Once deployed, verify the backend is running:

```bash
curl https://YOUR-RAILWAY-URL/api/v1/health
# Expected response:
# { "status": "ok", "version": "2.0.0", "timestamp": "..." }
```

---

## 4. Frontend Deployment — Vercel

### 4.1 Initial Setup

1. Log in to [vercel.com](https://vercel.com)
2. Import the GitHub repository
3. Set the **Root Directory** to `client`
4. Vercel auto-detects Vite — confirm the build settings:
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Add all frontend variables from Section 1.2

### 4.2 Verify the Vercel Config

The `client/vercel.json` file handles SPA routing (all paths fall through to `index.html`). Verify it exists and is correct before deploying:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### 4.3 CORS Alignment

After Vercel assigns a production URL, add it to the backend's `CORS_ORIGINS` variable in Railway and redeploy the backend. Both the `*.vercel.app` URL and any custom domain must be included.

---

## 5. Domain & SSL

### 5.1 Frontend Custom Domain (Vercel)

1. In Vercel, go to **Project → Settings → Domains**
2. Add your domain (e.g. `www.yourdomain.com`)
3. Vercel provides two DNS options:
   - **Nameserver delegation** (recommended): point your domain's nameservers to Vercel's
   - **CNAME record**: add a CNAME from `www` to `cname.vercel-dns.com`
4. SSL is provisioned automatically by Vercel via Let's Encrypt — no manual steps required

### 5.2 Backend Custom Domain (Railway)

1. In Railway, go to **Settings → Networking → Custom Domain**
2. Add your API subdomain (e.g. `api.yourdomain.com`)
3. Add the CNAME record shown by Railway to your DNS provider
4. Railway provisions SSL automatically once DNS propagates (up to 24 hours)

### 5.3 SSL Verification

After DNS propagates, verify both domains have valid certificates:

```bash
# Should return HTTP 200 with a valid TLS handshake
curl -I https://yourdomain.com
curl -I https://api.yourdomain.com/api/v1/health
```

If SSL fails, check that the DNS records are correctly set and allow up to 24 hours for propagation.

---

## 6. Security Checklist

Complete every item on this list before accepting real user traffic or payments.

### 6.1 Rotate All Secrets

Every secret from the development environment must be regenerated. These values were used for development and must never be used in production:

- [ ] **JWT_ACCESS_SECRET** — generate a new 64-character random string:
  ```bash
  openssl rand -hex 32
  ```
- [ ] **JWT_REFRESH_SECRET** — generate separately with the same command
- [ ] **Stripe Secret Key** — regenerate at Stripe Dashboard → Developers → API Keys
- [ ] **Stripe Webhook Secret** — regenerate by deleting and recreating the webhook endpoint
- [ ] **Paymob API Key** — regenerate at Paymob Dashboard → Settings → API Key
- [ ] **Paymob Secret Key** — regenerate at Paymob Dashboard → Developers → Secret Key
- [ ] **Paymob HMAC Secret** — regenerate at Paymob Dashboard → Developers → HMAC Key
- [ ] **Cloudinary API Secret** — regenerate at Cloudinary Dashboard → Settings → Security
- [ ] **Resend API Key** — regenerate at resend.com → API Keys → Revoke old key → Create new

### 6.2 Environment Hardening

- [ ] `NODE_ENV=production` is set in Railway
- [ ] No `.env` files are committed to the repository (`git log -- "*.env"` returns empty)
- [ ] `JWT_ACCESS_EXPIRY=15m` (short-lived access tokens)
- [ ] `CORS_ORIGINS` only lists your actual production domains — no `localhost` entries
- [ ] The MongoDB Atlas cluster has IP allowlisting configured (not `0.0.0.0/0`)
- [ ] All Stripe and Paymob keys are **live** keys, not test keys

### 6.3 Resend Email Domain

- [ ] A real domain is verified in Resend (not `onboarding@resend.dev`)
- [ ] `EMAIL_FROM_ADDRESS` uses a real address under that verified domain (e.g. `orders@yourdomain.com`)

### 6.4 Admin Account

- [ ] The default super-admin account password has been changed from any development value
- [ ] The admin email is a real, monitored inbox — not a placeholder

---

## 7. Monitoring & Logging

### 7.1 Application Error Tracking — Sentry (Recommended)

Sentry captures unhandled exceptions in real time and groups them by root cause.

**Backend setup:**

```bash
cd backend
npm install @sentry/node @sentry/profiling-node
```

Initialize at the top of `src/server.ts`, before any other imports:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.2,  // capture 20% of transactions for performance monitoring
});
```

Add `SENTRY_DSN` (from sentry.io → Project → Settings → SDK Setup) to Railway variables.

**Frontend setup:**

```bash
cd client
npm install @sentry/react
```

Wrap the app in `src/main.tsx`:

```typescript
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
});
```

Add `VITE_SENTRY_DSN` to Vercel environment variables.

### 7.2 Uptime Monitoring — UptimeRobot (Free tier available)

1. Create a free account at [uptimerobot.com](https://uptimerobot.com)
2. Add an **HTTP(S)** monitor pointing to:
   ```
   https://YOUR-BACKEND-URL/api/v1/health
   ```
3. Set check interval to **5 minutes**
4. Configure email/SMS alerts for downtime events

This gives you immediate notification if the backend goes offline.

### 7.3 Railway Built-in Logs

Railway streams application logs in real time:

- Go to **Railway → Deployments → View Logs**
- All `logger.info`, `logger.warn`, and `logger.error` calls from the backend appear here
- Use the search/filter to isolate errors by level or keyword

For persistent log storage and search, consider forwarding logs to **Logtail** (free tier at betterstack.com) via Railway's log drain feature.

### 7.4 MongoDB Atlas Monitoring

Atlas provides built-in performance monitoring at no extra cost:

- **Performance Advisor**: identifies slow queries and suggests indexes
- **Real-Time Performance Panel**: live ops/second, connections, and query execution time
- **Alerts**: configure alerts for high connection count or slow operation thresholds

Access via Atlas Dashboard → **Monitoring**.

---

## 8. Post-Deployment Smoke Tests

Run these checks immediately after going live to confirm everything is connected:

| Test | Expected Result |
|------|----------------|
| `GET /api/v1/health` | `{ "status": "ok" }` with HTTP 200 |
| Register a new user account | Welcome email arrives in inbox |
| Log in with the new account | JWT access token issued, refresh cookie set |
| Browse products on the storefront | Products load, images display via Cloudinary |
| Add a product to cart | Cart persists across page refresh |
| Place a test order (Stripe) | Payment succeeds, order confirmation email arrives |
| Place a test order (Paymob) | Payment succeeds, order status updates to `processing` |
| Admin dashboard login | All metrics load, no console errors |
| Upload a product image | Image uploads to Cloudinary and displays correctly |

If any test fails, check Railway logs first, then the relevant third-party dashboard (Stripe, Paymob, Resend, Cloudinary) for error details.
