# Multi-Tenant E-Commerce Platform

A full-stack, multi-tenant SaaS e-commerce platform built with React, Node.js/Express, and MongoDB. Each tenant gets an isolated storefront, product catalog, order management, and analytics dashboard under a single deployment.

---

## 📚 Handover Documentation

If you are a new owner or developer taking over this project, start with these two guides before anything else:

| Document | Purpose |
|----------|---------|
| [PAYMENT_SETUP.md](./PAYMENT_SETUP.md) | Step-by-step guide to activating live Stripe and Paymob payments — prerequisites, API keys, webhook configuration |
| [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) | Full production deployment checklist — environment variables, MongoDB Atlas setup, domain/SSL, security hardening, and monitoring |

> ⚠️ Do not go live without completing the **Security Checklist** in `PRODUCTION_DEPLOYMENT.md` first. All secrets must be rotated before real traffic hits the system.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Redux Toolkit, React Query |
| Backend | Node.js, Express, TypeScript |
| Database | MongoDB (Mongoose), Redis (optional caching) |
| Payments | Stripe (global), Paymob (MENA) |
| Media | Cloudinary (image hosting & optimization) |
| Email | Resend (transactional email) |
| AI | OpenAI GPT (chatbot & product recommendations) |
| Deployment | Vercel (frontend), Railway (backend). `render.yaml` is an **alternative** backend blueprint — see the note at the top of that file before switching. |

---

## Project Structure

```
E-Commerce/
├── backend/                  # Express API server
│   ├── src/
│   │   ├── modules/          # Feature modules (auth, products, orders, payments, ...)
│   │   ├── middleware/        # Auth, rate limiting, validation, error handling
│   │   ├── services/          # Email, Cloudinary, cache
│   │   ├── config/            # Environment config validation (Zod)
│   │   └── utils/             # JWT, logger, response helpers
│   └── tests/                 # Property-based tests
├── client/                   # React frontend (Vite)
│   └── src/
│       ├── pages/             # Route-level page components
│       ├── components/        # Shared UI components
│       ├── store/             # Redux state (auth)
│       └── api/               # Axios client with token refresh
├── PAYMENT_SETUP.md          # 🔑 Payment gateway go-live guide
├── PRODUCTION_DEPLOYMENT.md  # 🚀 Production deployment checklist
├── CLOUDINARY_SETUP.md       # Image CDN configuration
├── AI_CHATBOT.md             # Chatbot feature documentation
└── AI_RECOMMENDATIONS.md     # Product recommendations documentation
```

---

## Local Development Setup

### Option A — Docker (recommended)

Brings up MongoDB, Redis, the API, and the web client with one command. No local
MongoDB or Redis install needed.

```bash
docker compose up --build
```

- Web client → http://localhost:8080
- API → http://localhost:5000
- Readiness probe → http://localhost:5000/api/v1/health/ready

Real secrets go in `backend/.env` (gitignored); Compose picks it up automatically
and it overrides the development defaults in `docker-compose.yml`.

> **Why the Mongo container runs as a replica set:** checkout uses
> `session.withTransaction()`, which requires one. A standalone `mongod` would
> silently fall through to the non-transactional code path locally and hide
> concurrency bugs that would then only surface in production.

To test Stripe card payments, pass a real publishable key at build time — Vite
inlines `VITE_*` during the build, not at runtime:

```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx docker compose up --build client
```

Without a valid key the checkout disables card payment rather than offering a
bypass (see `client/src/utils/checkoutMode.ts`).

### Option B — Run directly on the host

#### Prerequisites

- Node.js 18+
- MongoDB (local) or a MongoDB Atlas connection string
  — must be a replica set for checkout transactions; a standalone works but
  exercises the non-transactional fallback
- Redis (optional — the server degrades gracefully without it)

### 1. Clone and install dependencies

```bash
git clone <repository-url>
cd E-Commerce

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../client
npm install
```

### 2. Configure environment variables

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your local values

# Frontend
cp client/.env.example client/.env  # or create client/.env manually
```

The minimum required variables for local development are documented in `backend/.env.example`.

### 3. Start the development servers

```bash
# Terminal 1 — Backend (runs on http://localhost:5000)
cd backend
npm run dev

# Terminal 2 — Frontend (runs on http://localhost:5173)
cd client
npm run dev
```

### 4. Seed the database (optional)

```bash
cd backend
npx ts-node src/seed.ts
```

---

## Additional Documentation

| File | Contents |
|------|---------|
| [CLOUDINARY_SETUP.md](./CLOUDINARY_SETUP.md) | Image upload and optimization configuration |
| [AI_CHATBOT.md](./AI_CHATBOT.md) | AI chatbot feature setup and usage |
| [AI_RECOMMENDATIONS.md](./AI_RECOMMENDATIONS.md) | Product recommendation engine documentation |
| [IMAGE_OPTIMIZATION.md](./IMAGE_OPTIMIZATION.md) | Image optimization pipeline details |
| [REACT_QUERY_CACHING.md](./REACT_QUERY_CACHING.md) | Frontend caching strategy |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and solutions |
| [ROADMAP.md](./ROADMAP.md) | Planned features and development roadmap |
