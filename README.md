# 🛍️ Multi-Tenant E-Commerce SaaS Platform

A multi-tenant e-commerce platform where each vendor gets an isolated storefront, product catalogue, order pipeline, and analytics dashboard — all served from a single deployment.

Built with **React 18 + TypeScript** on the front end and **Node.js + Express + MongoDB** on the back end, the platform covers the commerce lifecycle it implements today: onboarding a store, listing products, taking payments through two gateways, moving orders through a status pipeline, and billing vendors on a subscription plan.

Tenancy is enforced at every layer. Stores are resolved per request from a hostname, header, or path; every query is scoped by `storeId`; and cross-tenant access is blocked by a JWT guard and covered by a dedicated isolation test suite.

Money is computed in one place. A single pure engine derives subtotal, discount, shipping, tax and grand total at checkout, and a matching engine prorates them back out on refund — so a quote, an invoice and a refund cannot disagree.

> **Status:** actively developed. A security, production-hardening, bug-fix, and UI/UX pass has been completed — see [Current Project Status](#-current-project-status) and [Known Limitations](#-known-limitations) for an honest account of what is and is not finished.

---

## 📑 Table of Contents

1. [Project Overview](#-project-overview)
2. [Main Features](#-main-features)
3. [Tech Stack](#-tech-stack)
4. [Architecture](#️-architecture)
5. [Folder Structure](#-folder-structure)
6. [Installation](#-installation)
7. [Environment Variables](#-environment-variables)
8. [Docker Usage](#-docker-usage)
9. [Local Development](#-local-development)
10. [Production Deployment](#-production-deployment)
11. [API Overview](#-api-overview)
12. [Authentication & Authorization](#-authentication--authorization)
13. [Security Improvements Completed](#-security-improvements-completed)
14. [Performance Improvements Completed](#-performance-improvements-completed)
15. [UI/UX Improvements Completed](#-uiux-improvements-completed)
16. [Testing Summary](#-testing-summary)
17. [Current Project Status](#-current-project-status)
18. [Known Limitations](#-known-limitations)
19. [Future Roadmap](#️-future-roadmap)
20. [Contributing](#-contributing)
21. [Author](#-author)

---

## 📋 Project Overview

This is a **SaaS storefront platform**, not a single shop. One deployment serves many vendors:

- A vendor signs up through public onboarding, which atomically creates a store and an owner account.
- Every API request resolves a store context before any tenant data is touched.
- Each store has its own catalogue, categories, carts, orders, coupons, reviews, newsletter list, and analytics.
- Vendors are billed on a subscription plan (`free` / `starter` / `pro` / `enterprise`) with limits enforced server-side.
- A platform operator (`super-admin`) can list every tenant, override plans, and impersonate a store for support.

The backend is a **modular monolith** in TypeScript (`strict` mode) with 23 feature modules. The frontend is a Vite-built React SPA with route-level code splitting, served either by nginx (Docker) or Vercel.

Which tenant a request belongs to is resolved from the **hostname** at runtime, so one build serves the platform on its own domain and the correct storefront on every merchant domain. There is no build-time store binding.

---

## ✨ Main Features

### Storefront & Commerce
- **Multi-tenant storefronts** — resolved at runtime from the **hostname** (custom domain or subdomain), or by path at `/s/:slug`. The platform's own domain serves the platform, not a shop — see [DOMAINS.md](DOMAINS.md)
- **Product catalogue** — nested categories, sizes, discounts, image galleries, ratings
- **Search & filtering** — regex substring search across name and description, category, price range, in-stock, on-sale, plus sorting and pagination
- **Cart** — per-store carts with size-aware line items and server-side price/stock validation
- **Checkout** — shipping address → delivery method → payment → confirmation, with every figure computed server-side
- **Shipping** — delivery zones by country, flat / free-over-threshold / price-tier rates, and a quote endpoint priced against the server-side cart
- **Tax** — destination-based rates with optional per-rate coverage of shipping, supporting both **tax-inclusive** (EU/UK/MENA) and **tax-exclusive** (US) pricing
- **Coupons** — percentage and fixed discounts, minimum order value, expiry, atomic usage limits
- **Orders** — two independent axes: fulfilment (`pending → processing → shipped → delivered`, `cancelled`) and payment (`unpaid → paid → partially_refunded → refunded`), so a delivered order can also be refunded
- **Refunds** — merchant-initiated, line-level, with discount and tax prorated across returned items; optional shipping refund and restocking
- **Wishlist** (with move-to-cart), **product comparison**, and **reviews** gated on a verified delivered purchase

### Payments
- **Stripe** — PaymentIntents with client-side confirmation and signature-verified webhooks
- **Paymob** — MENA gateway with HMAC-verified callbacks and a sandboxed hosted-iframe flow
- **Refund execution** — through the same provider abstraction as charges, with an atomic reservation on the order ledger so a gateway failure cannot leave an order looking refunded, and concurrent refunds cannot exceed the total
- **Refund reconciliation** — `charge.refunded` confirms refunds issued here *and* records ones a merchant made directly in the Stripe dashboard, so the ledger cannot drift from the gateway
- **Subscription billing** — Stripe-driven plan lifecycle with a 7-day dunning grace period before suspension, **enforced server-side**: a suspended store is read-only and a lapsed plan falls back to free limits
- **Reservation expiry** — abandoned online checkouts are auto-cancelled every 5 minutes and their stock released (cash-on-delivery orders are exempt)

### Vendor Dashboard
- **Analytics** — sales trends, AOV, conversion, category performance, customer metrics, today's metrics, revenue goal, recent orders (Recharts)
- **Inventory** — low-stock listing, bulk price/stock updates, bulk delete
- **Order management** — filtering, status transitions, bulk status/delete operations
- **Reports** — inventory, sales, and product-performance reports with CSV export
- **Store settings** — logo upload, contact details, social links, custom domain
- **Coupons, categories, newsletter, users, and pricing/plan pages**

### Platform Administration
- **Super Admin console** — tenant listing, plan overrides, pending upgrade-request queue
- **Store impersonation** — scoped token minting that re-reads the account from the database before issuing
- **Plan editor** — pricing/display configuration for the public plans page

### AI
- **Shopping assistant** — OpenAI function-calling with two store-scoped tools (`get_order_status`, `search_products`)
- **Rule-based fallback** — runs when no valid `OPENAI_API_KEY` is set, or when the OpenAI call fails. It matches both English and Arabic keywords, but **always replies in English**
- **Product recommendations** — related, trending, and personalised product surfaces

---

## 🧰 Tech Stack

Versions below are the declared ranges in `backend/package.json` and `client/package.json`.

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React + React DOM | `^18.2.0` | UI framework |
| TypeScript | `^5.3.3` | Type safety |
| Vite | `^5.1.3` | Build tool & dev server |
| Redux Toolkit / React Redux | `^2.2.1` / `^9.1.0` | Global state (auth, cart, wishlist, coupons, store, comparison, notifications) |
| TanStack React Query | `^5.100.9` | Server-state caching |
| React Router DOM | `^6.22.1` | Routing with lazy-loaded route chunks |
| Tailwind CSS | `^3.4.1` | Styling and dark mode |
| Framer Motion | `^11.1.7` | Animations and transitions |
| React Hook Form + Yup | `^7.51.0` / `^1.4.0` | Form state & validation |
| Recharts | `^2.12.2` | Dashboard charts |
| React Hot Toast | `^2.4.1` | Toast notifications |
| Axios | `^1.6.7` | HTTP client |
| date-fns | `^4.1.0` | Date formatting |
| Stripe JS / React Stripe JS | `^3.2.0` / `^2.6.2` | Card payment UI |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20 (Docker + CI) | Runtime |
| Express | `^4.18.2` | HTTP API |
| TypeScript | `^5.3.3` (`strict`) | Type safety |
| Mongoose | `^8.0.3` | MongoDB ODM |
| Zod | `^3.22.4` | Request validation & environment schema |
| Winston | `^3.11.0` | Structured logging |
| Helmet / CORS / express-rate-limit | `^7.1.0` / `^2.8.5` / `^7.1.5` | Security middleware |
| express-mongo-sanitize | `^2.2.0` | NoSQL injection sanitisation |
| node-cache | `^5.1.2` | In-process analytics caching |
| csv-stringify | `^6.7.0` | Report exports |
| Multer | `^1.4.5-lts.1` | Multipart upload handling (memory storage) |

### Data & Infrastructure
| Technology | Version | Purpose |
|---|---|---|
| MongoDB | `mongo:7` (Compose) | Primary datastore — replica set required for checkout transactions |
| Redis (optional) | `redis:7-alpine` via `ioredis ^5.3.2` | Refresh-token hashes are mirrored here, but **nothing reads them back** — see [Known Limitations](#-known-limitations). The server degrades gracefully when absent |
| Cloudinary | `^2.10.0` | Image hosting & CDN delivery |
| Sharp | `^0.35.3` | Server-side image optimisation |
| Resend | `6.12.4` | Transactional email |
| OpenAI API | HTTP (no SDK dependency) | Chatbot |

### Authentication & Payments
| Technology | Version | Purpose |
|---|---|---|
| jsonwebtoken | `^9.0.2` | 15-minute access tokens |
| bcryptjs | `^2.4.3` | Password hashing (12 rounds) |
| httpOnly cookies | — | Refresh-token transport |
| Stripe SDK | `^14.10.0` (API `2023-10-16`) | Card payments & subscriptions |
| Paymob | HTTP integration | MENA card & wallet payments |

### Testing & DevOps
| Technology | Version | Purpose |
|---|---|---|
| Jest + ts-jest | `^29.7.0` / `^29.1.1` | Backend test runner |
| Supertest | `^6.3.3` | HTTP integration tests |
| mongodb-memory-server | `^9.1.6` | Real MongoDB (incl. replica sets) in tests |
| fast-check | `^3.15.0` | Property-based testing |
| Vitest + React Testing Library + jsdom | `^1.6.1` / `^14.3.1` / `^24.1.3` | Frontend tests |
| Docker + Docker Compose | — | Local stack |
| GitHub Actions | `.github/workflows/ci.yml` | CI (type-check, lint, test, build) |
| ESLint + Prettier | `^8.56.0` / `^3.1.1` | Code quality |

---

## 🏗️ Architecture

The backend is a **modular monolith**. Each feature is a self-contained module following `routes → controller → service → model`, with a `repository` layer introduced in three modules so far (`cart`, `orders`, `products`).

```
Request
   │
   ├─ trust proxy · helmet · cors · cookie-parser · global rate limiter (300/min)
   │
   ├─ /api/v1/payments        ← mounted BEFORE the JSON parser
   │                             (webhooks need the raw body for signature/HMAC)
   │
   ├─ express.json · urlencoded · express-mongo-sanitize
   │
   ├─ Health                   /health (liveness) · /health/ready (readiness)
   │
   ├─ Global routes            /stores  /onboarding  /auth  /support  /plans
   │
   ├─ Platform routes          /admin/stores · /admin/stores/:id/plan
   │                           /admin/stores/pending-upgrades   → requireSuperAdmin
   │
   └─ Tenant router            resolveStore → authenticateJWT → authorizeRole
                               /auth /categories /products /cart /orders /reviews
                               /wishlist /admin /admin/analytics /admin/reports
                               /newsletter /recommendations /chatbot /coupons
```

**Tenant resolution order** (`middleware/resolveStore.ts`): `X-Store-ID` header → `X-Store-Slug` header → subdomain of the `Host` header (`www`, `api`, `admin`, `app` are ignored) → custom domain.

**Cross-tenant guard:** `authenticateJWT` compares the `storeId` claim against the resolved store. A mismatch is rejected unless the caller owns that store or is a Super Admin.

**Checkout integrity:** order creation runs inside a MongoDB transaction (`session.withTransaction()`) — cart validation, server-side pricing, coupon claim, stock decrement, and cart clearing either all succeed or all roll back. A non-transactional fallback exists for standalone MongoDB deployments.

**Ordering constraints worth knowing:**
- Payment routes are mounted **before** `express.json()` so webhook handlers get the raw `Buffer`. The two non-webhook payment routes apply their own JSON parsing and sanitisation.
- `express-mongo-sanitize` is registered **after** the body parsers; registered earlier it saw `req.body === undefined` and silently skipped it.
- Platform admin guards are attached **per route**, never via `router.use(...)`, so store admins are not locked out of their own tenant dashboards.

**Background jobs** (registered in `server.ts`, both `.unref()`-ed):
- Dunning job — every 60 minutes, suspends stores past due for more than 7 days
- Pending-order expiry — every 5 minutes, releases stock held by abandoned online checkouts

---

## 📁 Folder Structure

```
E-Commerce/
├── backend/
│   ├── src/
│   │   ├── modules/                  # 23 feature modules
│   │   │   ├── admin/                # Vendor dashboard + platform store management
│   │   │   ├── analytics/            # Sales trends, AOV, conversion, customer metrics
│   │   │   ├── auth/                 # Register, login, refresh, logout, password reset
│   │   │   ├── cart/                 # Per-store carts (has repository layer)
│   │   │   ├── categories/           # Nested category tree
│   │   │   ├── chatbot/              # OpenAI assistant + rule-based fallback
│   │   │   ├── checkout/             # Pure money engine (subtotal/discount/shipping/tax)
│   │   │   ├── coupons/              # Discount codes with atomic usage claims
│   │   │   ├── newsletter/           # Subscriber list & broadcasts
│   │   │   ├── onboarding/           # Public store + owner signup
│   │   │   ├── orders/               # Checkout, status pipeline, expiry sweep (has repository layer)
│   │   │   ├── payments/             # Stripe & Paymob adapters, webhooks, subscriptions
│   │   │   │   └── providers/        # Provider interface + factory
│   │   │   ├── plans/                # Plan display configuration
│   │   │   ├── products/             # Catalogue, bulk ops, image management (has repository layer)
│   │   │   ├── recommendations/      # Related, trending & personalised products
│   │   │   ├── refunds/              # Refund engine, ledger reservation, reconciliation
│   │   │   ├── reports/              # Inventory / sales / product-performance + CSV export
│   │   │   ├── reviews/              # Verified-purchase reviews
│   │   │   ├── shipping/             # Zones, rates, quote endpoint
│   │   │   ├── stores/               # Tenant CRUD, settings, token minting, plan capabilities
│   │   │   ├── support/              # Enterprise sales enquiries
│   │   │   ├── tax/                  # Destination-based tax rates
│   │   │   └── users/                # Wishlist
│   │   ├── middleware/               # authenticate, validate, rateLimiter, upload,
│   │   │                             # resolveStore, enforceSubscription,
│   │   │                             # errorHandler, notFound
│   │   ├── services/                 # cache, cloudinary, email, email.templates, image
│   │   ├── config/                   # env schema, database, redis, stripe, cloudinary, planLimits
│   │   ├── scripts/                  # Index migrations & maintenance tasks
│   │   ├── utils/                    # jwt, logger, response, escapeHtml, revenue
│   │   ├── app.ts                    # Express wiring
│   │   └── server.ts                 # Bootstrap, scheduled jobs, graceful shutdown
│   ├── tests/
│   │   ├── integration/              # 27 suites (Supertest + in-memory MongoDB)
│   │   └── properties/               # 4 suites (fast-check + unit)
│   └── Dockerfile
│
├── client/
│   ├── src/
│   │   ├── pages/                    # Route-level pages
│   │   │   ├── admin/                # Dashboard, products, orders, users, coupons,
│   │   │   │                         # categories, newsletter, settings, plans, platform stores
│   │   │   └── storefront/           # Public tenant storefront (home, product, cart, orders)
│   │   ├── components/               # Navbar, Footer, ProductCard, Chatbot, Skeleton, …
│   │   │   └── dashboard/            # Charts, metric grids, tables
│   │   ├── store/                    # Redux slices (auth, cart, wishlist, coupon,
│   │   │                             # comparison, store, notification)
│   │   ├── api/                      # Axios client + typed endpoints
│   │   ├── hooks/                    # useCart, useProducts, useDarkMode, useDebounce,
│   │   │                             # useNotifications, useTrialStatus
│   │   ├── contexts/                 # React context providers
│   │   ├── utils/                    # checkoutMode, paymobOrigin, format
│   │   └── types/                    # Shared TypeScript models
│   ├── nginx.conf
│   ├── vercel.json
│   └── Dockerfile
│
├── .github/workflows/ci.yml          # Backend + client: type-check · lint · test · build
├── docker-compose.yml                # Mongo (replica set) · Redis · API · Web
└── render.yaml                       # Alternative backend blueprint (not the active host)
```

---

## 🚀 Installation

### Prerequisites
- **Node.js 20+** (the Dockerfiles and CI both pin Node 20)
- **MongoDB** — a replica set is required for checkout transactions (Docker Compose provides one)
- **Redis** — optional; the server logs a warning and continues without it

### Clone and install

```bash
git clone https://github.com/osama-kamal/E-Commerce-.git
cd E-Commerce
```

```bash
cd backend && npm install
```

```bash
cd client && npm install
```

### Configure environment

```bash
cp backend/.env.example backend/.env
cp client/.env.example client/.env
```

Both templates list every variable the code actually reads, with the consuming file named against each one.

> ⚠️ **Do not blank a variable out by leaving it as `KEY=`.** An empty value counts as *present*, so the schema default does not apply. `MONGODB_URI=` and `ADMIN_NOTIFY_EMAIL=` fail validation and the server exits; `PORT=` parses to `NaN`. To take a default, leave the line commented out. Every defaulted variable ships commented out in the template for this reason.

---

## 🔐 Environment Variables

Backend variables are declared and validated by a Zod schema in [`backend/src/config/index.ts`](backend/src/config/index.ts). Validation failure exits the process; optional-but-important variables only log a warning. [`backend/.env.example`](backend/.env.example) and [`client/.env.example`](client/.env.example) mirror the tables below and name the consuming file for each variable.

> ⚠️ A blank `KEY=` is a *present* value, so the default does not apply — see the note under [Installation](#-installation). Comment the line out instead.

### Backend (`backend/.env`)

#### Core
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `5000` | HTTP port |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |

#### Database & Cache
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | Recommended | `mongodb://localhost:27017/ecommerce` | Connection string. Must be a replica set for checkout transactions. Falling back to the default logs a warning |
| `MONGO_URI` | No | — | Legacy alias; **overrides** `MONGODB_URI` when set. Prefer `MONGODB_URI` |
| `REDIS_URL` | No | `redis://localhost:6379` | Optional; startup continues if unreachable. Currently **write-only** — see [Known Limitations](#-known-limitations) |

#### Authentication
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | **Yes in production** | dev fallback | Access-token signing key — minimum 32 characters |
| `JWT_REFRESH_SECRET` | **Yes in production** | dev fallback | Refresh-token signing key — minimum 32 characters |
| `JWT_ACCESS_EXPIRY` | No | `15m` | Access-token lifetime |

#### Networking
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CORS_ORIGINS` | No | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |
| `FRONTEND_URL` | No | `http://localhost:5173` | Used in email links |
| `BACKEND_URL` | No | `http://localhost:5000` | Public URL for Paymob webhook callbacks |

#### Payments — Stripe
| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | **Effectively yes** | Optional in the Zod schema, but `config/stripe.ts` throws at import time when it is missing — and that module is on the startup path, so the API will not boot without it. CI and Compose both supply a placeholder |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Signature verification (`whsec_…`) |
| `STRIPE_PRICE_STARTER` | For billing | Price ID mapped to the Starter plan |
| `STRIPE_PRICE_PRO` | For billing | Price ID mapped to the Pro plan |
| `STRIPE_PRICE_ENTERPRISE` | For billing | Price ID mapped to the Enterprise plan |

#### Payments — Paymob (MENA)
| Variable | Required | Purpose |
|---|---|---|
| `PAYMOB_API_KEY` | **Yes for Paymob** | Account API key. The adapter throws `PAYMOB_API_KEY is not configured` without it |
| `PAYMOB_INTEGRATION_ID_CARD` | **Yes for Paymob** | Card integration ID, used to generate the payment key |
| `PAYMOB_HMAC_SECRET` | **Yes for Paymob** | HMAC-SHA512 verification of webhook callbacks |
| `PAYMOB_IFRAME_ID` | Recommended | Hosted iframe ID — **distinct** from the integration ID. Falls back to `PAYMOB_INTEGRATION_ID_CARD` when unset, which usually yields a broken iframe URL |
| `PAYMOB_SECRET_KEY` | ❌ Unused | Declared and warned about at startup, but never read by any code path |
| `PAYMOB_INTEGRATION_ID_WALLET` | ❌ Unused | Referenced only in a comment; wallet payments are not wired up |

#### Email
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | For email | — | Resend API key |
| `EMAIL_FROM_ADDRESS` | For email | — | Verified sender address |
| `EMAIL_FROM_NAME` | No | `Ecommerce Store` | Sender display name |
| `ADMIN_BCC_EMAIL` | No | — | BCC copy of order confirmations |
| `ADMIN_NOTIFY_EMAIL` | Recommended | — | Recipient for sales enquiries and plan-upgrade requests. **No fallback** — when unset these are logged, not emailed. Must be a valid email address |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_SECURE` / `EMAIL_USER` / `EMAIL_PASS` | ❌ Unused | `EMAIL_PORT=587`, `EMAIL_SECURE=false` | Legacy SMTP settings, kept in the schema but consumed by nothing. `nodemailer` is not a dependency; `email.service.ts` uses the Resend SDK exclusively. `EMAIL_USER` still triggers a startup warning |

#### Media
| Variable | Required | Purpose |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | For uploads | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | For uploads | API key |
| `CLOUDINARY_API_SECRET` | For uploads | API secret |

#### AI
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | No | — | Enables the AI assistant. Must start with `sk-` or `sk-proj-`, otherwise the rule-based fallback is used |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Chat completion model |

#### Behaviour Flags
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PENDING_ORDER_TTL_MINUTES` | No | `30` | Minutes before an abandoned online checkout is cancelled and its stock released. COD orders are never expired |
| `ALLOW_UNVERIFIED_REVIEWS` | No | `false` | Set `true` only for demo/seed environments. Leave unset in production so reviews require a delivered order |

### Frontend (`client/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | **Yes for card payments** | Stripe publishable key. Inlined at **build** time — without a valid key a production build disables card payment rather than offering a bypass (see `src/utils/checkoutMode.ts`) |
| `VITE_API_URL` | Local dev / Docker build | Backend URL for the Vite dev proxy |
| `VITE_DEV_STORE_SLUG` | No, **dev only** | Makes the root behave like one store's storefront on localhost. Ignored in any production build (`src/utils/devStoreOverride.ts`) |

These three are the complete set of `VITE_` variables the codebase reads.
`VITE_STRIPE_PUBLISHABLE_KEY` and `VITE_DEV_STORE_SLUG` are read by `src/`;
`VITE_API_URL` is read by `vite.config.ts`.

> **There is no production store variable.** `VITE_STORE_ID` and
> `VITE_STORE_SLUG` are gone. They bound the frontend to a single store at build
> time, which meant the platform's own domain served one hardcoded tenant. The
> tenant is now resolved at runtime from the hostname — see
> [DOMAINS.md](DOMAINS.md).

> A Stripe key counts as usable only when it starts with `pk_`, is longer than 30 characters, and does not contain `000000000000` (`src/utils/checkoutMode.ts`).

---

## 🐳 Docker Usage

| File | Purpose |
|---|---|
| [`backend/Dockerfile`](backend/Dockerfile) | Multi-stage `node:20-slim` build; runs as the non-root `node` user, `npm ci --omit=dev` at runtime, `HEALTHCHECK` on `/api/v1/health` |
| [`client/Dockerfile`](client/Dockerfile) | Vite build (`node:20-slim`) served by `nginx:1.27-alpine`; `HEALTHCHECK` via `wget` |
| [`client/nginx.conf`](client/nginx.conf) | SPA history fallback, immutable `/assets/` caching, no-cache `index.html`, `/api` proxy to `backend:5000`, security headers |
| [`docker-compose.yml`](docker-compose.yml) | Mongo 7 (single-node replica set) · Redis 7 · API · Web |

```bash
docker compose up --build
```

```bash
docker compose down -v
```

| Service | Host address |
|---|---|
| Web client | http://localhost:8080 |
| API | http://localhost:5000 |
| Liveness probe | http://localhost:5000/api/v1/health |
| Readiness probe | http://localhost:5000/api/v1/health/ready |
| MongoDB | `localhost:27017` (volume `mongo-data`) |
| Redis | `localhost:6379` (volume `redis-data`) |

The API container starts only once Mongo and Redis report healthy, and Compose sets `NODE_ENV=production` for it along with placeholder `JWT_*` secrets and a placeholder `STRIPE_SECRET_KEY` — without that last one the API cannot boot at all.

Secrets go in `backend/.env` — Compose loads it via `env_file` (marked `required: false`) and it overrides the development defaults declared inline.

> **Why the Mongo container runs as a replica set:** checkout uses `session.withTransaction()`, which requires one. A standalone `mongod` silently falls through to the non-transactional path and hides concurrency bugs that would then only appear in production. The Compose healthcheck initiates the replica set on first boot.

`VITE_*` variables are inlined at **build** time, so they are passed as build args:

```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx docker compose up --build client
```

No store variable is passed: one image serves the platform on the platform's
domain and the correct storefront on each tenant domain, resolved at runtime
from the hostname. On localhost every host is the platform, so reach a
storefront at `/s/<slug>`.

> Compose forwards only `VITE_STRIPE_PUBLISHABLE_KEY` to the client build. `client/Dockerfile` also accepts a `VITE_API_URL` build arg, but Compose does not pass it — the containerised client reaches the API through the nginx `/api` proxy instead.

---

## 💻 Local Development

### Option A — Docker (recommended)

`docker compose up --build`, as above. This is the only setup that gives you a MongoDB replica set out of the box.

### Option B — Run on the host

```bash
cd backend && npm run dev
```

```bash
cd client && npm run dev
```

The API listens on `:5000`; the Vite dev server on `:5173` and proxies `/api` and `/uploads` to `VITE_API_URL` (default `http://localhost:5000`).

### Database setup

Indexes are declared on the Mongoose schemas and created on boot.

```bash
cd backend && npm run create-indexes
```

```bash
cd backend && npm run seed
```

### Migrations

Mongoose adds missing indexes but **never drops obsolete ones**, and schema defaults apply on *create*, not on read — so documents written before a field existed keep coming back without it. These run once per environment.

**Index migrations**

```bash
cd backend && npm run migrate:payment-intent-index
```

```bash
cd backend && npm run migrate:order-idempotency-index
```

The first removes the obsolete unique index on `payments.stripePaymentIntentId` and reports orders left `pending` despite a succeeded payment. The second replaces the order idempotency index with a partial-filter version.

**Data backfills**

Each supports `--dry-run`, which reports what it would change and writes nothing. Run that first.

```bash
cd backend && npm run migrate:store-theme
cd backend && npm run migrate:trial-ends-at -- --dry-run
cd backend && npm run migrate:order-totals   -- --dry-run
cd backend && npm run migrate:payment-status -- --dry-run
```

| Script | Fills | Notes |
|---|---|---|
| `migrate:store-theme` | `store.theme` | Cosmetic — `resolveTheme()` already normalises missing values at read time |
| `migrate:trial-ends-at` | `store.trialEndsAt` | **Gates subscription enforcement.** Until it runs, stores read as un-migrated and are never restricted. Non-paid stores get a fresh grace window (default 14 days, `--days=N`) rather than `createdAt + 7d`, so nobody is evicted the moment it deploys |
| `migrate:order-totals` | `order.subtotal`, `shippingTotal`, `taxTotal` | Reconstructs `subtotal = totalAmount + discountAmount`. `totalAmount` is untouched, and with zero shipping and tax every historical revenue figure is unchanged — verify with `--dry-run` |
| `migrate:payment-status` | `order.paymentStatus`, `refundedTotal` | Classifies by succeeded-`Payment` evidence first, falling back to fulfilment state. Errs toward `paid`: marking a genuinely-paid order `unpaid` would make it unrefundable, whereas the reverse merely fails at the gateway |

### Maintenance scripts

```bash
cd backend && npm run optimize-images
```

```bash
cd backend && npm run update-images
```

**Identity diagnostics** — read-only, safe to run against production:

```bash
cd backend && npm run report:identity-collisions
```

Lists every email holding accounts in more than one store, marks which one login reaches, and separates accounts that were previously **shadowed and unreachable** from merchants who must now sign in at the platform host. Run it before or after switching login over — the affected users are worth knowing either way.

```bash
cd backend && npm run repair:owners
```

Consolidates duplicate *privileged* rows for one address onto a single owning account. Dry-runs by default; pass `--apply` to write, and it emits a rollback file.

### Available scripts

| Backend | Client |
|---|---|
| `npm run dev` · `build` · `start` | `npm run dev` · `build` · `preview` |
| `npm test` · `test:watch` | `npm test` · `test:watch` |
| `npm run lint` · `format` | `npm run lint` |
| `npm run seed` · `create-indexes` | — |
| `npm run migrate:*` · `report:*` · `repair:*` | — |
| `npm run optimize-images` · `update-images` | — |

---

## 🚢 Production Deployment

### Current topology

The frontend deploys to **Vercel** ([`client/vercel.json`](client/vercel.json)), which rewrites `/api/:path*` to a Railway-hosted backend and sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, and `Referrer-Policy` headers plus immutable caching for `/assets/`.

[`render.yaml`](render.yaml) is an **alternative** backend blueprint and is not the active host. If you deploy there instead, you must also update the Vercel rewrite destination, `CORS_ORIGINS`, and the payment webhook URLs. Vercel does not support environment interpolation in rewrite destinations, so that backend URL is hardcoded in `vercel.json`.

### Deployment checklist

```bash
cd backend && npm run migrate:payment-intent-index && npm run migrate:order-idempotency-index && npm run create-indexes
```

- [ ] Run the migrations above — Mongoose never drops obsolete indexes
- [ ] Set `NODE_ENV=production` and rotate every secret (`JWT_*` are **required** in production and must be ≥32 characters)
- [ ] Confirm MongoDB is a **replica set** — otherwise checkout silently uses the non-transactional fallback
- [ ] Set `ADMIN_NOTIFY_EMAIL`, or sales enquiries and upgrade requests are logged rather than emailed
- [ ] Set `VITE_STRIPE_PUBLISHABLE_KEY` at **build** time
- [ ] Leave `ALLOW_UNVERIFIED_REVIEWS` unset
- [ ] Point uptime monitoring at `/api/v1/health/ready`, not `/api/v1/health` (liveness is unconditional by design)
- [ ] Re-point Stripe and Paymob webhooks at the deployed host
- [ ] Enable automated database backups and rehearse a restore — **not currently documented or automated**
- [ ] Smoke test: register → cart → checkout → verify order and receipt

Full details: [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md).

---

## 📡 API Overview

All endpoints are versioned under `/api/v1`. Tenant-scoped routes require a store context header (`X-Store-ID` or `X-Store-Slug`), a tenant subdomain, or a custom domain.

### Health & global
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness — always 200 |
| `GET` | `/health/ready` | Readiness — 503 when MongoDB is unreachable; reports Redis but never fails on it |
| `POST` | `/onboarding` | Public store + owner signup (rate-limited) |
| `POST` | `/support/contact-sales` | Enterprise enquiry |
| `GET` | `/plans` | Public plan display config |
| `PUT` | `/plans/:planId` | Update plan display config — `super-admin` or `admin` |

### Authentication
| Method | Endpoint | Description |
|---|---|---|
Two surfaces, deliberately separate. A **shopper** authenticates against one store; a **merchant or operator** authenticates against their own account and picks a store afterwards.

| Method | Endpoint | Store context | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Required | Create a customer account in the resolved store |
| `POST` | `/auth/login` | **Required** | Customer sign-in, scoped strictly to `{ storeId, email }`. Returns **400** without a store rather than resolving globally |
| `POST` | `/auth/platform/login` | None | Merchant / operator sign-in. Considers only `admin` and `super-admin` accounts |
| `POST` | `/auth/refresh` | None | Rotate tokens via the httpOnly cookie |
| `POST` | `/auth/logout` | None | Revoke the refresh token |
| `POST` | `/auth/forgot-password` | Required | Request a reset link for an account in this store |
| `POST` | `/auth/reset-password/:token` | None | Complete a reset (clears all sessions) |

> **Why two endpoints.** Login used to resolve globally by email — preferring any super-admin, then any admin, then the oldest account of any role. Because `authRoutes` was mounted at `/api/v1/auth` *before* the tenant router, that global path ran for **every** login: a shopper's password on one store could authenticate an admin account on another, and, more often, a customer whose address collided with any other account could not sign in to their own store at all. The two route sets are now disjoint, so `/auth/login` falls through to the tenant mount and arrives with a resolved store.

### Stores
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stores/resolve?host=` | Which store (if any) serves a hostname. Returns `{ store: null }` with **200** for a platform host — that is the expected answer, not an error |
| `GET` | `/stores/current` | Resolve the active store + plan capabilities + subscription state |
| `GET` | `/stores/by-slug/:slug` | Public store lookup |
| `GET` | `/stores/mine` · `/stores/:id` | Stores owned by the caller |
| `POST` | `/stores` | Create a store (plan-limited) |
| `PUT` `DELETE` | `/stores/:id` | Owner update / delete |
| `PATCH` | `/stores/:id/settings` | Logo, contact details, social links |
| `POST` `GET` | `/stores/:id/logo` | Upload / fetch a store logo |
| `POST` | `/stores/:id/token` | Mint a store-scoped token (impersonation) |
| `POST` | `/stores/:id/upgrade-request` | Request a plan upgrade |
| `GET` | `/stores` | **Super Admin** — list all stores |
| `PATCH` | `/stores/:id/admin` | **Super Admin** — update any store |

### Catalogue & commerce
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/products` | List with search, filters, sorting, pagination |
| `GET` | `/products/:id` · `/products/:id/recommendations` | Detail and related products |
| `POST` `PUT` `DELETE` | `/products/…` | Admin CRUD, bulk update/delete, image management |
| `GET` `POST` `PUT` `DELETE` | `/cart` · `/cart/items/:productId` | Cart operations |
| `POST` `GET` | `/orders` · `/orders/:id` | Place an order (server-derived totals) and read history. Accepts `shippingRateId` — never an amount |
| `PUT` | `/orders/:id/cancel` | Cancel a pending order (restores stock) |
| `GET` `PUT` `DELETE` | `/orders/admin/all` · `/orders/admin/:id/status` · `/orders/admin/bulk/*` | Admin order management |
| `POST` | `/shipping/quote` | Delivery options **and** the full money breakdown for a destination, priced against the caller's own cart |
| `GET` `POST` `PUT` `DELETE` | `/shipping/zones` · `/shipping/rates` | Admin shipping configuration |
| `GET` `POST` `PUT` `DELETE` | `/tax/rates` | Admin tax rates. No public read — a shopper learns tax through a quote or an order |

### Refunds
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/orders/admin/:id/refunds/preview` | What a refund would return. Moves no money |
| `POST` | `/orders/admin/:id/refunds` | Issue a refund. Takes **which items**, never an amount — the server prices it from the order's stored breakdown |
| `GET` | `/orders/admin/:id/refunds` | Refund history for an order |

### Merchandising & engagement
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/coupons/validate` | Validate a discount code (rate-limited) |
| `GET` `POST` `PUT` `DELETE` | `/coupons` | Admin coupon CRUD |
| `GET` `POST` `DELETE` | `/reviews/products/:productId` | Read, submit, delete reviews |
| `GET` `POST` `DELETE` | `/wishlist` · `/wishlist/:productId` · `/wishlist/:productId/move-to-cart` | Wishlist management |
| `GET` | `/recommendations/trending` · `/recommendations/personalized` | Recommendation surfaces |
| `POST` | `/chatbot/chat` | AI assistant (optional auth, rate-limited) |
| `POST` `GET` | `/newsletter/subscribe` · `/unsubscribe` · `/subscribers` · `/stats` · `/send` | Newsletter |

### Payments
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/payments/intent` | Create a Stripe PaymentIntent |
| `POST` | `/payments/paymob/initiate` | Start a Paymob session |
| `POST` | `/payments/webhook` | Stripe webhook (signature verified, idempotent). Handles `charge.refunded`, which also reconciles refunds made in the Stripe dashboard |
| `POST` | `/payments/paymob/webhook` | Paymob webhook (HMAC verified) |

### Dashboard & platform
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/dashboard` · `/admin/top-products` · `/admin/low-stock` | Vendor overview |
| `GET` `PUT` | `/admin/users` · `/admin/users/:id/status` · `/admin/users/:id/role` | Customer management |
| `GET` | `/admin/orders` | Vendor order list |
| `GET` | `/admin/analytics/sales-trends` · `category-performance` · `customer-metrics` · `aov-metrics` · `conversion-metrics` · `today-metrics` · `recent-orders` · `revenue-goal` | Metrics and charts |
| `GET` | `/admin/reports/inventory` · `/sales` · `/product-performance` (+ `/export` variants) | CSV exports |
| `GET` | `/admin/stores` | **Super Admin** — all tenants |
| `PATCH` | `/admin/stores/:id/plan` | **Super Admin** — override a plan |
| `GET` | `/admin/stores/pending-upgrades` | **Super Admin** — upgrade queue |

> There is no OpenAPI/Swagger specification yet — the tables above are maintained by hand from the route files.

---

## 🔑 Authentication & Authorization

### Token model

| Token | Lifetime | Storage | Notes |
|---|---|---|---|
| Access token | 15 minutes (`JWT_ACCESS_EXPIRY`) | Client memory / store | Carries `userId`, `role`, and `storeId` claims |
| Refresh token | Server-enforced expiry | **httpOnly** cookie | SHA-256 hashed at rest, rotated on use, capped at 10 concurrent sessions per user (`$slice: -10`) |

Password reset clears every stored refresh token for that user. Legacy bcrypt-hashed refresh records are still recognised for backward compatibility.

### Roles

`admin` means *administrator of one store*, never a platform operator. Cross-tenant endpoints are guarded by a dedicated `requireSuperAdmin` middleware rather than a role list; `authorizeRole` lets `super-admin` bypass role restrictions.

| Capability | Customer | Admin (Store Owner) | Super Admin |
|---|:---:|:---:|:---:|
| Browse catalogue, cart, checkout | ✅ | ✅ | ✅ |
| Own orders, wishlist, reviews | ✅ | ✅ | ✅ |
| Manage own store's products & categories | ❌ | ✅ | ✅ |
| Manage own store's orders & customers | ❌ | ✅ | ✅ |
| Store analytics & CSV reports | ❌ | ✅ | ✅ |
| Store settings, logo, coupons, newsletter | ❌ | ✅ | ✅ |
| Create additional stores | ❌ | ✅ (plan-limited) | ✅ |
| Access **another** tenant's data | ❌ | ❌ | ✅ |
| List every store on the platform | ❌ | ❌ | ✅ |
| Override any store's subscription plan | ❌ | ❌ | ✅ |
| Impersonate a store | ❌ | ❌ | ✅ |

Placing an order requires authentication (`POST /orders` is behind `authenticateJWT`), so **guest checkout is not supported**.

### One definition of revenue

```
revenue = totalAmount − tax − refunds
```

counted when an order is **paid**, not when it is fulfilled.

| Component | Treatment | Why |
|---|---|---|
| Goods + discounts | included, net | What was actually sold |
| Shipping charged | **included** | Real revenue offsetting a real carrier cost |
| Tax | **excluded** | Collected for a revenue authority and remitted — a liability, never income |
| Refunds | **subtracted** | Money returned was never earned |

Recognition keys on `paymentStatus`, not fulfilment status. That is what makes a card sale and a cash sale count identically: a cash-on-delivery order counts when the merchant marks it paid, not the moment it is placed. A paid order that is later cancelled still counts — it stops counting when it is *refunded*.

Both sides of the subtraction are on the same basis. `refundedTotal` is gross, so the order also tracks `refundedTaxTotal`; without it a fully-refunded order reports **negative** revenue.

> **This replaced four disagreeing definitions.** The dashboard summed succeeded `Payment.amount`, which excludes every cash-on-delivery sale because COD creates no payment row. Two product tables summed list prices, so a coupon never reduced them. Analytics summed `totalAmount − taxTotal`. None subtracted refunds — a merchant could refund an entire order and watch reported revenue not move.
>
> Everything now goes through [`utils/revenue.ts`](backend/src/utils/revenue.ts). Payments are reconciliation only; `tenant-first-aggregation.test.ts` asserts revenue is never derived from them again.

Safe to deploy before `migrate:payment-status`: an order with no `paymentStatus` falls back to the old fulfilment rule, so historical figures are identical until the backfill runs.

### Tenant-first aggregation

Every aggregation in a tenant-scoped service must filter by `storeId` in its **first** stage, and must not `$lookup` another collection before doing so.

The dashboard's revenue query used to match `{ status: 'succeeded' }` with no tenant filter, join the entire orders collection, and only then filter by store. Its *output* was correctly scoped — nothing leaked — but every merchant's dashboard load did platform-wide work, and filtering tenancy last means one careless edit turns a slow query into a cross-tenant disclosure.

`tenant-first-aggregation.test.ts` scans the source and fails CI on the shape. Deliberate platform-wide sweeps (the abandoned-checkout job) are listed explicitly with a reason.

### Identity is per-store

The unique index on users is `{ storeId, email }`, not `{ email }` — so one address legitimately holds **separate accounts in separate stores**. Somebody can shop at two unrelated shops with the same email, or own one store and buy from another.

Authentication honours that:

- **Storefront login** resolves only within the store being signed into. There is no cross-store fallback, and no password from another tenant will work.
- **Platform login** considers only privileged accounts, and never a customer.

Where one address holds several *privileged* rows — possible historically, because a repeat signup could mint another admin — platform login ranks them (super-admin, then an admin that owns a store, then oldest) and tries each until a password matches, so no merchant identity is shadowed by another. Run `npm run repair:owners` to consolidate those rows, and `npm run report:identity-collisions` to see which addresses are affected before changing anything.

### Subscription plans

Enforced server-side from [`backend/src/config/planLimits.ts`](backend/src/config/planLimits.ts).

| | Free | Starter | Pro | Enterprise |
|---|:---:|:---:|:---:|:---:|
| Products | 15 | 500 | Unlimited | Unlimited |
| Orders / month | 50 | 500 | Unlimited | Unlimited |
| Stores | 1 | 3 | 10 | Unlimited |
| Custom domain | — | ✅ | ✅ | ✅ |
| Remove branding | — | — | ✅ | ✅ |
| API access¹ | — | — | ✅ | ✅ |

¹ Declared on the plan and surfaced to the client, but **not enforced** — the platform has no API-key mechanism to gate.

---

## 🔒 Security Improvements Completed

Each item below is implemented in the current codebase and, where noted, pinned by a test suite.

| Area | What was done |
|---|---|
| **Refresh-token storage** | Tokens are SHA-256 hashed server-side, rotated on use, expiry-filtered, and capped at 10 concurrent sessions. Suite: `refresh-token` |
| **Refresh-token transport** | httpOnly cookies — never exposed to JavaScript |
| **Password hashing** | bcrypt at 12 rounds (`BCRYPT_ROUNDS = 12`) |
| **Cross-tenant isolation** | Every query scoped by `storeId`; a JWT store-claim mismatch is rejected. Suite: `tenant-isolation`, `tenant-scoped-indexes` |
| **Platform authorisation** | Dedicated `requireSuperAdmin` for cross-tenant endpoints, attached per route so store admins keep access to their own dashboards. Suites: `platform-admin-authz`, `store-token-minting` |
| **Token minting** | Re-reads the account from the database before issuing, so deactivation and role demotion take effect immediately instead of being chained forward |
| **Input validation** | Zod schemas on body, params, and query, with the parsed result written back so unknown keys are stripped before handlers run. Suites: `validate-middleware`, `bulk-endpoint-validation`, `cart-size-validation` |
| **NoSQL injection** | `express-mongo-sanitize` moved to run **after** the body parsers — previously it saw `req.body === undefined` and skipped every request body. Suite: `nosql-sanitization` |
| **Payment integrity** | Order totals and discounts computed server-side; coupon claims atomic via a single `findOneAndUpdate` with `$inc`; Stripe signatures and Paymob HMACs verified before processing; webhook handling deduplicated by `stripeEventId`. Suites: `webhook-idempotency`, `order-discount`, `coupon-max-uses`, `payment-provider`, `paymob-provider` |
| **Webhook raw body** | Payment routes mounted before `express.json()` so signature verification sees the unconsumed stream |
| **Review verification** | Verified-purchase enforcement is now opt-**out** via an explicit `ALLOW_UNVERIFIED_REVIEWS` flag. It was previously derived from `NODE_ENV`, so a host that forgot to set it let anyone review any product |
| **Rate limiting** | Global 300/min plus dedicated budgets: auth 10/15min (successful requests skipped), signup 5/hour, AI chat 30/15min, coupon validation 20/15min, and an email-sending limiter. Suite: `rate-limits` |
| **Email safety** | All user-controlled values HTML-escaped before interpolation into email bodies. Suite: `email-html-escaping` |
| **Hardcoded recipient removed** | Platform notifications now require `ADMIN_NOTIFY_EMAIL`; a personal address was previously hardcoded as a fallback in two files, silently forwarding new deployments' sales leads |
| **Transport & headers** | Helmet, CORS allow-list with explicit methods/headers, `trust proxy` for correct client IPs behind Railway; nginx and Vercel both set `nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy` |
| **Payment iframe sandboxing** | The Paymob iframe uses `allow-top-navigation-by-user-activation` rather than unrestricted top navigation, closing a phishing primitive. Origin checking is unit-tested (`paymobOrigin`) |
| **Checkout key handling** | A production build with a missing or malformed publishable key **disables** card payment instead of falling through to a bypass. Suite: `checkoutMode` |
| **Uploads** | MIME allow-list (JPEG/PNG/WebP/GIF), 10 MB cap, memory storage streamed straight to Cloudinary — no disk writes |
| **Secrets in production** | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are required and must be ≥32 characters when `NODE_ENV=production`; dev fallbacks are unavailable there |
| **Dependencies** | `npm audit --omit=dev` reports **0 vulnerabilities** in backend production dependencies (verified) |

---

## ⚡ Performance Improvements Completed

| Area | What was done |
|---|---|
| **O(1) refresh-token lookup** | SHA-256 exact match replaced a sequential bcrypt scan across a user's stored sessions |
| **Route-level code splitting** | 33 lazy-loaded route chunks in `App.tsx` |
| **Vendor chunk splitting** | `manualChunks` separates react, redux, react-query, recharts, forms, and stripe bundles for better cache hit rates |
| **Tenant-scoped compound indexes** | Hot queries lead with `storeId`; a dedicated index serves the cross-tenant expiry sweep. Suite: `tenant-scoped-indexes` |
| **Analytics caching** | Per-tenant in-process `node-cache` with per-metric TTLs (10-minute default) |
| **Paginated reads** | Products, orders, users, and reviews are paginated, with a single `Promise.all` for page + count |
| **Lean queries & field projection** | List endpoints use `.lean()` with explicit `.select(...)` projections |
| **Image pipeline** | Sharp optimisation plus Cloudinary CDN delivery |
| **Deferred non-critical fetches** | `requestIdleCallback` (with a `setTimeout` fallback) keeps wishlist hydration off the critical path |
| **React Query caching** | 10-minute stale time, 30-minute garbage-collection time |
| **Immutable asset caching** | Hashed `/assets/` filenames cached for a year in both nginx and Vercel; `index.html` explicitly never cached |
| **Interaction responsiveness** | A blanket 500 ms colour transition on `*`, `*::before`, `*::after` was removed — see the next section |

---

## 🎨 UI/UX Improvements Completed

### Theme switching
- The global 500 ms colour transition applied to `*`, `*::before`, and `*::after` made **every** hover, focus ring, link state, and table highlight take half a second to settle. It is now scoped to a `.theme-transition` class that `useDarkMode` adds only for the 300 ms of an actual theme switch, then removes.
- The fade is skipped on first mount, so the app no longer cross-fades on every page load.
- `@media (prefers-reduced-motion: reduce)` drops the transition duration to `0ms`.
- The pending timer is cleared on unmount so the class can never be toggled after teardown.
- Pinned by 9 regression tests in `client/src/hooks/useDarkMode.test.ts`.

### Design tokens
- The `primary` colour scale was missing shades `200`, `300`, `400`, `800`, and `900` while those shades were referenced 41 times across the app (`ring-primary-200`, `text-primary-400`, `dark:bg-primary-900/20`, …). Tailwind emits no CSS for an undefined shade, so those elements rendered with **no colour at all** — most visibly on focus rings and dark-mode surfaces. The scale is now complete; the five pre-existing shades are unchanged, so brand identity is preserved exactly.

### Accessibility (forms)
Applied to the login, register, forgot-password, reset-password, checkout, store-onboarding, and admin (categories, coupons, new store, products, settings) forms:
- Every input has an `id` and its label a matching `htmlFor`, so labels are clickable and announced correctly.
- Validation messages carry `role="alert"` and are wired to their input via `aria-invalid` and `aria-describedby`.
- Hint text (`0 = unlimited uses`, `Leave blank for no expiry`) is associated with `aria-describedby` rather than floating unlabelled.
- `autoComplete` tokens added throughout — `email`, `current-password`, `new-password`, `name`, `organization`, and the WHATWG shipping-address set (`address-line1`, `address-level1`/`2`, `postal-code`, `country-name`) — so browsers and password managers can fill forms.
- The store-category picker is now a `<fieldset>`/`<legend>` radio group instead of unrelated tiles.
- Decorative content (emoji icons, `/categories/` and `shophub.com/` prefixes) is marked `aria-hidden="true"`; social inputs carry explicit `aria-label`s.
- The password visibility toggle exposes `aria-label` and `aria-pressed`.

> This was a **forms-focused** pass. Global focus management, skip links, and a contrast audit are still outstanding — see [Known Limitations](#-known-limitations).

---

## 📸 Screenshots

> **Screenshots will be added after the final UI/UX polish.**
>
> No images are committed to the repository yet, and none are referenced here. Once the interface is final, screenshots will be added to a `docs/screenshots/` directory and linked from this section.

---

## 🧪 Testing Summary

```bash
cd backend && npm test
```

```bash
cd client && npm test
```

### Backend

**536 tests across 43 suite files — 526 passing, 10 failing** (verified with `npm test` in `backend/`; ~235 s wall time). Integration suites run Supertest against a real in-memory MongoDB, with replica sets where transactions are involved; property-based and pure-unit suites use `fast-check` or plain Jest. Jest runs with `--runInBand`.

| | Passed | Failed | Total |
|---|---:|---:|---:|
| Suites | 40 | 3 | 43 |
| Tests | 526 | 10 | 536 |

| Area | Suites |
|---|---|
| Multi-tenant isolation | `tenant-isolation`, `tenant-scoped-indexes`, `login-tenant-scope`, `tenant-first-aggregation` |
| Host → store resolution | `host-resolution` |
| Platform authorisation | `platform-admin-authz`, `store-token-minting` |
| Subscription enforcement | `subscription-enforcement` |
| Money engine (pure) | `money-engine`, `refund-math` |
| Revenue definition | `revenue-definition` |
| Tax & shipping at checkout | `tax-shipping-checkout` |
| Refunds | `refunds` |
| Checkout pricing & coupons | `order-discount`, `coupon-max-uses`, `order-currency` |
| Inventory correctness | `stock-lifecycle`, `pending-order-expiry` |
| Payments & webhooks | `webhook-idempotency`, `payment-provider`, `paymob-provider`, `subscription-lifecycle` |
| Sessions | `refresh-token` |
| Input validation | `validate-middleware`, `bulk-endpoint-validation`, `nosql-sanitization`, `cart-size-validation` |
| Reviews & search | `review-verified-purchase`, `reviews-and-search` |
| Plan enforcement | `plan-limits` |
| Rate limiting | `rate-limits` |
| Data integrity | `onboarding-atomicity`, `order-idempotency-index` |
| Email safety | `email-html-escaping`, `email-branding-unit`, `email-branding.property`, `email-preservation.property` |
| Health probes | `health-readiness` |
| Image pipeline | `image-service` |
| Scaffolding | `scaffolding.property` |

> **Known baseline: the backend suite does not run green on a clean checkout.** Compare against **10 failing / 526 passing** rather than expecting an all-green run. The failures fall into two unrelated groups, and neither is a product defect:
>
> - **`email-branding-unit` + `email-branding.property` (7 failures)** — every assertion is `expect(mockSendMail).toHaveBeenCalled()` receiving zero calls. The transport moved from nodemailer to the Resend SDK; the mock was removed but the assertions that depended on it were left in place, so they can no longer pass. **This is a real coverage hole, not just noise** — those tests existed to pin that transactional emails carry the *tenant's* store name rather than a hardcoded default, and that property is currently unverified.
> - **`scaffolding.property` (3 failures)** — the suite never connects `mongodb-memory-server`, so `resolveStore` buffers for 10 s per request and the `fast-check` runs exceed Jest's 30 s timeout. A harness problem, not an assertion failure.
>
> Related: `resolveStore` runs before the 404 handler, so **any** request to an unmatched path costs a database round-trip. Visible in that suite's logs as `stores.findOne()` timeouts on `/api/v1/nonexistent`, and worth fixing on its own merits.
>
> **`plan-limits` is date-fragile.** Its "previous month" case seeds orders with `setMonth(getMonth() - 1)`, which overflows on the 29th–31st (June 31 → July 1) and lands them inside the current month. It fails on roughly three days a month and passes the rest.
>
> Jest also reports that it "did not exit one second after the test run has completed" — an async handle is not torn down. Results are unaffected.

### Frontend

**115 tests across 10 files — all passing** (verified with `npm test` in `client/`):

| File | Tests | Covers |
|---|---:|---|
| `components/Modal.test.tsx` | 23 | Focus trap, Escape/backdrop close, ARIA wiring |
| `utils/paymobOrigin.test.ts` | 21 | Paymob postMessage origin validation |
| `utils/checkoutMode.test.ts` | 14 | Publishable-key resolution and card-payment gating |
| `tenant-routing.test.tsx` | 10 | Storefront checkout stays in-tenant; scoped axios follows the slug; cart cache is namespaced |
| `site-mode.test.tsx` | 10 | Platform vs storefront resolution; failure falls back to platform, never a guessed tenant |
| `utils/format.test.ts` | 9 | Currency and value formatting |
| `hooks/useDarkMode.test.ts` | 9 | Theme-switch fade scoping and cleanup |
| `store/logout.test.ts` | 7 | Logout / session teardown |
| `hooks/useTrialStatus.test.ts` | 7 | Trial state read from the server, never recomputed from `createdAt` |
| `routing.remount.test.tsx` | 5 | Per-route layout wrapping and remount behaviour |

> **Still thin where it matters most.** There is no end-to-end test of browse → cart → checkout → order, so the highest-risk path in the product is covered only by its backend units. That gap is what allowed the storefront checkout to resolve against the wrong tenant undetected.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs two jobs (backend and client) on pushes and PRs to `master`/`main`, each doing **install → type-check → lint → test → build** on Node 20 with npm caching and in-flight run cancellation.

> **Lint is advisory.** Both lint steps are marked `continue-on-error: true` until the existing lint debt is cleared, so a lint failure does not fail CI. Type-check, test, and build **do** gate.

---

## ✅ Current Project Status

This project is **feature-complete for its core commerce flows and hardened, but not certified production-ready.** The table below reflects the verified state of the repository.

| Area | Status | Detail |
|---|---|---|
| Type safety | ✅ | `strict` TypeScript on both tiers; `tsc --noEmit` gates CI |
| Core commerce flows | ✅ | Catalogue, cart, checkout, orders, coupons, reviews, wishlist |
| Multi-tenancy | ✅ | Enforced at query, token, index and **login** level; covered by tests |
| Payments | ✅ | Stripe + Paymob, both with verified webhooks |
| Subscription billing | ✅ | Plan lifecycle with 7-day dunning |
| Security hardening | ✅ | See [Security Improvements Completed](#-security-improvements-completed) |
| Performance pass | ✅ | See [Performance Improvements Completed](#-performance-improvements-completed) |
| Containerisation | ✅ | Non-root backend image, health checks, full Compose stack |
| Health probes | ✅ | Separate liveness and readiness endpoints |
| Structured logging | ✅ | Winston, JSON in production |
| Graceful shutdown | ✅ | SIGTERM/SIGINT with connection draining and a 10 s force-exit guard |
| Dependency vulnerabilities | ✅ | 0 in backend production dependencies |
| CI | ⚠️ Partial | Type-check/test/build gate; **lint is advisory** |
| Backend test suite | ⚠️ Partial | 526/536 passing; 10 known failures on a clean checkout (7 stale email-branding, 3 harness) |
| Accessibility | ⚠️ Partial | Forms remediated; focus management and contrast audit outstanding |
| Repository layer | ⚠️ Partial | Present in 3 of 23 modules (`cart`, `orders`, `products`) |
| `.env.example` files | ✅ | Both synchronised with the code; every variable names its consuming file |
| Env schema hygiene | ⚠️ Partial | 7 of 39 schema variables are declared but consumed by nothing (see limitation 10) |
| Error tracking | ❌ | Not configured |
| Backup strategy | ❌ | Not documented or automated |
| API specification | ❌ | No OpenAPI/Swagger contract |
| Shipping & tax | ✅ | Zones, rates, destination tax; inclusive and exclusive pricing |
| Refunds | ✅ | Line-level, tax-prorated, ledger-reserved, webhook-reconciled |
| Payment vs fulfilment state | ✅ | Separate axes — a delivered order can also be refunded |
| Subscription enforcement | ✅ | Server-side gate; suspended stores are read-only. **Inert until `migrate:trial-ends-at` runs** |
| Tenant resolution | ✅ | Runtime, host-based. No build-time store binding |
| Returns (RMA) workflow | ❌ | Merchant-initiated refunds only; no customer-facing return request |
| Disputes / chargebacks | ❌ | `charge.dispute.created` is not subscribed to |
| End-to-end tests | ❌ | No browse → checkout → order coverage |

---

## ⚠️ Known Limitations

Stated plainly so nobody discovers these the hard way:

1. **The backend test suite is not green on a clean checkout.** 10 of 536 tests fail across 3 of 43 suites — 7 stale email-branding assertions orphaned by the Resend migration (a real coverage hole: per-tenant email branding is currently unverified) and 3 harness timeouts in `scaffolding.property`. A known baseline, not a fresh regression. `plan-limits` is additionally date-fragile and fails on the 29th–31st of a month.
2. **Lint does not gate CI.** Both lint steps are `continue-on-error: true` pending a cleanup of existing lint debt.
3. **Shipping and tax are implemented but unconfigured out of the box.** A store with no zones charges no delivery and accepts every destination; a store with no tax rates charges no tax. Both are deliberate defaults, but a merchant must set them up before the features do anything.
4. **Refunds are merchant-initiated only, and `migrate:payment-status` must run first.** An order with no `paymentStatus` reads as `unpaid` and is refused as unrefundable.
5. **Inventory is a single scalar per product.** Sizes exist on the catalogue, but per-variant stock cannot be represented.
6. **No guest checkout.** `POST /orders` requires authentication.
7. **`apiAccess` is declared but unenforced.** Pro and Enterprise plans advertise it; there is no API-key mechanism to gate.
8. **Accessibility is partially remediated.** The forms pass is done; global focus management, skip links, and a contrast audit are not.
9. **Redis is write-only.** `auth.service.ts` writes a refresh-token hash to Redis on login and deletes it on logout, but no code path ever reads one back — MongoDB is the sole source of truth for validating a refresh token. Running Redis currently buys no functional benefit.
10. **Seven environment variables are declared but consumed by nothing.** `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS` (legacy SMTP — `nodemailer` is not even a dependency), `PAYMOB_SECRET_KEY`, and `PAYMOB_INTEGRATION_ID_WALLET`. `EMAIL_USER` and `PAYMOB_SECRET_KEY` still appear in the startup "optional env vars not set" warning, which is misleading.
11. **`PAYMOB_IFRAME_ID` has a misleading fallback.** When unset, the adapter substitutes `PAYMOB_INTEGRATION_ID_CARD` into the iframe URL. The two IDs are different values, so this generally produces a broken iframe rather than a clear error.
12. **Blank environment values break startup.** An empty `KEY=` is a present value, so schema defaults do not apply: `MONGODB_URI=` and `ADMIN_NOTIFY_EMAIL=` fail validation and exit, and `PORT=` parses to `NaN`. Comment lines out instead.
13. **Paymob mobile-wallet payments are not implemented** — only the card integration is wired up.
14. **The rule-based chatbot fallback quotes a return policy the platform does not implement** — a 30-day return window is a hardcoded response string. Refunds are now real (merchant-initiated, line-level), but there is no customer-facing *returns* workflow behind that promise.
15. **The chatbot fallback is not truly bilingual.** It recognises Arabic keywords but always answers in English.
16. **`PUT /plans/:planId` accepts `admin` as well as `super-admin`** by design, so the frontend works with a store-scoped token during platform sessions. The stricter guard lives on the client route.
17. **The Vercel rewrite target is hardcoded** to a Railway URL in `client/vercel.json`, because Vercel does not interpolate environment variables in rewrite destinations.
18. **Subdomain and custom-domain storefronts need DNS and TLS that do not exist yet.** Host resolution is implemented and tested, but a wildcard record plus certificate (and per-domain verification for custom domains) must be provisioned before either addressing form does anything. Until then every host resolves to platform mode and `/s/<slug>` is the working route — see [DOMAINS.md](DOMAINS.md).
19. **Custom domains are not ownership-verified.** `customDomain` is currently an operator-set field; there is no challenge proving the merchant controls the domain before the platform serves it.
20. **No customer-facing returns (RMA) workflow.** Merchants can issue line-level refunds from the admin, and out-of-band refunds made in the Stripe dashboard are reconciled — but a customer cannot request a return, and there is no approval queue or return-shipping step.
21. **Chargebacks and disputes are not handled.** `charge.dispute.created` is not subscribed to, so a disputed payment is invisible to the platform.
22. **Paymob refunds settle asynchronously and are not reconciled.** The refund is submitted and recorded as `pending`; unlike Stripe there is no callback handler to confirm it, so the status stays pending until someone checks the Paymob dashboard.
23. **No error tracking and no documented backup/restore procedure.**
24. **No OpenAPI specification** — the API tables in this README are hand-maintained.

---

## 🗺️ Future Roadmap

Ordered roughly by how much each unblocks:

- **Green test baseline** — restore the orphaned email-branding coverage (per-tenant branding is currently unverified), connect the DB in `scaffolding.property`, and fix the date-fragile `plan-limits` case. Gating on a red suite teaches everyone to ignore it
- **DNS & TLS for tenant domains** — a wildcard record and certificate, plus per-domain verification, before subdomain or custom-domain storefronts do anything (see [DOMAINS.md](DOMAINS.md))
- **Error tracking & backups** — Sentry (or equivalent) plus an automated, rehearsed restore procedure. Nothing currently reports a production failure
- **Store-deletion cascade** — deleting a store leaves its products, orders, users and carts orphaned; no export, no erasure path
- **Notifications** — the client's notification feed is simulated on a timer. Build it or remove it; the current state invents stock warnings
- **Returns (RMA)** — customer-initiated return requests on top of the existing refund engine
- **Disputes** — subscribe to `charge.dispute.created`; a chargeback is currently invisible
- **Per-variant inventory** — stock per size rather than a single scalar, which also unblocks variant-level refunds
- **Guest checkout** — order placement without an account
- **Abandoned-cart recovery** — the cart data and the mailer both already exist
- **SEO** — per-page metadata, structured data, sitemaps; storefronts are currently invisible to search
- **Accessibility completion** — focus management, skip links, and a contrast audit
- **API keys** — required before the `apiAccess` plan flag can mean anything
- **OpenAPI specification** — a machine-readable contract to replace the hand-written tables here
- **Repository layer** — extend from 3 modules to all 23
- **Env schema cleanup** — drop the 7 unconsumed variables, or wire up the features they imply (SMTP fallback, Paymob wallet payments)
- **Redis read path** — either validate refresh tokens against Redis or stop writing to it
- **Lint debt cleanup** — so the CI lint steps can stop being advisory

See [ROADMAP.md](./ROADMAP.md) for additional feature-level planning.

---

## 🤝 Contributing

There is no `CONTRIBUTING.md` in this repository yet. Until there is, the working expectations are:

1. Branch from `master`.
2. Keep the modular structure — new backend features go in `backend/src/modules/<feature>/` as `routes → controller → service → model`, adding a `repository` where data access is non-trivial.
3. Validate every request with a Zod schema through the `validate` middleware. Note that it writes the parsed result back, so undeclared fields are stripped before handlers see them.
4. Scope every tenant query by `storeId`, and add a test if the change touches isolation, payments, or stock.
5. Run the same checks CI does before opening a PR:

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test && npm run build
```

```bash
cd client && npx tsc --noEmit && npm run lint && npm test && npm run build
```

6. Compare test results against the known baseline described in [Testing Summary](#-testing-summary) — do not treat the pre-existing email-branding failures as your regression, and do not add to them.

---

## 📄 License

**No license file is present in this repository.** There is no `LICENSE` or `LICENCE` file at any level, so no open-source terms are granted. All rights are reserved by the author unless and until a license is added.

---

## 👤 Author

**Osama Kamal**

- 📧 hamroushosama5@gmail.com
- 🔗 [github.com/osama-kamal](https://github.com/osama-kamal)

---

## 📚 Additional Documentation

| Document | Contents |
|---|---|
| [PAYMENT_SETUP.md](./PAYMENT_SETUP.md) | Activating live Stripe and Paymob payments |
| [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) | Full deployment checklist and hardening |
| [CLOUDINARY_SETUP.md](./CLOUDINARY_SETUP.md) | Image CDN configuration |
| [IMAGE_OPTIMIZATION.md](./IMAGE_OPTIMIZATION.md) | Image pipeline details |
| [AI_CHATBOT.md](./AI_CHATBOT.md) | Chatbot architecture and tools |
| [AI_RECOMMENDATIONS.md](./AI_RECOMMENDATIONS.md) | Recommendation engine |
| [REACT_QUERY_CACHING.md](./REACT_QUERY_CACHING.md) | Client caching strategy |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and fixes |
| [ROADMAP.md](./ROADMAP.md) | Feature roadmap |
