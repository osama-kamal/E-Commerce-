# Vendbase — Product Roadmap

This file tracks all planned features that are **not yet implemented**.
Update the status column as each item is completed.
Do not remove completed items — move their status to ✅ Done and add a completion date.

---

## How to use this file

| Status | Meaning |
|---|---|
| 🔲 Pending | Not started |
| 🔄 In Progress | Currently being worked on |
| ✅ Done | Implemented and merged |

---

## Phase 1 — Billing & Infrastructure

| # | Feature | Status | Notes |
|---|---|---|---|
| 1.1 | **Automated Stripe subscription billing lifecycle** | 🔲 Pending | Handle `customer.subscription.created/updated/deleted` webhooks, auto-activate/expire plans, dunning logic for failed payments |
| 1.2 | **Custom domains per tenant** | 🔲 Pending | Allow store owners to map their own domain (e.g. `shop.mybrand.com`) to their storefront. Requires SSL provisioning (Let's Encrypt / Caddy) |
| 1.3 | **Production subdomain routing** | 🔲 Pending | Route `{slug}.vendbase.com` to the correct tenant storefront at the infrastructure level. Currently header-based only |

---

## Phase 2 — Security & Access Control

| # | Feature | Status | Notes |
|---|---|---|---|
| 2.1 | **Two-factor authentication (2FA)** | 🔲 Pending | TOTP-based (Google Authenticator / Authy), backup codes, opt-in per user. Consider `otpauth` or `speakeasy` library |
| 2.2 | **Audit logs and activity tracking** | 🔲 Pending | Store user-action events (login, product edit, order status change, plan upgrade) in a dedicated `AuditLog` collection. Viewable by store admin |
| 2.3 | **Granular role-based permissions** | 🔲 Pending | Add `staff` and `store-manager` roles with scoped permissions (e.g. staff can manage orders but not billing). Currently only `admin` / `user` exist |

---

## Phase 3 — Merchant Experience

| # | Feature | Status | Notes |
|---|---|---|---|
| 3.1 | **Theme customization (colors, fonts, branding)** | 🔲 Pending | Per-tenant theme settings stored in store settings: primary color, font family, logo, favicon. Applied via CSS variables at storefront runtime |
| 3.2 | **CMS / custom pages / blog management** | 🔲 Pending | Allow merchants to create static pages (About, FAQ, Policy) and blog posts. Basic rich-text editor (Tiptap or Quill), stored as markdown or HTML |
| 3.3 | **SEO system** | 🔲 Pending | Per-page meta title/description, Open Graph tags, auto-generated XML sitemap (`/sitemap.xml`), `robots.txt` per tenant, JSON-LD structured data for products |

---

## Phase 4 — Operations & Logistics

| # | Feature | Status | Notes |
|---|---|---|---|
| 4.1 | **Shipping provider integrations and order tracking** | 🔲 Pending | Integrate at least one provider (Aramex, Bosta, EasyPost, or Shiprocket). Generate shipping labels, push tracking numbers to orders, notify customers of updates |
| 4.2 | **Tax calculation and PDF invoice generation** | 🔲 Pending | Configurable tax rules per store (VAT, flat rate). Auto-calculate tax at checkout. Generate downloadable PDF invoices per order (use `pdfkit` or `puppeteer`) |

---

## Phase 5 — Notifications

| # | Feature | Status | Notes |
|---|---|---|---|
| 5.1 | **SMS / WhatsApp notifications** | 🔲 Pending | Order confirmation and status updates via SMS (Twilio/Vonage) or WhatsApp Business API. Opt-in at checkout. Configurable per store |

---

## Phase 6 — Reporting & Analytics

| # | Feature | Status | Notes |
|---|---|---|---|
| 6.1 | **Advanced exportable reports (CSV / PDF)** | 🔲 Pending | Export sales, orders, customer, and inventory reports as CSV or PDF from the admin dashboard. Date-range filtering already exists — wire up export endpoints |

---

## Phase 7 — Platform Extensibility

| # | Feature | Status | Notes |
|---|---|---|---|
| 7.1 | **Public API for third-party developers** | 🔲 Pending | API key management per store, developer portal / docs (Swagger/Redoc), stable versioned endpoints (`/api/v2/...`), rate limiting per key |
| 7.2 | **Outbound webhooks and external integrations** | 🔲 Pending | Allow merchants to register webhook URLs for platform events (`order.created`, `order.status_changed`, `product.updated`, etc.). Signed payloads, retry logic, delivery logs |

---

## Completed Features (reference)

> Move items here when done, with the completion date.

| Feature | Completed |
|---|---|
| Multi-tenant store isolation | ✅ Core platform |
| JWT auth with refresh token rotation | ✅ Core platform |
| Subscription plan limits enforcement | ✅ Core platform |
| Email notifications (Brevo) | ✅ Core platform |
| Product / order / cart / category management | ✅ Core platform |
| Image optimization via Cloudinary | ✅ Core platform |
| CDN support (Cloudinary + Vercel) | ✅ Core platform |
| Redis caching layer | ✅ Core platform |
| Per-store analytics dashboard | ✅ Core platform |
| AI chatbot (OpenAI) | ✅ Core platform |
| AI product recommendations | ✅ Core platform |
| Newsletter management | ✅ Core platform |
| Coupon / discount system | ✅ Core platform |
| Wishlist and product comparison | ✅ Core platform |
| Stripe payment integration (manual activation) | ✅ Partial — auto billing pending (1.1) |
| Enterprise lead-capture form | ✅ Added June 2026 |

---

_Last updated: June 2026_
