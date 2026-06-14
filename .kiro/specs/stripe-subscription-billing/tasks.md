# Implementation Plan: Stripe Subscription Billing

## Overview

Automate the Stripe subscription lifecycle for the Vendbase multi-tenant platform. The
implementation is split into five phases: Foundation (data model + config), Core
Infrastructure (idempotency model + webhook hardening), The Engine (subscription event
handlers), Integration (wiring handlers into `payment.service.ts`), and Dunning &
Operations (grace-period job + structured logging + property tests).

All code is TypeScript targeting the existing Express/Mongoose backend. No new runtime
dependencies are required — `stripe`, `fast-check`, and `mongoose` are already present.

---

## Tasks

- [ ] 1. Foundation — data model and configuration

  - [ ] 1.1 Extend `store.model.ts` with Stripe identity fields
    - Add `stripeCustomerId?: string` to `IStore` interface with JSDoc comment
      (`// cus_xxx — sparse unique index`)
    - Add `stripeSubscriptionId?: string` to `IStore` interface
    - Add `subscriptionDunningStartedAt?: Date` to `IStore` interface
    - Add `suspensionScheduled?: boolean` to `IStore` interface
    - Add corresponding Mongoose schema fields:
      - `stripeCustomerId: { type: String, sparse: true, unique: true }` (index only
        enforced when value is present)
      - `stripeSubscriptionId: { type: String, sparse: true, unique: true }`
      - `subscriptionDunningStartedAt: { type: Date, default: null }`
      - `suspensionScheduled: { type: Boolean, default: false }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Extend `config/index.ts` with Stripe Price ID env vars
    - Add three optional Zod fields inside `envSchema`:
      - `STRIPE_PRICE_STARTER: z.string().optional()`
      - `STRIPE_PRICE_PRO: z.string().optional()`
      - `STRIPE_PRICE_ENTERPRISE: z.string().optional()`
    - Append all three to the `optionalWarnings` array so each missing var emits a
      `console.warn` at startup (matching the existing pattern for other optional keys)
    - Add the three keys to the named exports block at the bottom of the file
    - _Requirements: 10.4, 10.5_

  - [ ] 1.3 Extend `planLimits.ts` with `PriceMap`, `buildPriceMap`, and `lookupPlan`
    - Import `config` from `'../config/index'` (import type only to avoid circular dep)
    - Add `export type PriceMap = Record<string, Exclude<SubscriptionPlan, 'free'>>`
    - Implement `export function buildPriceMap(): PriceMap` — reads
      `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE` from
      `config`; only adds an entry when the env var is a non-empty string; never maps
      anything to `'free'`
    - Implement `export function lookupPlan(priceId: string): Exclude<SubscriptionPlan, 'free'> | undefined` — calls `buildPriceMap()` and returns the matching plan or
      `undefined`; must never return `'free'`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 1.4 Extend `create-indexes.ts` with sparse unique indexes for Stripe fields
    - Import `Store` from the stores model at the top of the file
    - Add a "Stores (Stripe fields)" section after the existing Users block:
      ```typescript
      await Store.collection.createIndex(
        { stripeCustomerId: 1 },
        { sparse: true, unique: true, name: 'stores_stripeCustomerId_sparse_unique' }
      );
      await Store.collection.createIndex(
        { stripeSubscriptionId: 1 },
        { sparse: true, unique: true, name: 'stores_stripeSubscriptionId_sparse_unique' }
      );
      ```
    - Add corresponding `console.log` confirmation lines matching the existing style
    - _Requirements: 1.1, 1.2_

- [ ] 2. Core Infrastructure — idempotency model and webhook hardening

  - [ ] 2.1 Create `stripeWebhookEvent.model.ts`
    - Create file at `backend/src/modules/payments/stripeWebhookEvent.model.ts`
    - Define `export interface IStripeWebhookEvent extends Document` with fields:
      - `stripeEventId: string` — unique index
      - `type: string`
      - `processedAt: Date`
    - Define `stripeWebhookEventSchema` with `stripeEventId: { type: String, required: true, unique: true }`, `type: { type: String, required: true }`,
      `processedAt: { type: Date, required: true, default: () => new Date() }`
    - Export `export const StripeWebhookEvent = mongoose.model<IStripeWebhookEvent>('StripeWebhookEvent', stripeWebhookEventSchema)`
    - _Requirements: 4.1, 4.4_

  - [ ] 2.2 Migrate idempotency guard in `payment.service.ts`
    - Import `StripeWebhookEvent` from `'./stripeWebhookEvent.model'`
    - In `handleWebhook()`, replace the existing `Payment.findOne({ stripeEventId: event.id })` guard with `StripeWebhookEvent.findOne({ stripeEventId: event.id })`
    - Move `StripeWebhookEvent.create({ stripeEventId: event.id, type: event.type, processedAt: new Date() })` to **after** the `switch` dispatch (Step 5 in the design
      pseudocode) — so a crashed handler leaves no record and Stripe will retry
    - Remove the existing inline `stripeEventId` tracking from `handlePaymentSucceeded`
      and `handlePaymentFailed` (they now rely on the outer guard)
    - Keep the `Payment.create()` calls inside those handlers but without `stripeEventId`
      (or move `stripeEventId` field removal to a follow-up note)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 2.3 Add 25-second timeout guard to `handleWebhook()`
    - At the top of `handleWebhook()` (after signature verification), record
      `const startTime = Date.now()`
    - After the `switch` dispatch and before `StripeWebhookEvent.create()`, check:
      ```typescript
      const elapsed = Date.now() - startTime;
      if (elapsed > 25_000) {
        logger.warn('Webhook processing exceeded 25 s', { eventId: event.id, elapsed });
        // caller (controller) must respond 200 — flag via returned value or thrown signal
      }
      ```
    - The controller already returns 200; add a mechanism (e.g., a `timedOut` flag or
      early return) so the timeout guard exits `handleWebhook` without inserting the
      `StripeWebhookEvent` record prematurely
    - _Requirements: 11.5_

- [ ] 3. The Engine — subscription event handlers

  - [ ] 3.1 Create `subscription.service.ts` skeleton with `ensureStripeCustomer`
    - Create `backend/src/modules/payments/subscription.service.ts`
    - Add imports: `Stripe` from `'stripe'`, `stripe` from `'../../config/stripe'`,
      `Store` from `'../stores/store.model'`, `logger` from `'../../utils/logger'`,
      `lookupPlan` from `'../../config/planLimits'`
    - Implement `export async function ensureStripeCustomer(storeId: string, email: string): Promise<string>`:
      - Load store by `_id`; if `stripeCustomerId` already set, return it immediately
        (no Stripe API call)
      - Call `stripe.customers.create({ email, metadata: { storeId } })`
      - On Stripe API failure: throw (no partial state written, satisfies Req 2.3)
      - On Stripe success: call `Store.findByIdAndUpdate(storeId, { stripeCustomerId: customer.id })`
      - On DB write failure: log ERROR with orphaned `customer.id`, throw (satisfies
        Req 2.4)
      - On full success: return `customer.id`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.2 Implement `handleSubscriptionCreated` in `subscription.service.ts`
    - Export `async function handleSubscriptionCreated(event: Stripe.Event): Promise<void>`
    - Cast `event.data.object` as `Stripe.Subscription`
    - Log INFO on entry: `{ eventId: event.id, type: event.type, customerId: sub.customer }`
    - Look up Store by `stripeCustomerId === sub.customer`; if not found, log WARN and
      return (HTTP 200 is handled upstream)
    - Only proceed when `sub.status === 'active' || sub.status === 'trialing'`
    - Resolve `priceId` from `sub.items.data[0].price.id`; call `lookupPlan(priceId)`
    - If `lookupPlan` returns `undefined`: log WARN with `{ eventId, priceId }` and
      return
    - Update store: `{ subscriptionPlan: plan, subscriptionStatus: 'active', stripeSubscriptionId: sub.id, subscriptionEndsAt: new Date(sub.current_period_end * 1000) }`
    - Log INFO on status change: `{ storeId, oldStatus, newStatus: 'active' }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 3.3 Implement `handleSubscriptionUpdated` in `subscription.service.ts`
    - Export `async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void>`
    - Cast `event.data.object` as `Stripe.Subscription`
    - Log INFO on entry: `{ eventId: event.id, type: event.type, subscriptionId: sub.id }`
    - Look up Store by `stripeSubscriptionId === sub.id`; if not found, log WARN and
      return
    - Branch on `sub.status`:
      - `'active'`: resolve `lookupPlan(priceId)`; if undefined → WARN and return; else
        update `{ subscriptionPlan: plan, subscriptionStatus: 'active', subscriptionEndsAt: new Date(sub.current_period_end * 1000) }`; log INFO status change
      - `'past_due'`: update `{ subscriptionStatus: 'past_due' }`; do NOT touch plan;
        log INFO status change
      - `'canceled'` | `'unpaid'`: update `{ subscriptionStatus: 'cancelled', subscriptionPlan: 'free', subscriptionEndsAt: null }`; log INFO status change
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.4 Implement `handleSubscriptionDeleted` in `subscription.service.ts`
    - Export `async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void>`
    - Cast `event.data.object` as `Stripe.Subscription`
    - Log INFO on entry: `{ eventId: event.id, type: event.type, subscriptionId: sub.id }`
    - Look up Store by `stripeSubscriptionId === sub.id`; if not found, log WARN and
      return
    - Update store: `{ subscriptionStatus: 'cancelled', subscriptionPlan: 'free', subscriptionEndsAt: null, stripeSubscriptionId: null }`
    - Log INFO status change: `{ storeId, oldStatus, newStatus: 'cancelled' }`
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ] 3.5 Implement `handleInvoicePaymentSucceeded` in `subscription.service.ts`
    - Export `async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void>`
    - Cast `event.data.object` as `Stripe.Invoice`
    - Log INFO on entry: `{ eventId: event.id, type: event.type, subscriptionId: invoice.subscription }`
    - Early-return (no store update) when `invoice.billing_reason` is not
      `'subscription_cycle'` or `'subscription_create'`
    - Look up Store by `stripeSubscriptionId === invoice.subscription`; if not found,
      log WARN and return
    - Snapshot `oldStatus = store.subscriptionStatus` for audit log
    - Build update: `{ subscriptionStatus: 'active', subscriptionEndsAt: new Date(invoice.lines.data[0].period.end * 1000) }`
    - If `oldStatus === 'past_due'`: also add `{ subscriptionDunningStartedAt: null, suspensionScheduled: false }` to the update
    - Execute `Store.findOneAndUpdate(...)` — **re-throw** any DB error (so Stripe
      retries via HTTP 500, satisfying Req 8.6)
    - Log INFO status change on success
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 3.6 Implement `handleInvoicePaymentFailed` in `subscription.service.ts`
    - Export `async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void>`
    - Cast `event.data.object` as `Stripe.Invoice`
    - Log INFO on entry: `{ eventId: event.id, type: event.type, subscriptionId: invoice.subscription }`
    - Look up Store by `stripeSubscriptionId === invoice.subscription`; if not found,
      log WARN and return
    - Build base update: `{ subscriptionStatus: 'past_due' }`
    - Only add `subscriptionDunningStartedAt: new Date()` when
      `store.subscriptionDunningStartedAt` is already `null`/`undefined` (idempotent
      on repeated failures)
    - Execute update; log INFO status change
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 4. Integration — wire handlers into `payment.service.ts`

  - [ ] 4.1 Add subscription event case arms to the `switch` block
    - Import all five handler functions from `'./subscription.service'` at the top of
      `payment.service.ts`
    - Inside the `switch(event.type)` block, add five new cases before `default`:
      ```typescript
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event); break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event); break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event); break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event); break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event); break;
      ```
    - _Requirements: 5.1, 6.1, 7.1, 8.1, 9.1_

  - [ ] 4.2 Wire outer try/catch with correct HTTP semantics
    - Wrap the entire dispatch block (steps 3–6 in the design pseudocode) in a
      `try/catch`
    - In the `catch` block:
      - Log ERROR: `{ eventId: event.id, type: event.type, stack: err.stack }`
      - For `invoice.payment_succeeded` DB failures specifically, **re-throw** so the
        controller can respond HTTP 500 (satisfying Req 8.6 and 11.1 exception)
      - For all other errors, absorb the exception and allow the controller to respond
        HTTP 200 (satisfying Req 11.1, 11.2)
    - Duplicate-key errors (`code 11000`) from `StripeWebhookEvent.create()` should be
      treated as non-errors: log INFO "race-condition duplicate ignored" and continue
    - _Requirements: 3.4, 11.1, 11.2, 12.5_

  - [ ] 4.3 Verify `payment.routes.ts` content-type coverage
    - Open `payment.routes.ts` and check the `express.raw({ type: ... })` call for the
      `/webhook` route
    - If `type` is a string `'application/json'` only, update it to accept both:
      ```typescript
      express.raw({ type: ['application/json', 'application/octet-stream'] })
      ```
    - If it already accepts both content-types (or uses `type: '*/*'`), leave it
      unchanged and add a comment confirming coverage
    - _Requirements: 3.1_

- [ ] 5. Dunning & Operations — scheduled job, logging, and property tests

  - [ ] 5.1 Implement `runDunningJob` in `subscription.service.ts`
    - Add `export async function runDunningJob(): Promise<void>` at the bottom of
      `subscription.service.ts`
    - Compute cutoff: `const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)`
    - Execute bulk update:
      ```typescript
      await Store.updateMany(
        {
          subscriptionStatus: 'past_due',
          subscriptionDunningStartedAt: { $lt: cutoff },
        },
        {
          $set: {
            subscriptionStatus: 'suspended',
            subscriptionDunningStartedAt: null,
          },
        }
      );
      ```
    - Wrap in `try/catch`; on error: log ERROR with timestamp and swallow (don't crash)
    - Log INFO after success: `{ jobRun: 'dunningJob', cutoff, modifiedCount }`
    - _Requirements: 9.4, 9.5_

  - [ ] 5.2 Register dunning job in `server.ts`
    - Import `runDunningJob` from `'./modules/payments/subscription.service'`
    - After `await connectDatabase()` succeeds (inside the `try` block, before step 3),
      add:
      ```typescript
      setInterval(runDunningJob, 60 * 60 * 1000);
      logger.info('Dunning job registered — runs every 60 minutes');
      ```
    - Keep `runDunningJob` exported from `subscription.service.ts` (already done in
      5.1) so it can be imported directly in tests without going through `server.ts`
    - _Requirements: 9.4, 9.5_

  - [ ] 5.3 Add structured logging to all five handlers per Req 12
    - Audit each of the five handlers in `subscription.service.ts` and confirm all
      required log calls are in place (tasks 3.2–3.6 specify them inline; this task
      verifies completeness):
      - **INFO on entry**: `eventId`, `type`, `customerId` or `subscriptionId`
      - **INFO on status change**: `storeId`, `oldStatus`, `newStatus`
      - **WARN on missing store**: `eventId`, `type`, searched identifier
      - **WARN on unknown priceId**: `eventId`, `type`, unrecognised Price ID
      - **ERROR on unhandled exception**: caught at outer level in `payment.service.ts`
        (task 4.2) — confirm `eventId`, `type`, and `stack` are included
    - Fix any gaps found in the audit
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 5.4 Write property-based tests in `subscription.property.test.ts`
    - Create `backend/tests/properties/subscription.property.test.ts`
    - Follow the pattern from `scaffolding.property.test.ts`: import `* as fc from 'fast-check'`, use `fc.assert(fc.asyncProperty(...), { numRuns: 100 })`
    - Tag each test with `// Feature: stripe-subscription-billing, Property N:`
    - Implement all 12 correctness properties from design.md:
      - **Property 1 — Webhook Idempotency**
        - Generator: `fc.record({ eventId: fc.uuid(), eventType: fc.constantFrom('customer.subscription.created', 'customer.subscription.updated', 'invoice.payment_succeeded') })`
        - Assert: processing same event N ≥ 1 times leaves exactly one `StripeWebhookEvent` document
        - **Validates: Requirements 4.1, 4.2, 4.3**
      - **Property 2 — Subscription Created Produces Correct Store State**
        - Generator: `fc.record({ priceId: fc.constantFrom(...knownPriceIds), periodEnd: fc.integer({ min: 0 }) })`
        - Assert: `subscriptionPlan === lookupPlan(priceId)`, `subscriptionStatus === 'active'`, `stripeSubscriptionId` set, `subscriptionEndsAt` equals `new Date(periodEnd * 1000)`
        - **Validates: Requirements 5.2**
      - **Property 3 — Past-Due Status Does Not Change Plan**
        - Generator: `fc.constantFrom('starter', 'pro', 'enterprise')` for initial plan
        - Assert: after `customer.subscription.updated` with `status: 'past_due'`, `subscriptionPlan` is unchanged
        - **Validates: Requirements 6.3**
      - **Property 4 — Cancellation Always Produces Free Plan**
        - Generator: `fc.constantFrom('canceled', 'unpaid')` for event status
        - Assert: `subscriptionPlan === 'free'` and `subscriptionStatus === 'cancelled'`
        - **Validates: Requirements 6.4, 7.2**
      - **Property 5 — Invoice Payment Succeeded Clears Dunning State**
        - Generator: `fc.date()` for `subscriptionDunningStartedAt`
        - Assert: after success event, `subscriptionDunningStartedAt === null` and `suspensionScheduled === false`
        - **Validates: Requirements 8.2, 8.3**
      - **Property 6 — Dunning StartedAt Is Idempotent on Repeated Failures**
        - Generator: `fc.nat({ max: 5 })` for repeat count (≥ 2)
        - Assert: timestamp after N failures equals timestamp after first failure
        - **Validates: Requirements 9.3**
      - **Property 7 — Dunning Job Suspends Stores Past Grace Period**
        - Generator: `fc.integer({ min: 7 * 24 * 60 * 60 * 1000 + 1 })` for age offset
        - Assert: `subscriptionStatus === 'suspended'`, `subscriptionDunningStartedAt === null`
        - **Validates: Requirements 9.5**
      - **Property 8 — Dunning Job Preserves Stores Within Grace Period**
        - Generator: `fc.integer({ min: 1, max: 7 * 24 * 60 * 60 * 1000 - 1 })` for age offset
        - Assert: `subscriptionStatus` and `subscriptionPlan` are unchanged
        - **Validates: Requirements 9.4**
      - **Property 9 — PriceMap Never Returns 'free'**
        - Generator: `fc.constantFrom(...knownPriceIds)`
        - Assert: `lookupPlan(priceId) !== 'free'` and is one of `['starter', 'pro', 'enterprise']`
        - **Validates: Requirements 10.1, 10.2**
      - **Property 10 — PriceMap Returns undefined for Unknown Price IDs**
        - Generator: `fc.string().filter(s => !knownPriceIds.includes(s))`
        - Assert: `lookupPlan(unknownId) === undefined`
        - **Validates: Requirements 10.3**
      - **Property 11 — HTTP 200 for All Post-Verification Events**
        - Generator: `fc.constantFrom(...allEventTypes, 'unknown.event.type')`
        - Assert: response status is 200 for every event type that passes signature check
        - **Validates: Requirements 11.1, 11.2**
      - **Property 12 — Audit Log Entry on Every Status Change**
        - Generator: `fc.constantFrom(...validStatusTransitions)` (e.g., `active→past_due`, `past_due→active`, `active→cancelled`)
        - Assert: logger INFO was called with `{ storeId, oldStatus, newStatus }` for each transition
        - **Validates: Requirements 12.2**

- [ ] 6. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Tasks 3.1–3.6 all land in the same new file; only 3.1 creates it — 3.2–3.6 append
  to it. Execute them sequentially (reflected in the dependency graph)
- Task 2.2 removes `stripeEventId` from inside `handlePaymentSucceeded` and
  `handlePaymentFailed` — those handlers will still create `Payment` records, just
  without the now-redundant `stripeEventId` field. If the `IPayment` interface keeps
  the field as required, either make it optional or retain it with a comment explaining
  the move
- `invoice.payment_succeeded` is the only event whose DB failure should propagate as
  HTTP 500 (Req 8.6). All other DB failures are absorbed and logged (Req 11.1)
- `runDunningJob` is a pure MongoDB operation — no Stripe API calls — so it is safe to
  run repeatedly without incurring Stripe rate limits
- Property tests (5.4) use in-memory mocking of `Store` and `StripeWebhookEvent` to
  avoid needing a live MongoDB during CI; see `scaffolding.property.test.ts` for the
  established mocking pattern
- Each property test is independent and can be run in isolation with
  `jest --testPathPattern subscription.property`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "2.2", "3.1"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["4.1", "4.3"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4"] }
  ]
}
```
