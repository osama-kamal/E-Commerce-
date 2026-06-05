# Implementation Plan: Email Notifications

## Overview

Implement a centralized `EmailService` using Nodemailer + Gmail SMTP, add typed template functions for all five email types, and wire the service into the existing auth, order, and payment modules. All email calls are fire-and-forget — errors are caught and logged, never propagated to HTTP responses.

## Tasks

- [x] 1. Add environment variables and install Nodemailer
  - Add `EMAIL_USER`, `EMAIL_PASS`, `FRONTEND_URL`, `EMAIL_FROM_NAME` to `backend/.env` and `backend/src/config/index.ts`
  - Run `npm install nodemailer` and `npm install --save-dev @types/nodemailer` in the `backend` directory
  - _Requirements: 8.1, 8.2_

- [x] 2. Create the EmailService singleton
  - Create `backend/src/services/email.service.ts` with the `EmailService` class and exported singleton `emailService`
  - Implement constructor that reads env vars, sets `enabled` flag, and creates the Nodemailer Gmail SMTP transporter
  - Implement `verifyConnection()` that calls `transporter.verify()` and logs success or failure without throwing
  - Implement internal `sendEmail(options)` that calls `transporter.sendMail`, logs errors, and re-throws on failure
  - Implement the five typed public methods: `sendWelcomeEmail`, `sendPasswordResetEmail`, `sendOrderConfirmationEmail`, `sendOrderStatusEmail`, `sendPaymentReceiptEmail` — each wraps `sendEmail` in try/catch and never re-throws
  - Call `emailService.verifyConnection()` in `backend/src/server.ts` after the server starts
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 8.3_

- [x] 3. Create HTML email templates
  - Create `backend/src/services/email.templates.ts` with the five template functions: `welcomeTemplate`, `passwordResetTemplate`, `orderConfirmationTemplate`, `orderStatusTemplate`, `paymentReceiptTemplate`
  - Each function returns `{ html: string; text: string }` using TypeScript string interpolation (no external engine)
  - Every template must include the platform name and a footer with an unsubscribe notice
  - Every template must include a plain-text fallback
  - `passwordResetTemplate` must include the full reset URL, "expires in 1 hour" notice, and "ignore if you didn't request" notice
  - `orderStatusTemplate` must include status-specific content: delivery notice for `shipped`, support message for `cancelled`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 4.2, 4.3, 4.5, 5.2, 5.3, 6.2, 6.3, 6.4, 7.2, 7.3_

  - [ ]* 3.1 Write property tests for email templates (Properties 1–8)
    - Create `backend/tests/properties/email.property.test.ts`
    - **Property 1: Templates never expose raw placeholder tokens** — for any template called with any data, output must not contain `{{`, `undefined`, or `[object Object]`
    - **Validates: Requirements 2.2, 2.3**
    - **Property 2: Every rendered email contains platform name and footer** — for any template and any data, HTML must contain platform name and footer text
    - **Validates: Requirements 2.5**
    - **Property 3: Every email send includes a plain-text fallback** — for any template, the returned `text` field must be non-empty
    - **Validates: Requirements 2.4**
    - **Property 4: Welcome email contains customer email and shop link** — for any email address, rendered welcome HTML contains that address and a URL
    - **Validates: Requirements 3.2, 3.3**
    - **Property 5: Password reset email contains full reset URL, expiry notice, and ignore notice** — for any token and base URL, rendered HTML contains the full URL, "1 hour", and ignore notice
    - **Validates: Requirements 4.2, 4.3, 4.5**
    - **Property 6: Order confirmation email contains all required order fields** — for any order data, rendered HTML contains order ID, item names, total, shipping address, and a date string
    - **Validates: Requirements 5.2, 5.3**
    - **Property 7: Order status email contains required fields and status-specific content** — for any order and any notifiable status, rendered HTML contains order ID and status; shipped includes delivery notice; cancelled includes support message
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - **Property 8: Payment receipt email contains all required payment fields** — for any payment data, rendered HTML contains order ID, amount, currency, payment intent ID, and a date string
    - **Validates: Requirements 7.2, 7.3**

- [x] 4. Wire EmailService into the auth module
  - In `backend/src/modules/auth/auth.service.ts`, import `emailService` and call `emailService.sendWelcomeEmail(user.email)` after `User.create` in `register()`
  - Call `emailService.sendPasswordResetEmail(user.email, rawToken)` after storing the reset token in `forgotPassword()`
  - _Requirements: 3.1, 3.4, 4.1, 4.4_

  - [ ]* 4.1 Write unit tests for auth email integration
    - Create `backend/tests/unit/email-auth.test.ts`
    - Mock `emailService` and verify `sendWelcomeEmail` is called with the correct email after successful registration
    - Verify registration still succeeds when `sendWelcomeEmail` throws
    - Verify `sendPasswordResetEmail` is called with the correct token after `forgotPassword`
    - Verify `forgotPassword` still returns without error when `sendPasswordResetEmail` throws
    - _Requirements: 3.1, 3.4, 4.1, 4.4_

- [x] 5. Wire EmailService into the order module
  - In `backend/src/modules/orders/order.service.ts`, import `emailService`
  - After the order is created in `placeOrder()`, fetch the customer's email from the User model and call `emailService.sendOrderConfirmationEmail(email, orderData)`
  - After `order.save()` in `updateOrderStatus()`, fetch the customer's email and call `emailService.sendOrderStatusEmail(email, statusData)` only when the new status is `processing`, `shipped`, `delivered`, or `cancelled`
  - _Requirements: 5.1, 5.4, 6.1, 6.5_

  - [ ]* 5.1 Write unit tests for order email integration
    - Create `backend/tests/unit/email-order.test.ts`
    - Mock `emailService` and verify `sendOrderConfirmationEmail` is called after `placeOrder` succeeds
    - Verify `placeOrder` still returns the order when `sendOrderConfirmationEmail` throws
    - Verify `sendOrderStatusEmail` is called for each notifiable status transition
    - Verify `updateOrderStatus` still returns the updated order when `sendOrderStatusEmail` throws
    - _Requirements: 5.1, 5.4, 6.1, 6.5_

- [x] 6. Wire EmailService into the payment module
  - In `backend/src/modules/payments/payment.service.ts`, import `emailService`
  - In `handlePaymentSucceeded()`, after `order.status = 'processing'` and `order.save()`, fetch the customer's email and call `emailService.sendPaymentReceiptEmail(email, paymentData)`
  - _Requirements: 7.1, 7.4_

  - [ ]* 6.1 Write unit tests for payment email integration
    - Create `backend/tests/unit/email-payment.test.ts`
    - Mock `emailService` and verify `sendPaymentReceiptEmail` is called with correct data after a successful payment webhook
    - Verify the webhook handler still completes successfully when `sendPaymentReceiptEmail` throws
    - _Requirements: 7.1, 7.4_

- [x] 7. Checkpoint — Ensure all tests pass
  - Run `npm test` in the `backend` directory and confirm all existing tests and new tests pass. Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All email calls are fire-and-forget — they must never block or fail HTTP responses
- Gmail SMTP credentials (`EMAIL_USER`, `EMAIL_PASS`) must be set in `backend/.env` before running
- Property tests use `fast-check` (already installed) with a minimum of 100 iterations each
