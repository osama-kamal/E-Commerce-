# Bugfix Requirements Document

## Introduction

The email notification system currently sends all transactional emails (welcome, password reset, order confirmation, order status updates, and payment receipts) using hardcoded branding from the Default store — specifically a fixed platform name (`"Ecommerce Store"`), no store logo, and no store-specific contact information. In a multi-tenant platform where each store has its own name, logo URL, contact email, and contact phone stored in the `Store` model, customers receive emails that are branded with the wrong store identity.

This bug affects every email type dispatched by `EmailService`. The root cause is that `EmailService` and its template functions have no awareness of `storeId` — they use a static `PLATFORM_NAME` constant and never query the `Store` collection. The fix requires propagating `storeId` through the email service and templates so that each email is branded with the correct store's name, logo, and contact details.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a customer registers on any store THEN the system sends a welcome email branded with the hardcoded name `"Ecommerce Store"` instead of the actual store's name

1.2 WHEN a customer requests a password reset on any store THEN the system sends a password reset email branded with the hardcoded name `"Ecommerce Store"` instead of the actual store's name

1.3 WHEN an order is placed on any store THEN the system sends an order confirmation email branded with the hardcoded name `"Ecommerce Store"` instead of the actual store's name

1.4 WHEN an order status changes on any store THEN the system sends an order status update email branded with the hardcoded name `"Ecommerce Store"` instead of the actual store's name

1.5 WHEN a payment is successfully captured on any store THEN the system sends a payment receipt email branded with the hardcoded name `"Ecommerce Store"` instead of the actual store's name

1.6 WHEN any transactional email is sent THEN the system uses no store logo and no store-specific contact information regardless of which store the customer belongs to

### Expected Behavior (Correct)

2.1 WHEN a customer registers on a store THEN the system SHALL send a welcome email branded with that store's name fetched from the database using the customer's `storeId`

2.2 WHEN a customer requests a password reset on a store THEN the system SHALL send a password reset email branded with that store's name fetched from the database using the customer's `storeId`

2.3 WHEN an order is placed on a store THEN the system SHALL send an order confirmation email branded with that store's name fetched from the database using the order's `storeId`

2.4 WHEN an order status changes on a store THEN the system SHALL send an order status update email branded with that store's name fetched from the database using the order's `storeId`

2.5 WHEN a payment is successfully captured on a store THEN the system SHALL send a payment receipt email branded with that store's name fetched from the database using the order's `storeId`

2.6 WHEN any transactional email is sent THEN the system SHALL include the store's logo URL (if set) and contact information (contact email and/or contact phone, if set) fetched from the `Store` model's `settings` field

2.7 WHEN the store cannot be found in the database for a given `storeId` THEN the system SHALL fall back to the default platform name and omit store-specific logo and contact details without throwing an error

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any transactional email fails to send THEN the system SHALL CONTINUE TO catch the error, log it, and allow the originating HTTP response to succeed without blocking the user

3.2 WHEN `EMAIL_USER` or `EMAIL_PASS` environment variables are missing THEN the system SHALL CONTINUE TO disable email sending gracefully and log a warning without crashing

3.3 WHEN a customer successfully registers THEN the system SHALL CONTINUE TO send a welcome email to the customer's registered email address

3.4 WHEN a customer requests a password reset THEN the system SHALL CONTINUE TO send a password reset email containing the reset URL, a 1-hour expiry notice, and an ignore notice

3.5 WHEN an order is successfully placed THEN the system SHALL CONTINUE TO send an order confirmation email containing the order ID, items, total amount, shipping address, and creation date

3.6 WHEN an order status transitions to `processing`, `shipped`, `delivered`, or `cancelled` THEN the system SHALL CONTINUE TO send an order status update email with the order ID, new status, and status-specific content

3.7 WHEN a payment is successfully captured via Stripe THEN the system SHALL CONTINUE TO send a payment receipt email containing the order ID, amount, currency, payment intent ID, and payment date

3.8 WHEN an order status transitions to `shipped` THEN the system SHALL CONTINUE TO include an estimated delivery notice in the status update email

3.9 WHEN an order status transitions to `cancelled` THEN the system SHALL CONTINUE TO include a support contact message in the status update email

3.10 WHEN any email template is rendered THEN the system SHALL CONTINUE TO include a footer with an unsubscribe notice and a plain-text fallback body

---

## Bug Condition

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type EmailSendRequest { storeId: string, emailType: string }
  OUTPUT: boolean

  // Returns true when the email service is called without store-specific branding
  RETURN X.storeId is not passed to EmailService
      OR EmailService does not fetch Store from database using X.storeId
      OR email templates use hardcoded PLATFORM_NAME instead of store.name
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: Fix Checking — Store-Branded Emails
FOR ALL X WHERE isBugCondition(X) DO
  result ← sendEmail'(X)  // fixed email send
  ASSERT result.html CONTAINS store.name fetched by X.storeId
  AND result.html DOES NOT CONTAIN hardcoded "Ecommerce Store" when store.name differs
END FOR
```

### Property: Preservation Checking

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  // All existing email content (order details, reset URLs, payment data) is preserved
  ASSERT sendEmail(X) content fields = sendEmail'(X) content fields
  AND fire-and-forget error isolation behavior is unchanged
END FOR
```
