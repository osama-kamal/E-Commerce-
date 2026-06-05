# Implementation Plan: E-Commerce Platform

## Overview

Incremental implementation of the e-commerce platform backend (Node.js/Express/TypeScript/MongoDB) and React frontend. Each task builds on the previous, ending with full integration. Testing tasks are sub-tasks placed close to the code they validate.

---

## Tasks

- [x] 1. Project scaffolding and configuration
  - Initialize Node.js/TypeScript project with Express, Mongoose, and core dependencies
  - Set up ESLint, Prettier, and tsconfig
  - Configure environment variable loading (dotenv) with a validated config module
  - Set up MongoDB connection with retry logic
  - Set up Redis client connection
  - Create the base Express app with global middleware: helmet, cors, express-rate-limit, express-mongo-sanitize, express.json()
  - Add `/api/v1/health` endpoint returning service status and version
  - Set up Jest, Supertest, and mongodb-memory-server for testing
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.2, 10.6_

  - [ ]* 1.1 Write property test: security headers on every response
    - **Property 23: Security Headers on Every Response**
    - **Validates: Requirements 9.5**

  - [ ]* 1.2 Write property test: NoSQL injection sanitization
    - **Property 24: NoSQL Injection Sanitization**
    - **Validates: Requirements 9.4**

- [x] 2. User model and authentication
  - [x] 2.1 Create User Mongoose schema and model
    - Fields: email (unique, indexed), passwordHash, role (enum), isActive, refreshTokens array, passwordResetToken, passwordResetExpires
    - _Requirements: 1.8, 2.1_

  - [x] 2.2 Implement Auth_Service: register, login, refresh, logout
    - bcrypt password hashing (cost factor 12)
    - RS256 JWT signing (15-min expiry) with userId and role claims
    - Refresh token generation (64-byte hex), bcrypt hash storage in Redis with 7-day TTL
    - Refresh token rotation: invalidate old token on use
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 9.6_

  - [ ]* 2.3 Write property test: authentication round trip
    - **Property 1: Authentication Round Trip**
    - **Validates: Requirements 1.1, 1.3, 1.5**

  - [ ]* 2.4 Write property test: password storage is never plaintext
    - **Property 2: Password Storage is Never Plaintext**
    - **Validates: Requirements 1.8**

  - [ ]* 2.5 Write property test: logout invalidates refresh token
    - **Property 3: Logout Invalidates Refresh Token**
    - **Validates: Requirements 1.7**

  - [ ]* 2.6 Write property test: JWT expiry within 15 minutes
    - **Property 25: JWT Expiry Within 15 Minutes**
    - **Validates: Requirements 9.6**

  - [ ]* 2.7 Write unit tests for auth edge cases
    - Duplicate email registration → 409
    - Invalid credentials → 401
    - Expired/invalid refresh token → 401
    - _Requirements: 1.2, 1.4, 1.6_

  - [x] 2.8 Implement password reset flow
    - Generate SHA-256 hashed reset token, store with 1-hour expiry in user document
    - Email sending via configured email service (mocked in tests)
    - Reset endpoint validates token, updates passwordHash, clears token
    - _Requirements: 1.9, 1.10_

  - [ ]* 2.9 Write unit tests for password reset edge cases
    - Expired reset token → 400
    - _Requirements: 1.10_

- [ ] 3. Authentication middleware and RBAC
  - [ ] 3.1 Implement authenticateJWT middleware
    - Verify RS256 signature and expiry
    - Attach decoded userId and role to request context
    - Return 401 for missing, malformed, tampered, or expired tokens
    - _Requirements: 2.2, 2.4, 2.5, 2.6_

  - [ ] 3.2 Implement authorizeRole middleware
    - Accept one or more allowed roles
    - Return 403 if authenticated user's role is not in allowed list
    - _Requirements: 2.3_

  - [ ]* 3.3 Write property test: invalid auth always returns 401
    - **Property 4: Invalid Auth Always Returns 401**
    - **Validates: Requirements 2.2, 2.5, 2.6**

  - [ ]* 3.4 Write property test: customer cannot access admin endpoints
    - **Property 5: Customer Cannot Access Admin Endpoints**
    - **Validates: Requirements 2.3**

  - [ ] 3.5 Implement request validation middleware using Zod
    - Schema validation for all request bodies
    - Return 422 with per-field error details on failure
    - Validate Content-Type header on POST/PUT requests
    - _Requirements: 9.8, 10.4_

  - [ ]* 3.6 Write property test: validation errors return 422 with field details
    - **Property 27: Validation Errors Return 422 with Field Details**
    - **Validates: Requirements 10.4**

  - [ ]* 3.7 Write property test: consistent error response shape
    - **Property 26: Consistent Error Response Shape**
    - **Validates: Requirements 10.3**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Category and Product modules
  - [x] 5.1 Create Category Mongoose schema and model
    - Fields: name, slug (unique), parentId (self-ref), level
    - _Requirements: 3.10_

  - [x] 5.2 Implement Category CRUD endpoints (Admin-protected)
    - GET /api/v1/categories — list all with children
    - POST /api/v1/categories — create (Admin)
    - PUT /api/v1/categories/:id — update (Admin)
    - DELETE /api/v1/categories/:id — delete (Admin)
    - _Requirements: 3.10_

  - [ ]* 5.3 Write property test: hierarchical category structure
    - **Property (from 3.10): Category hierarchy preserved**
    - For any parent/child category pair, the child's parentId should reference the parent's _id and level should be parent.level + 1
    - **Validates: Requirements 3.10**

  - [x] 5.4 Create Product Mongoose schema and model
    - Fields: name (text index), description (text index), price, stock, categoryId, images, isDeleted
    - Compound index: { isDeleted: 1, categoryId: 1, price: 1 }
    - _Requirements: 3.1, 3.5, 3.6_

  - [x] 5.5 Implement Product CRUD endpoints
    - GET /api/v1/products — list with filter (category, price range, availability), full-text search, pagination
    - GET /api/v1/products/:id — single product
    - POST /api/v1/products — create (Admin), returns 201
    - PUT /api/v1/products/:id — partial update (Admin)
    - DELETE /api/v1/products/:id — soft-delete (Admin)
    - POST /api/v1/products/:id/images — image upload (Admin), returns public URL
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 5.6 Write property test: catalog returns only active products
    - **Property 6: Catalog Returns Only Active Products**
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 5.7 Write property test: product filter correctness
    - **Property 7: Product Filter Correctness**
    - **Validates: Requirements 3.5**

  - [ ]* 5.8 Write property test: pagination invariant
    - **Property 8: Pagination Invariant**
    - **Validates: Requirements 3.7, 8.3**

  - [ ]* 5.9 Write property test: out-of-stock indicator
    - **Property 9: Out-of-Stock Indicator**
    - **Validates: Requirements 3.8**

- [x] 6. Shopping Cart module
  - [x] 6.1 Create Cart Mongoose schema and model
    - Fields: customerId (unique, indexed), items array (productId, quantity, priceSnapshot)
    - _Requirements: 4.1, 4.7_

  - [x] 6.2 Implement Cart endpoints (Customer-protected)
    - GET /api/v1/cart — retrieve cart with current prices and computed subtotal
    - POST /api/v1/cart/items — add item (check stock > 0)
    - PUT /api/v1/cart/items/:productId — update quantity (remove if quantity = 0)
    - DELETE /api/v1/cart/items/:productId — remove item
    - DELETE /api/v1/cart — clear cart
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 6.3 Write property test: cart subtotal invariant
    - **Property 10: Cart Subtotal Invariant**
    - **Validates: Requirements 4.5**

  - [ ]* 6.4 Write property test: cart reflects current price
    - **Property 11: Cart Reflects Current Price**
    - **Validates: Requirements 4.6**

  - [ ]* 6.5 Write property test: cart ownership invariant
    - **Property 12: Cart Ownership Invariant**
    - **Validates: Requirements 4.7**

  - [ ]* 6.6 Write unit tests for cart edge cases
    - Add out-of-stock product → 400
    - Update quantity to 0 removes item
    - _Requirements: 4.2, 4.3_

- [x] 7. Order module
  - [x] 7.1 Create Order Mongoose schema and model
    - Fields: customerId (indexed), items (with price/name snapshots), totalAmount, status (indexed), paymentIntentId, shippingAddress
    - _Requirements: 5.1, 5.3_

  - [x] 7.2 Implement order placement service
    - Validate all items have sufficient stock
    - Atomically: create order (status: pending), decrement stock for each item, clear cart
    - Use MongoDB transactions for atomicity
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 7.3 Implement Order endpoints
    - POST /api/v1/orders — place order from cart
    - GET /api/v1/orders — customer's own order history
    - GET /api/v1/orders/:id — single order (ownership enforced)
    - PUT /api/v1/orders/:id/cancel — cancel pending order (Customer)
    - GET /api/v1/orders/admin/all — all orders paginated (Admin)
    - PUT /api/v1/orders/admin/:id/status — update status (Admin)
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 7.4 Write property test: order placement atomicity
    - **Property 13: Order Placement Atomicity**
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 7.5 Write property test: order ownership invariant
    - **Property 14: Order Ownership Invariant**
    - **Validates: Requirements 5.6, 5.7, 5.8**

  - [ ]* 7.6 Write property test: valid order status transitions
    - **Property 15: Valid Order Status Transitions**
    - **Validates: Requirements 5.5**

  - [ ]* 7.7 Write unit tests for order edge cases
    - Insufficient stock → 400, no order created
    - Cancel non-pending order → 400
    - _Requirements: 5.2, 5.10_

- [ ] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Payment module
  - [x] 9.1 Create Payment Mongoose schema and model
    - Fields: orderId (indexed), customerId, stripePaymentIntentId (unique), amount, currency, status, stripeEventId
    - _Requirements: 6.4, 6.6_

  - [x] 9.2 Implement payment intent creation endpoint
    - POST /api/v1/payments/intent — create Stripe PaymentIntent, return client secret
    - _Requirements: 6.1_

  - [x] 9.3 Implement Stripe webhook handler
    - POST /api/v1/payments/webhook — validate Stripe signature, process payment_intent.succeeded and payment_intent.payment_failed events
    - Idempotency: check stripeEventId before processing, skip if already handled
    - On success: update order to "processing", create Payment record
    - On failure: retain order in "pending"
    - _Requirements: 6.2, 6.3, 6.5, 6.6_

  - [ ]* 9.4 Write property test: webhook idempotency
    - **Property 16: Webhook Idempotency**
    - **Validates: Requirements 6.6**

  - [ ]* 9.5 Write property test: no raw card data in storage
    - **Property 17: No Raw Card Data in Storage**
    - **Validates: Requirements 6.4**

  - [ ]* 9.6 Write property test: successful payment updates order status
    - **Property 18: Successful Payment Updates Order Status**
    - **Validates: Requirements 6.2**

  - [ ]* 9.7 Write unit tests for payment edge cases
    - Invalid webhook signature → rejected
    - Failed payment → order remains pending
    - _Requirements: 6.3, 6.5_

- [x] 10. Reviews module
  - [x] 10.1 Create Review Mongoose schema and model
    - Fields: productId (indexed), customerId, rating (1–5), comment, isDeleted
    - Unique compound index: { productId, customerId }
    - _Requirements: 7.1, 7.3_

  - [x] 10.2 Implement Review endpoints
    - GET /api/v1/reviews/products/:productId — list non-deleted reviews with average rating
    - POST /api/v1/reviews/products/:productId — submit review (verify purchase, enforce one-per-product)
    - DELETE /api/v1/reviews/:id — soft-delete (Admin)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 10.3 Write property test: review average rating correctness
    - **Property 19: Review Average Rating Correctness**
    - **Validates: Requirements 7.4**

  - [ ]* 10.4 Write property test: deleted reviews excluded from public response
    - **Property 20: Deleted Reviews Excluded from Public Response**
    - **Validates: Requirements 7.5**

  - [ ]* 10.5 Write unit tests for review edge cases
    - Review without purchase → 403
    - Duplicate review → 409
    - _Requirements: 7.2, 7.3_

- [x] 11. Admin dashboard module
  - [x] 11.1 Implement admin analytics service
    - Aggregate total orders, total revenue, new customer count for a given date range
    - Aggregate top 10 products by units sold for a given date range
    - _Requirements: 8.1, 8.2_

  - [x] 11.2 Implement admin user management endpoints
    - GET /api/v1/admin/users — paginated customer list
    - PUT /api/v1/admin/users/:id/status — activate/deactivate account
    - _Requirements: 8.3, 8.4_

  - [x] 11.3 Implement admin dashboard and top-products endpoints
    - GET /api/v1/admin/dashboard — analytics summary
    - GET /api/v1/admin/top-products — top 10 by sales
    - _Requirements: 8.1, 8.2_

  - [ ]* 11.4 Write property test: dashboard totals correctness
    - **Property 21: Dashboard Totals Correctness**
    - **Validates: Requirements 8.1**

  - [ ]* 11.5 Write property test: deactivated user cannot authenticate
    - **Property 22: Deactivated User Cannot Authenticate**
    - **Validates: Requirements 8.4**

- [ ] 12. OpenAPI documentation
  - Integrate swagger-jsdoc and swagger-ui-express
  - Annotate all route handlers with OpenAPI 3.0 JSDoc comments
  - Expose Swagger UI at GET /api/docs
  - _Requirements: 10.5_

- [x] 13. React frontend scaffolding and core pages
  - [x] 13.1 Initialize React app with TypeScript, Vite, and Tailwind CSS
    - Set up React Router for client-side routing
    - Configure Axios instance with base URL and JWT interceptor (auto-attach token, auto-refresh on 401)
    - _Requirements: 10.1_

  - [x] 13.2 Implement Redux Toolkit store
    - Auth slice: user, accessToken, login/logout actions
    - Cart slice: items, subtotal, add/remove/update actions
    - Products slice: list, filters, pagination state
    - _Requirements: 4.1, 4.5_

  - [x] 13.3 Implement authentication pages
    - Register page, Login page, Forgot Password page, Reset Password page
    - Protected route wrapper (redirect to login if unauthenticated)
    - _Requirements: 1.1, 1.3, 1.9_

  - [x] 13.4 Implement product catalog and detail pages
    - Product listing page with filter sidebar (category, price range, availability) and search bar
    - Product detail page with image gallery, add-to-cart button, reviews section
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 7.4_

  - [x] 13.5 Implement cart and checkout pages
    - Cart page with item list, quantity controls, subtotal display
    - Checkout page with shipping address form and Stripe Elements payment form
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 6.1_

  - [x] 13.6 Implement order history and order detail pages
    - Order history page listing customer's orders with status badges
    - Order detail page with item breakdown and cancel button (if pending)
    - _Requirements: 5.6, 5.7, 5.9_

  - [x] 13.7 Implement admin panel pages
    - Dashboard page with analytics cards (total orders, revenue, new customers)
    - Products management page (create, edit, delete, image upload)
    - Orders management page (list all, update status)
    - Users management page (list, activate/deactivate)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 3.1, 3.2, 3.3_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations per property
- Unit/integration tests use Jest + Supertest with mongodb-memory-server
- External services (Stripe, email, S3) are mocked in all tests
- MongoDB transactions are used for order placement atomicity (requires replica set in dev — use mongodb-memory-server replica set mode)
