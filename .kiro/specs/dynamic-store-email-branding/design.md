# Dynamic Store Email Branding Bugfix Design

## Overview

All transactional emails sent by `EmailService` currently use a hardcoded platform name (`"Ecommerce Store"`), no store logo, and no store-specific contact details. In a multi-tenant platform each store has its own `name`, `settings.logoUrl`, `settings.contactEmail`, and `settings.contactPhone` stored in the `Store` collection.

The fix propagates `storeId` into every `EmailService` send method and into every template function so that each email is branded with the correct store's identity fetched from the database. A graceful fallback to the default platform name is applied when the store cannot be resolved.

The change surface is intentionally minimal: `email.templates.ts` gains a `StoreBranding` parameter, `email.service.ts` gains a private `fetchStoreBranding` helper, and each call-site in `auth.service.ts`, `order.service.ts`, and `payment.service.ts` passes the already-available `storeId`.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — an email is dispatched without a `storeId` being resolved to real store branding, causing the hardcoded `"Ecommerce Store"` name to appear in the rendered output instead of the actual store's name.
- **Property (P)**: The desired behavior when the bug condition holds — the rendered email HTML and text SHALL contain the store's actual name (and optionally logo/contact details) fetched from the `Store` collection.
- **Preservation**: All existing email content (order IDs, item lists, reset URLs, payment data, fire-and-forget error isolation, graceful disable on missing env vars) that must remain unchanged by the fix.
- **EmailService**: The singleton class in `backend/src/services/email.service.ts` that owns the nodemailer transporter and all typed send methods.
- **email.templates.ts**: The module in `backend/src/services/email.templates.ts` that renders HTML/text bodies for each email type using a shared `baseHtml` layout.
- **StoreBranding**: A new interface `{ storeName: string; logoUrl?: string; contactEmail?: string; contactPhone?: string }` passed to every template function to replace the hardcoded `PLATFORM_NAME` constant.
- **PLATFORM_NAME**: The hardcoded fallback string `"Ecommerce Store"` used when no store branding can be resolved.
- **storeId**: A MongoDB `ObjectId` string identifying the tenant store, already present on `User.storeId` and `Order.storeId`.
- **fetchStoreBranding**: A new private async helper on `EmailService` that queries `Store.findById(storeId)` and returns a `StoreBranding` object, falling back to defaults on failure.

---

## Bug Details

### Bug Condition

The bug manifests whenever any of the five `EmailService` send methods is invoked. None of the methods accept a `storeId` parameter, so `fetchStoreBranding` is never called, and every template receives the module-level `PLATFORM_NAME` constant (`"Ecommerce Store"`) instead of the real store name. The `baseHtml` layout hard-codes `PLATFORM_NAME` in the `<h1>` header and footer, making the wrong branding visible to every recipient regardless of which store they belong to.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type EmailSendRequest {
           storeId:   string,
           emailType: 'welcome' | 'passwordReset' | 'orderConfirmation'
                    | 'orderStatus' | 'paymentReceipt'
         }
  OUTPUT: boolean

  RETURN X.storeId is NOT passed to EmailService.sendXxxEmail()
      OR EmailService does NOT call Store.findById(X.storeId)
      OR email template receives PLATFORM_NAME constant instead of store.name
END FUNCTION
```

### Examples

- **Welcome email on "Acme Shop"**: Customer registers on store with name `"Acme Shop"`. Current output: header reads `"Ecommerce Store"`. Expected: header reads `"Acme Shop"`.
- **Password reset on "TechMart"**: Customer requests reset on store `"TechMart"`. Current output: footer reads `"© 2025 Ecommerce Store"`. Expected: `"© 2025 TechMart"`.
- **Order confirmation on "Gadget Hub"**: Order placed on store `"Gadget Hub"` with logo URL set. Current output: no logo, header reads `"Ecommerce Store"`. Expected: logo rendered, header reads `"Gadget Hub"`.
- **Payment receipt — store not found**: `storeId` is valid but store document deleted. Expected: graceful fallback to `"Ecommerce Store"` without throwing.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All email content fields (order ID, item list, total amount, shipping address, reset URL, payment intent ID, payment date, status label) must appear in the rendered output exactly as before.
- Fire-and-forget error isolation: every send method catches its own errors, logs them, and never re-throws to the caller.
- Graceful disable: when `EMAIL_USER` or `EMAIL_PASS` are absent the service logs a warning and skips sending without crashing.
- The `from` address (`EMAIL_FROM_NAME <EMAIL_USER>`) is unchanged.
- The unsubscribe footer notice and plain-text fallback body are preserved.
- Status-specific content: shipped emails include estimated delivery notice; cancelled emails include support contact message.

**Scope:**
All inputs that do NOT involve the branding fields (i.e., all non-`storeName`/`logoUrl`/`contactEmail`/`contactPhone` content) must be completely unaffected by this fix. This includes:
- Mouse clicks and HTTP requests that trigger email sends
- Order status transition logic
- Stripe webhook processing
- Password reset token generation and validation

**Note:** The actual expected correct behavior for buggy inputs is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

---

## Hypothesized Root Cause

Based on the code analysis, the root causes are:

1. **Missing `storeId` parameter on all send methods**: `sendWelcomeEmail`, `sendPasswordResetEmail`, `sendOrderConfirmationEmail`, `sendOrderStatusEmail`, and `sendPaymentReceiptEmail` do not accept a `storeId` argument, so there is no path to fetch store data.

2. **Module-level `PLATFORM_NAME` constant in templates**: `email.templates.ts` declares `const PLATFORM_NAME = 'Ecommerce Store'` at module scope and uses it directly in `baseHtml`, `welcomeTemplate`, `passwordResetTemplate`, `orderConfirmationTemplate`, `orderStatusTemplate`, and `paymentReceiptTemplate`. No branding parameter is threaded through.

3. **`baseHtml` does not accept dynamic branding**: The shared layout function `baseHtml(title, body)` hard-codes `PLATFORM_NAME` in the `<h1>` header and footer. It has no parameter for store name, logo, or contact details.

4. **Call-sites do not forward `storeId`**: In `auth.service.ts`, `order.service.ts`, and `payment.service.ts` the `storeId` is available at the point of each email dispatch but is never passed to `emailService`.

---

## Correctness Properties

Property 1: Bug Condition — Store-Branded Email Content

_For any_ email send request where `isBugCondition(X)` holds (i.e., a `storeId` is available and the store exists in the database with a name different from `"Ecommerce Store"`), the fixed `EmailService` send methods SHALL render HTML and text that contain the store's actual `name` and SHALL NOT contain the hardcoded string `"Ecommerce Store"` in the header or footer.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation — Non-Branding Email Content Unchanged

_For any_ email send request where `isBugCondition(X)` does NOT hold (i.e., the store cannot be found, or the store name equals the default), the fixed `EmailService` send methods SHALL produce output whose non-branding content fields (order ID, items, total, reset URL, payment data, status label, footer notice) are identical to those produced by the original functions, preserving all existing email content and behavioral guarantees.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

---

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `backend/src/services/email.templates.ts`

**Specific Changes**:

1. **Add `StoreBranding` interface**: Export a new interface used by all template functions:
   ```typescript
   export interface StoreBranding {
     storeName: string;
     logoUrl?: string;
     contactEmail?: string;
     contactPhone?: string;
   }
   ```

2. **Update `baseHtml` signature**: Accept `StoreBranding` as a third parameter and use `branding.storeName` in the `<h1>` header and footer. Conditionally render a `<img>` logo tag when `branding.logoUrl` is set. Conditionally render contact details in the footer when `branding.contactEmail` or `branding.contactPhone` are set.

3. **Update all five template functions**: Add `branding: StoreBranding` as a parameter to `welcomeTemplate`, `passwordResetTemplate`, `orderConfirmationTemplate`, `orderStatusTemplate`, and `paymentReceiptTemplate`. Pass `branding` through to `baseHtml` and replace all remaining `PLATFORM_NAME` references in the text bodies with `branding.storeName`.

4. **Retain `PLATFORM_NAME` as fallback constant**: Keep the constant for use as the default `storeName` value in `fetchStoreBranding`.

---

**File 2**: `backend/src/services/email.service.ts`

**Specific Changes**:

1. **Import `Store` model**: Add `import { Store } from '../modules/stores/store.model';` and import `StoreBranding` from templates.

2. **Add `fetchStoreBranding` private method**: Async helper that calls `Store.findById(storeId).lean()` and maps the result to `StoreBranding`. Returns the default branding (`storeName: 'Ecommerce Store'`) when the store is not found or the query throws:
   ```typescript
   private async fetchStoreBranding(storeId: string): Promise<StoreBranding> {
     try {
       const store = await Store.findById(storeId).lean();
       if (!store) return { storeName: PLATFORM_NAME };
       return {
         storeName: store.name,
         logoUrl: store.settings?.logoUrl || undefined,
         contactEmail: store.settings?.contactEmail || undefined,
         contactPhone: store.settings?.contactPhone || undefined,
       };
     } catch {
       return { storeName: PLATFORM_NAME };
     }
   }
   ```

3. **Add `storeId` parameter to all five send methods**: Each method signature gains a leading `storeId: string` parameter. The method calls `await this.fetchStoreBranding(storeId)` and passes the result to the template function.

4. **Update subject lines**: Replace hardcoded `"Ecommerce Store"` in `sendWelcomeEmail`'s subject with `branding.storeName`.

---

**File 3**: `backend/src/modules/auth/auth.service.ts`

**Specific Changes**:

1. **Pass `storeId` to `sendWelcomeEmail`**: In `register()`, change `emailService.sendWelcomeEmail(user.email)` to `emailService.sendWelcomeEmail(storeId, user.email)`.

2. **Pass `storeId` to `sendPasswordResetEmail`**: In `forgotPassword()`, change `emailService.sendPasswordResetEmail(user.email, rawToken)` to `emailService.sendPasswordResetEmail(storeId, user.email, rawToken)`.

---

**File 4**: `backend/src/modules/orders/order.service.ts`

**Specific Changes**:

1. **Pass `storeId` to `sendOrderConfirmationEmail`**: Both the transactional and fallback paths call `emailService.sendOrderConfirmationEmail`. Add `storeId` as the first argument in both call-sites.

2. **Pass `storeId` to `sendOrderStatusEmail`**: In `updateOrderStatus()`, add `storeId` as the first argument.

---

**File 5**: `backend/src/modules/payments/payment.service.ts`

**Specific Changes**:

1. **Resolve `storeId` from order**: In `handlePaymentSucceeded()`, the `order` document is already fetched. Use `order.storeId.toString()` to obtain the `storeId`.

2. **Pass `storeId` to `sendPaymentReceiptEmail`**: Change the call to `emailService.sendPaymentReceiptEmail(storeId, customer.email, { ... })`.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that call each `EmailService` send method with a mocked `Store` returning a custom store name, then assert the rendered HTML contains that store name. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **Welcome email branding test**: Call `sendWelcomeEmail('user@test.com')` with a mocked store named `"Acme Shop"` — assert HTML contains `"Acme Shop"` (will fail on unfixed code, HTML contains `"Ecommerce Store"`).
2. **Password reset email branding test**: Call `sendPasswordResetEmail('user@test.com', 'token')` with store `"TechMart"` — assert HTML contains `"TechMart"` (will fail on unfixed code).
3. **Order confirmation branding test**: Call `sendOrderConfirmationEmail` with store `"Gadget Hub"` — assert HTML contains `"Gadget Hub"` (will fail on unfixed code).
4. **Order status branding test**: Call `sendOrderStatusEmail` with store `"My Store"` — assert HTML contains `"My Store"` (will fail on unfixed code).
5. **Payment receipt branding test**: Call `sendPaymentReceiptEmail` with store `"Shop Co"` — assert HTML contains `"Shop Co"` (will fail on unfixed code).

**Expected Counterexamples**:
- All five assertions fail because the rendered HTML contains `"Ecommerce Store"` instead of the store name.
- Confirms root cause: `PLATFORM_NAME` constant is used directly; no `storeId` is accepted or resolved.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  branding ← fetchStoreBranding(X.storeId)   // returns store.name from DB
  result   ← sendEmail_fixed(X)
  ASSERT result.html CONTAINS branding.storeName
  AND    result.html DOES NOT CONTAIN "Ecommerce Store"   // when storeName differs
  AND    result.html CONTAINS branding.logoUrl            // when logoUrl is set
  AND    result.html CONTAINS branding.contactEmail       // when contactEmail is set
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT sendEmail_original(X).contentFields
       = sendEmail_fixed(X).contentFields
  // contentFields: orderId, items, totalAmount, resetUrl,
  //                paymentIntentId, status, shippingAddress, dates
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (random order data, random payment amounts, random status values).
- It catches edge cases that manual unit tests might miss (e.g., items with zero price, very long order IDs).
- It provides strong guarantees that behavior is unchanged for all non-branding content.

**Test Plan**: Observe behavior on UNFIXED code first for all non-branding content fields, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Order content preservation**: For any `OrderEmailData`, the fixed `orderConfirmationTemplate` output contains the same `orderId`, `items`, `totalAmount`, and `shippingAddress` as the original.
2. **Payment content preservation**: For any `PaymentEmailData`, the fixed `paymentReceiptTemplate` output contains the same `orderId`, `amount`, `currency`, `paymentIntentId`, and `paidAt` as the original.
3. **Reset URL preservation**: For any `resetUrl`, the fixed `passwordResetTemplate` output contains the same URL as the original.
4. **Status label preservation**: For any `OrderStatusEmailData`, the fixed `orderStatusTemplate` output contains the same status label, shipped/cancelled extra content, and `updatedAt` as the original.
5. **Fallback branding preservation**: When `Store.findById` returns `null`, the fixed output is identical to the original (both use `"Ecommerce Store"`).

### Unit Tests

- Test `fetchStoreBranding` returns correct `StoreBranding` when store exists.
- Test `fetchStoreBranding` returns default branding when store is not found (`null`).
- Test `fetchStoreBranding` returns default branding when `Store.findById` throws.
- Test `baseHtml` renders logo `<img>` tag when `logoUrl` is set.
- Test `baseHtml` omits logo when `logoUrl` is absent.
- Test `baseHtml` renders contact email and phone in footer when set.
- Test each of the five send methods passes `storeId` through to `fetchStoreBranding`.
- Test `sendWelcomeEmail` subject line uses `branding.storeName`.

### Property-Based Tests

- Generate random `StoreBranding` objects and verify `baseHtml` always contains `branding.storeName` in header and footer.
- Generate random `OrderEmailData` values and verify all content fields survive the branding parameter addition unchanged.
- Generate random `PaymentEmailData` values and verify all content fields are preserved after the fix.
- Generate random `OrderStatusEmailData` values and verify status labels and extra content are preserved.
- Generate random `storeId` strings (including invalid ObjectIds) and verify `fetchStoreBranding` never throws.

### Integration Tests

- Test full registration flow: register user on a named store, assert welcome email HTML contains the store name.
- Test full password reset flow: request reset on a named store, assert reset email HTML contains the store name.
- Test full order placement flow: place order on a named store, assert confirmation email HTML contains the store name.
- Test order status update: transition order to `shipped` on a named store, assert status email HTML contains the store name and estimated delivery notice.
- Test payment webhook: simulate `payment_intent.succeeded` for an order on a named store, assert receipt email HTML contains the store name.
- Test fallback: call send method with a non-existent `storeId`, assert email sends successfully with `"Ecommerce Store"` branding.
