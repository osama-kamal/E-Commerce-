# Payment Setup Guide — Test to Live

This guide covers everything needed to move the platform from test/sandbox payment credentials to fully live, production-ready payment processing. It applies to both Stripe (global card payments) and Paymob (MENA region payments).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Stripe — Going Live](#2-stripe--going-live)
3. [Paymob — Going Live](#3-paymob--going-live)
4. [Updating Environment Variables](#4-updating-environment-variables)
5. [Verifying the Integration](#5-verifying-the-integration)

---

## 1. Prerequisites

Before activating live payments, ensure the following are in place:

### Business & Legal
- [ ] Registered business entity (LLC, sole proprietorship, or equivalent)
- [ ] Valid government-issued ID for the account owner
- [ ] Business bank account with routing/IBAN details
- [ ] Proof of address (utility bill or bank statement, dated within 3 months)
- [ ] Business website with visible Terms of Service and Privacy Policy pages
- [ ] Clearly displayed return/refund policy on the storefront

### Technical
- [ ] Production domain with HTTPS/SSL active (Stripe and Paymob reject non-HTTPS webhook URLs)
- [ ] Backend deployed to Railway (or equivalent) with the production `BACKEND_URL` set
- [ ] All environment variables updated in Railway's environment settings — **never** committed to git

---

## 2. Stripe — Going Live

### 2.1 Activate Your Stripe Account

1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Click **Activate your account** in the top banner
3. Complete the identity verification form:
   - Business type, legal name, and address
   - Bank account details for payouts
   - Owner personal ID verification
4. Wait for Stripe's review (usually instant; sometimes 1–2 business days)

### 2.2 Retrieve Live API Keys

1. In the Stripe Dashboard, toggle the switch from **Test mode** to **Live mode** (top-right)
2. Go to **Developers → API keys**
3. Copy the following:

| Key | Where it goes |
|-----|--------------|
| **Secret key** (starts with `sk_live_`) | `STRIPE_SECRET_KEY` in backend `.env` |
| **Publishable key** (starts with `pk_live_`) | `VITE_STRIPE_PUBLISHABLE_KEY` in `client/.env` |

> ⚠️ The secret key is shown only once. Store it immediately in your secrets manager or Railway environment variables.

### 2.3 Configure the Live Webhook

1. In Stripe Dashboard (Live mode), go to **Developers → Webhooks**
2. Click **Add endpoint**
3. Set the endpoint URL to:
   ```
   https://YOUR-PRODUCTION-BACKEND-DOMAIN/api/v1/payments/stripe/webhook
   ```
4. Under **Select events to listen to**, add:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. On the webhook detail page, click **Reveal signing secret**
7. Copy the value (starts with `whsec_`) into `STRIPE_WEBHOOK_SECRET` in your backend environment

### 2.4 Configure Stripe Subscription Price IDs (if using subscription billing)

1. In Stripe Dashboard (Live mode), go to **Products**
2. Create products for each plan (Starter, Pro, Enterprise)
3. Under each product, create a recurring price
4. Copy each **Price ID** (starts with `price_`) into the corresponding env var:

```
STRIPE_PRICE_STARTER=price_live_xxxxxxxxxx
STRIPE_PRICE_PRO=price_live_xxxxxxxxxx
STRIPE_PRICE_ENTERPRISE=price_live_xxxxxxxxxx
```

---

## 3. Paymob — Going Live

### 3.1 Activate Your Paymob Account

1. Log in to [accept.paymob.com](https://accept.paymob.com)
2. Navigate to **Settings → Account Info**
3. Submit the business activation form with:
   - Commercial registration number
   - Tax card number
   - Bank account details
   - Owner national ID
4. Paymob's compliance team will review and activate your account (1–5 business days)

### 3.2 Retrieve Live API Keys

1. Once activated, go to **Settings → API Key**
2. Copy the **API Key** — this is a long Base64-encoded string
3. Go to **Developers → Secret Key** and copy the **Secret Key** (starts with `egy_sk_live_`)
4. Go to **Developers → HMAC Key** and copy the **HMAC Secret**

| Key | Where it goes |
|-----|--------------|
| API Key | `PAYMOB_API_KEY` |
| Secret Key | `PAYMOB_SECRET_KEY` |
| HMAC Secret | `PAYMOB_HMAC_SECRET` |

### 3.3 Create Live Payment Integrations

1. Go to **Developers → Payment Integrations**
2. Create a new integration for **Card Payments** (live)
3. Copy the **Integration ID** into `PAYMOB_INTEGRATION_ID_CARD`
4. If using mobile wallets, create a wallet integration and set `PAYMOB_INTEGRATION_ID_WALLET`

### 3.4 Create a Live Iframe

1. Go to **Developers → Iframes**
2. Create a new iframe linked to your live card integration
3. Copy the **Iframe ID** (a numeric value) into `PAYMOB_IFRAME_ID`

> ⚠️ The Iframe ID is different from the Integration ID. Do not confuse the two.

### 3.5 Configure the Live Webhook

Paymob sends a POST callback to your backend after each transaction.

1. Go to **Developers → Transactions Processed Callback**
2. Set the URL to:
   ```
   https://YOUR-PRODUCTION-BACKEND-DOMAIN/api/v1/payments/paymob/webhook
   ```
3. Ensure **HMAC verification** is enabled — the backend validates every callback using `PAYMOB_HMAC_SECRET`

---

## 4. Updating Environment Variables

All keys must be set as environment variables on your hosting platform — **never** hardcode them in source files or commit them to git.

### Backend — Railway

Navigate to your Railway project → **Variables** and set:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_live_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE
STRIPE_PRICE_STARTER=price_live_YOUR_ID_HERE
STRIPE_PRICE_PRO=price_live_YOUR_ID_HERE
STRIPE_PRICE_ENTERPRISE=price_live_YOUR_ID_HERE

# Paymob
PAYMOB_API_KEY=YOUR_LIVE_API_KEY_HERE
PAYMOB_SECRET_KEY=egy_sk_live_YOUR_KEY_HERE
PAYMOB_HMAC_SECRET=YOUR_HMAC_SECRET_HERE
PAYMOB_INTEGRATION_ID_CARD=YOUR_INTEGRATION_ID_HERE
PAYMOB_IFRAME_ID=YOUR_IFRAME_ID_HERE
```

### Frontend — Vercel

Navigate to your Vercel project → **Settings → Environment Variables** and set:

```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE
```

---

## 5. Verifying the Integration

After deploying with live keys, perform a low-value real transaction to verify end-to-end flow:

### Stripe Verification
1. Use a real card with a small amount (e.g., $1.00)
2. Confirm the payment appears in Stripe Dashboard (Live mode) under **Payments**
3. Confirm your backend received the `payment_intent.succeeded` webhook (check Railway logs)
4. Confirm the order status updated to `processing` in the admin dashboard

### Paymob Verification
1. Complete a test purchase using a live card
2. Confirm the transaction in Paymob Dashboard under **Transactions**
3. Confirm the HMAC-verified callback reached your backend (check Railway logs)
4. Confirm the order status updated correctly

### Webhook Health Check
Monitor webhook delivery in both dashboards:
- **Stripe**: Developers → Webhooks → your endpoint → **Recent deliveries**
- **Paymob**: Developers → Transactions Processed Callback → delivery logs

Any failed deliveries (non-200 response) will show up there with full request/response bodies for debugging.
