/**
 * Payment Provider Abstraction Layer
 *
 * This interface defines the domain-level contract that any payment provider
 * must satisfy to integrate with Vendbase. It is intentionally designed around
 * Vendbase's domain operations — not around any specific provider's API surface.
 *
 * Current implementations:
 *   - StripeAdapter (stripe.adapter.ts) — production
 *
 * Planned implementations:
 *   - PaymobAdapter (paymob.adapter.ts) — MENA/Egypt market
 *
 * ── How to add a new provider ─────────────────────────────────────────────────
 * 1. Create `<provider>.adapter.ts` implementing `IPaymentProvider`
 * 2. Register it in `payment-provider.factory.ts`
 * 3. Add the provider key to `PaymentProviderKey` below
 * 4. Wire any new env vars in `config/index.ts`
 *
 * The existing `payment.service.ts` is NOT modified during this step.
 * Migration happens when a real second provider is ready to ship.
 */

// ── Shared domain types ────────────────────────────────────────────────────────

/**
 * Supported payment provider identifiers.
 * Extend this union when a new adapter is added.
 */
export type PaymentProviderKey = 'stripe' | 'paymob';

/**
 * Parameters for initiating a payment.
 * All monetary amounts are in the smallest currency unit (e.g. cents for USD,
 * piastres for EGP) to match Stripe's convention and avoid float errors.
 */
export interface InitiatePaymentParams {
  /** Internal Vendbase order ID (MongoDB ObjectId as string) */
  orderId: string;
  /** Internal Vendbase customer/user ID */
  customerId: string;
  /** Internal Vendbase store ID — used for multi-tenant scoping */
  storeId: string;
  /** Total amount in smallest currency unit */
  amountInSmallestUnit: number;
  /** ISO 4217 currency code, e.g. 'usd', 'egp' */
  currency: string;
  /**
   * Optional idempotency key supplied by the caller.
   * Prevents duplicate charges on retry.
   * Defaults to `order_intent_{orderId}` if omitted.
   */
  idempotencyKey?: string;
}

/**
 * What the provider returns after initiating payment.
 *
 * Different providers return different data to the client:
 *   - Stripe: a `clientSecret` used by Stripe.js / Stripe Elements
 *   - Paymob: a `paymentToken` used to construct an iframe/redirect URL
 *
 * The `providerPaymentId` is the provider's own reference (pi_xxx, order_id).
 * The `clientData` bag carries whatever the frontend needs — provider-specific
 * fields are included here rather than polluting the interface signature.
 */
export interface InitiatePaymentResult {
  /** Provider-side payment reference (e.g. Stripe PaymentIntent ID, Paymob order ID) */
  providerPaymentId: string;
  /** All data the frontend needs to complete payment (provider-specific) */
  clientData: Record<string, string>;
}

/**
 * A normalised representation of an inbound provider event (webhook/callback).
 *
 * Each adapter is responsible for translating its raw webhook payload into
 * this shape so the rest of the system stays provider-agnostic.
 */
export interface ProviderEvent {
  /** Provider's own globally-unique event identifier */
  eventId: string;
  /**
   * Normalised event type using Vendbase's domain vocabulary.
   * Adapters map provider-specific types (e.g. 'payment_intent.succeeded')
   * to these values.
   */
  type:
    | 'payment.succeeded'
    | 'payment.failed'
    /**
     * A refund settled at the provider.
     *
     * Also fires for refunds issued directly in the provider's dashboard, which
     * this system never initiated — reconciling those is what stops the local
     * ledger drifting from what the gateway actually did.
     */
    | 'refund.succeeded'
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.deleted'
    | 'invoice.paid'
    | 'invoice.payment_failed'
    | 'unknown';
  /** The provider's raw event object — passed through for handler use */
  rawEvent: unknown;
  /** Extracted Vendbase order ID if present in the event metadata */
  orderId?: string;
  /** Extracted Vendbase customer ID if present in the event metadata */
  customerId?: string;
  /** Extracted Vendbase store ID if present in the event metadata */
  storeId?: string;
}

/**
 * Parameters for reversing a payment, in whole or in part.
 */
export interface RefundPaymentParams {
  /** The provider's own payment reference, unprefixed (`pi_xxx`, Paymob transaction id). */
  providerPaymentId: string;
  /** Amount to return, in the smallest currency unit. */
  amountInSmallestUnit: number;
  /** ISO 4217, lowercase — matches the original charge. */
  currency: string;
  /**
   * Makes a retried refund safe.
   *
   * Load-bearing: a refund request that times out but succeeded at the gateway
   * must not send the money twice when the merchant clicks again.
   */
  idempotencyKey: string;
  /** Free-text reason, forwarded where the provider supports it. */
  reason?: string;
}

export interface RefundPaymentResult {
  /** The provider's own refund reference. */
  providerRefundId: string;
  /**
   * `succeeded` when the provider confirms synchronously, `pending` when it
   * will confirm by webhook. Callers must treat `pending` as "money is on its
   * way", not "nothing happened".
   */
  status: 'succeeded' | 'pending';
}

/**
 * Thrown when a provider cannot reverse a payment at all.
 *
 * Distinct from a failed refund: this means the capability is absent, so the
 * caller should tell the merchant to refund out-of-band rather than retry.
 */
export class RefundNotSupportedError extends Error {
  constructor(provider: string, detail?: string) {
    super(
      `${provider} cannot process refunds through this integration` +
      (detail ? `: ${detail}` : '') +
      '. Refund the customer directly in the provider dashboard, then record it here.'
    );
    this.name = 'RefundNotSupportedError';
  }
}

// ── Core interface ─────────────────────────────────────────────────────────────

/**
 * `IPaymentProvider` is the single seam between Vendbase's payment service
 * and any external payment gateway.
 *
 * All three methods are async. Implementations should throw on unrecoverable
 * errors and return normally (not throw) for business-logic non-errors
 * (e.g. unknown event type → return `type: 'unknown'`).
 */
export interface IPaymentProvider {
  /** Human-readable provider name, used in logs */
  readonly name: PaymentProviderKey;

  /**
   * Initiates a payment for an order.
   *
   * The return value is passed directly to the client so it can complete the
   * payment flow (e.g. confirm with Stripe.js, open Paymob iframe).
   *
   * @throws {Error} if the provider API call fails or the order cannot be found.
   */
  initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;

  /**
   * Reverses a payment, in whole or in part.
   *
   * The caller has already validated the amount against the order ledger; the
   * adapter's job is to move the money and report the provider's reference.
   *
   * @throws {RefundNotSupportedError} when the integration cannot refund at all,
   *   so the caller can advise refunding out-of-band instead of retrying.
   * @throws {Error} when the provider rejects the refund. The caller releases
   *   its reservation, so a failure must not leave the order looking refunded.
   */
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;

  /**
   * Verifies that an inbound webhook/callback originated from the provider
   * and returns a normalised `ProviderEvent`.
   *
   * @param rawBody   The raw, unparsed request body as a Buffer.
   *                  Must be received before any JSON middleware parses it.
   * @param headers   The full set of HTTP request headers.
   *                  Signature headers (e.g. `Stripe-Signature`) are extracted here.
   *
   * @throws {Error} with an appropriate message if signature verification fails.
   *                 The caller should respond HTTP 400 in that case.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<ProviderEvent>;

  /**
   * Processes a previously verified `ProviderEvent`.
   *
   * Implementations should:
   * - Update Order / Store state in MongoDB
   * - Emit structured logs for every state transition
   * - Return normally (not throw) for all business-logic paths including
   *   "store not found" — the caller handles HTTP response codes
   *
   * The only exception: `invoice.paid` DB failures should be re-thrown so the
   * caller can respond HTTP 500 and trigger a provider retry.
   */
  handleProviderEvent(event: ProviderEvent): Promise<void>;
}
