# Requirements Document

## Introduction

This feature automates the Stripe subscription billing lifecycle for the Vendbase multi-tenant platform. Currently, plan upgrades are applied manually by a super-admin. This spec replaces that manual flow with a fully automated webhook-driven system that responds to Stripe subscription and invoice events in real time.

The system must handle plan activation, renewal, expiry, dunning (payment failure → grace period → suspension), and Stripe Customer creation — keeping every store's `subscriptionPlan`, `subscriptionStatus`, and `subscriptionEndsAt` fields in sync with Stripe's source of truth at all times.

---

## Glossary

- **Webhook_Endpoint**: The HTTP POST route (`/api/v1/payments/webhook`) that receives Stripe event payloads.
- **Webhook_Service**: The backend service layer that verifies, deduplicates, and dispatches Stripe webhook events.
- **Subscription_Handler**: The module that processes subscription lifecycle events and updates the Store document.
- **StripeWebhookEvent**: A MongoDB collection that records every processed Stripe event ID for idempotency.
- **Store**: The MongoDB document (in the `stores` collection) representing a tenant, identified by `_id`.
- **Stripe_Customer**: A Stripe-side entity (`cus_xxx`) linked to a Store via `stripeCustomerId`.
- **Stripe_Subscription**: A Stripe-side entity (`sub_xxx`) linked to a Store via `stripeSubscriptionId`.
- **PriceMap**: A server-side configuration mapping Stripe Price IDs (`price_xxx`) to internal `SubscriptionPlan` values (`starter`, `pro`, `enterprise`).
- **Grace_Period**: 7 days after the first `invoice.payment_failed` event during which the store remains `past_due` before transitioning to `suspended`.
- **Dunning**: The process of retrying failed subscription payments and escalating the store status through `past_due` → `suspended` if payment is not recovered within the Grace_Period.
- **Idempotency_Guard**: The mechanism that prevents the same Stripe event from being processed more than once, using the event's unique `id` stored in `StripeWebhookEvent`.

---

## Requirements

### Requirement 1: Store Model — Stripe Identity Fields

**User Story:** As a platform, I need to persist Stripe identifiers on each Store document, so that the Webhook_Service can reliably look up the correct store for any incoming Stripe event.

#### Acceptance Criteria

1. THE Store SHALL include an optional `stripeCustomerId` field (string, sparse unique index) that stores a Stripe Customer ID matching the format `cus_` followed by alphanumeric characters, with a maximum length of 255 characters.
2. THE Store SHALL include an optional `stripeSubscriptionId` field (string, sparse unique index) that stores a Stripe Subscription ID matching the format `sub_` followed by alphanumeric characters, with a maximum length of 255 characters.
3. IF a `stripeCustomerId` value being written already exists on a different Store document, THEN THE Store SHALL reject the write and return a duplicate key error.
4. IF a `stripeSubscriptionId` value being written already exists on a different Store document, THEN THE Store SHALL reject the write and return a duplicate key error.

---

### Requirement 2: Stripe Customer Creation at Upgrade

**User Story:** As a store owner, I want a Stripe Customer to be automatically created when I upgrade from the free plan, so that Stripe can track my subscription and billing history.

#### Acceptance Criteria

1. WHEN a store initiates an upgrade from `free` to a paid plan and `stripeCustomerId` is not set, THE Subscription_Handler SHALL call the Stripe API to create a new Customer using the store owner's email address, persist the returned `cus_xxx` value in `Store.stripeCustomerId` before proceeding, and then continue the upgrade flow.
2. WHEN a store initiates an upgrade and `stripeCustomerId` is already set, THE Subscription_Handler SHALL reuse the existing Stripe Customer and SHALL NOT call the Stripe Customer creation API.
3. IF the Stripe Customer creation API call fails, THEN THE Subscription_Handler SHALL return an error response to the caller and SHALL NOT update the store's plan or persist any partial state.
4. IF the Stripe Customer creation API call succeeds but the subsequent database write of `stripeCustomerId` fails, THEN THE Subscription_Handler SHALL log the returned `cus_xxx` value at ERROR level and return an error to the caller so that the orphaned Stripe Customer can be recovered and linked manually.

---

### Requirement 3: Webhook Endpoint and Signature Verification

**User Story:** As a platform operator, I want the webhook endpoint to reject any request that is not signed by Stripe, so that only authentic events can trigger billing state changes.

#### Acceptance Criteria

1. THE Webhook_Endpoint SHALL accept POST requests at `/api/v1/payments/webhook` with `Content-Type: application/octet-stream` or `application/json`.
2. THE Webhook_Endpoint SHALL receive the raw (unparsed) request body before any JSON middleware processes it.
3. WHEN a Stripe webhook request arrives, THE Webhook_Service SHALL call `stripe.webhooks.constructEvent()` with the raw body, the `Stripe-Signature` header, and `config.STRIPE_WEBHOOK_SECRET`.
4. IF the signature verification fails, THEN THE Webhook_Service SHALL respond with HTTP 400 and SHALL NOT process the event payload.
5. IF `config.STRIPE_WEBHOOK_SECRET` is not configured at startup, THEN THE Webhook_Service SHALL respond with HTTP 500 and log a CRITICAL-level error including the missing configuration key name.

---

### Requirement 4: Idempotency — Deduplication of Webhook Events

**User Story:** As a platform operator, I want duplicate webhook deliveries to be silently ignored, so that retries from Stripe never cause double-billing or state corruption.

#### Acceptance Criteria

1. THE Webhook_Service SHALL record every successfully processed Stripe event by inserting a `StripeWebhookEvent` document containing the event's `stripeEventId` (unique index), `type`, and `processedAt` timestamp.
2. WHEN a Stripe event is received, THE Webhook_Service SHALL query `StripeWebhookEvent` for the event `id` before processing.
3. IF a `StripeWebhookEvent` document already exists for the incoming event `id`, THEN THE Webhook_Service SHALL respond with HTTP 200 and SHALL NOT re-process the event.
4. THE `StripeWebhookEvent` collection SHALL enforce a unique index on the `stripeEventId` field so that concurrent duplicate deliveries are rejected at the database level.

---

### Requirement 5: Handle `customer.subscription.created` Event

**User Story:** As a store owner, I want my subscription plan to activate automatically when Stripe creates my subscription, so that I gain access to paid features without waiting for manual intervention.

#### Acceptance Criteria

1. WHEN a `customer.subscription.created` event is received, THE Subscription_Handler SHALL look up the Store by `stripeCustomerId` matching `event.data.object.customer`.
2. WHEN the subscription status in the event is `active` or `trialing`, THE Subscription_Handler SHALL set `Store.subscriptionPlan` to the plan derived from the PriceMap, `Store.subscriptionStatus` to `active`, `Store.stripeSubscriptionId` to the subscription ID, and `Store.subscriptionEndsAt` to the `current_period_end` timestamp from the Stripe event.
3. IF the Stripe Price ID in the event is not found in the PriceMap, THEN THE Subscription_Handler SHALL log a warning including the unrecognised Price ID and SHALL NOT update the store's plan.
4. IF no Store is found with a matching `stripeCustomerId`, THEN THE Subscription_Handler SHALL log an error including the `stripeCustomerId` value and SHALL NOT throw — the webhook handler SHALL still respond with HTTP 200.

---

### Requirement 6: Handle `customer.subscription.updated` Event

**User Story:** As a store owner, I want my subscription plan and status to reflect the latest Stripe subscription state automatically, so that plan changes (upgrades, downgrades, renewals) take effect immediately.

#### Acceptance Criteria

1. WHEN a `customer.subscription.updated` event is received, THE Subscription_Handler SHALL look up the Store by `stripeSubscriptionId` matching `event.data.object.id`.
2. WHEN the subscription status is `active`, THE Subscription_Handler SHALL set `Store.subscriptionPlan` to the plan from the PriceMap, `Store.subscriptionStatus` to `active`, and `Store.subscriptionEndsAt` to the new `current_period_end` value from the event.
3. WHEN the subscription status is `past_due`, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `past_due` and SHALL NOT change `Store.subscriptionPlan`.
4. WHEN the subscription status is `canceled` or `unpaid`, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `cancelled`, `Store.subscriptionPlan` to `free`, and SHALL clear `Store.subscriptionEndsAt`.
5. IF the Stripe Price ID in the updated subscription is not found in the PriceMap, THEN THE Subscription_Handler SHALL log a warning including the unrecognised Price ID and SHALL NOT update the store's plan.
6. IF no Store is found with a matching `stripeSubscriptionId`, THEN THE Subscription_Handler SHALL log a warning including the `stripeSubscriptionId` value and SHALL respond with HTTP 200.

---

### Requirement 7: Handle `customer.subscription.deleted` Event

**User Story:** As a platform, I want a store's plan to revert to free automatically when its Stripe subscription is cancelled, so that access to paid features is revoked without manual intervention.

#### Acceptance Criteria

1. WHEN a `customer.subscription.deleted` event is received, THE Subscription_Handler SHALL look up the Store by `stripeSubscriptionId` matching `event.data.object.id`.
2. WHEN a matching Store is found, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `cancelled`, `Store.subscriptionPlan` to `free`, and SHALL clear `Store.subscriptionEndsAt` and `Store.stripeSubscriptionId` to null.
3. IF no Store is found with a matching `stripeSubscriptionId`, THEN THE Subscription_Handler SHALL log a warning including the `stripeSubscriptionId` value and SHALL respond with HTTP 200 without throwing.

---

### Requirement 8: Handle `invoice.payment_succeeded` Event

**User Story:** As a store owner, I want my subscription to be confirmed as active immediately after a successful payment, so that my service is never interrupted after a renewal.

#### Acceptance Criteria

1. WHEN an `invoice.payment_succeeded` event is received with `billing_reason` of `subscription_cycle` or `subscription_create`, THE Subscription_Handler SHALL look up the Store by `stripeSubscriptionId` matching `event.data.object.subscription`.
2. WHEN a matching Store is found, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `active` and update `Store.subscriptionEndsAt` to the Unix timestamp at `lines.data[0].period.end` from the invoice, converted to a JavaScript `Date`.
3. WHEN a matching Store is found and `Store.subscriptionStatus` was `past_due` before this event, THE Subscription_Handler SHALL additionally set `Store.subscriptionDunningStartedAt` to null and `Store.suspensionScheduled` to false.
4. WHEN an `invoice.payment_succeeded` event is received with a `billing_reason` other than `subscription_cycle` or `subscription_create`, THE Subscription_Handler SHALL acknowledge the event with HTTP 200 and SHALL NOT modify any Store fields.
5. IF no Store is found with a matching `stripeSubscriptionId`, THEN THE Subscription_Handler SHALL log a warning including the `stripeSubscriptionId` value and SHALL respond with HTTP 200.
6. IF the database update in criterion 2 fails, THEN THE Subscription_Handler SHALL respond with HTTP 500 so that Stripe retries delivery.

---

### Requirement 9: Handle `invoice.payment_failed` Event — Dunning Logic

**User Story:** As a platform operator, I want failed subscription payments to trigger a grace period before suspending the store, so that transient payment failures do not immediately interrupt service.

#### Acceptance Criteria

1. WHEN an `invoice.payment_failed` event is received, THE Subscription_Handler SHALL look up the Store by `stripeSubscriptionId` matching `event.data.object.subscription`.
2. WHEN a matching Store is found, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `past_due`.
3. WHEN a matching Store is found and `Store.subscriptionDunningStartedAt` is not already set, THE Subscription_Handler SHALL set `Store.subscriptionDunningStartedAt` to the current timestamp.
4. WHILE `Store.subscriptionStatus` is `past_due` and fewer than 7 days have elapsed since `Store.subscriptionDunningStartedAt`, THE Subscription_Handler SHALL NOT change `Store.subscriptionPlan` or revoke store access.
5. WHEN a dunning evaluation is triggered and 7 or more days have elapsed since `Store.subscriptionDunningStartedAt` without a successful payment, THE Subscription_Handler SHALL set `Store.subscriptionStatus` to `suspended` and SHALL clear `Store.subscriptionDunningStartedAt` to null.
6. IF no Store is found with a matching `stripeSubscriptionId`, THEN THE Subscription_Handler SHALL log a warning including the `stripeSubscriptionId` value and SHALL respond with HTTP 200.

---

### Requirement 10: PriceMap — Stripe Price ID to Plan Mapping

**User Story:** As a developer, I want a centralized configuration that maps Stripe Price IDs to internal plan names, so that plan mapping is consistent and easy to update without code changes.

#### Acceptance Criteria

1. THE PriceMap SHALL be defined in server-side configuration (not hardcoded inline) and SHALL support the `starter`, `pro`, and `enterprise` plans — the `free` plan has no associated Stripe Price ID and SHALL NOT be included.
2. WHEN a Stripe Price ID is looked up in the PriceMap and a matching entry exists, THE Subscription_Handler SHALL return the corresponding `SubscriptionPlan` value (`starter`, `pro`, or `enterprise`).
3. WHEN a Stripe Price ID is looked up in the PriceMap and no matching entry exists, THE Subscription_Handler SHALL return `undefined` and SHALL NOT default silently to any plan.
4. THE PriceMap configuration SHALL be sourced from environment variables (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`) so that different Stripe environments (test/live) can use different Price IDs without code changes.
5. IF any of the three PriceMap environment variables (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`) is absent at server startup, THEN THE Webhook_Service SHALL log a WARNING-level message identifying each missing variable by name — the server SHALL still start, but lookups for missing plans will return `undefined`.

---

### Requirement 11: Webhook Response Contract

**User Story:** As Stripe, I need the webhook endpoint to always return a timely HTTP 200 response for events that were received (even if processing fails internally), so that Stripe does not unnecessarily retry delivery.

#### Acceptance Criteria

1. WHEN a webhook event is received and passes signature verification, THE Webhook_Endpoint SHALL respond with HTTP 200 within 30 seconds regardless of whether internal processing completes successfully, encounters a known business-logic error (missing store, unrecognised Price ID), or encounters an unhandled exception.
2. IF an unhandled exception occurs during event processing, THE Webhook_Service SHALL log the error at ERROR level including the event ID and stack trace, and SHALL still respond with HTTP 200.
3. WHEN the signature verification fails, THE Webhook_Endpoint SHALL respond with HTTP 400 — this is the only expected non-200 response for a genuine Stripe delivery attempt.
4. THE Webhook_Endpoint SHALL NOT require JWT authentication — Stripe request authenticity is verified exclusively via Stripe-Signature header validation.
5. IF internal processing does not complete within 25 seconds, THE Webhook_Service SHALL log a WARNING including the event ID and elapsed time, and SHALL respond with HTTP 200 before the 30-second deadline to prevent Stripe from treating the request as timed out.

---

### Requirement 12: Subscription Webhook Event Logging

**User Story:** As a platform operator, I want all processed webhook events and their outcomes to be logged, so that I can diagnose billing issues and audit subscription state changes.

#### Acceptance Criteria

1. WHEN a Stripe webhook event is received and passes signature verification, THE Webhook_Service SHALL log at INFO level an entry that includes: the event `id`, the event `type`, and whichever of `stripeCustomerId` or `stripeSubscriptionId` is present in the payload.
2. WHEN a store's `subscriptionStatus` changes as a result of a webhook event, THE Webhook_Service SHALL log at INFO level an entry that includes: the store's `_id`, the previous `subscriptionStatus` value, and the new `subscriptionStatus` value.
3. IF an event cannot be processed because no matching store is found, THE Webhook_Service SHALL log at WARN level an entry that includes: the event `id`, the event `type`, and the `stripeCustomerId` or `stripeSubscriptionId` value that was searched for.
4. IF an event cannot be processed because the Stripe Price ID is not present in the PriceMap, THE Webhook_Service SHALL log at WARN level an entry that includes: the event `id`, the event `type`, and the unrecognised Price ID value.
5. IF an unhandled exception occurs during event processing, THE Webhook_Service SHALL log at ERROR level an entry that includes: the event `id`, the event `type`, and the full stack trace of the exception.
