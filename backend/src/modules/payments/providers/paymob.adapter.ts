/**
 * PaymobAdapter
 *
 * Implements `IPaymentProvider` for the Paymob payment gateway (MENA region).
 *
 * ── Paymob payment flow (3-step) ─────────────────────────────────────────────
 * 1. Authenticate   → POST /api/auth/tokens        → returns auth_token
 * 2. Create order   → POST /api/ecommerce/orders   → returns paymob_order_id
 * 3. Get pay key    → POST /api/acceptance/payment_keys → returns payment_token
 *
 * The frontend then uses the payment_token to open the Paymob iframe or
 * redirect to the hosted payment page.
 *
 * ── Webhook / callback verification ──────────────────────────────────────────
 * Paymob sends an HMAC-SHA512 callback. The adapter verifies it by:
 * 1. Extracting the fields Paymob specifies from the `obj` query/body params
 * 2. Concatenating them in the documented order
 * 3. Computing HMAC-SHA512 with PAYMOB_HMAC_SECRET
 * 4. Comparing with the `hmac` field sent by Paymob
 *
 * ── Required env vars ────────────────────────────────────────────────────────
 *   PAYMOB_API_KEY              — from Paymob Dashboard → Settings → API Key
 *   PAYMOB_SECRET_KEY           — from Paymob Dashboard → Developers → Secret Key
 *   PAYMOB_HMAC_SECRET          — from Paymob Dashboard → Developers → HMAC Secret
 *   PAYMOB_INTEGRATION_ID_CARD  — card payment integration ID
 *   PAYMOB_INTEGRATION_ID_WALLET (optional) — mobile wallet integration ID
 *
 * ⚠️  Store real values in .env ONLY — never commit them to source control.
 */

import crypto from 'crypto';
import https from 'https';
import { config } from '../../../config/index';
import { Order } from '../../orders/order.model';
import { Payment } from '../payment.model';
import { Types } from 'mongoose';
import { logger } from '../../../utils/logger';
import type {
  IPaymentProvider,
  InitiatePaymentParams,
  InitiatePaymentResult,
  RefundPaymentParams,
  RefundPaymentResult,
  ProviderEvent,
  PaymentProviderKey,
} from './payment-provider.interface';
import { RefundNotSupportedError } from './payment-provider.interface';

// ── Paymob API base URL ───────────────────────────────────────────────────────
const PAYMOB_BASE_URL = 'https://accept.paymob.com';

// ── HTTP helper (no axios dependency — uses built-in https) ───────────────────

function paymobPost<T>(path: string, body: unknown, authToken?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr)),
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const url = new URL(path, PAYMOB_BASE_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as T;
          resolve(parsed);
        } catch {
          reject(new Error(`Paymob API parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on strings short-circuits at the first differing character, so the
 * comparison takes longer the more leading characters a candidate gets right.
 * That turns webhook verification into an oracle an attacker can walk one
 * character at a time to forge a signature without the HMAC secret. Remote
 * timing attacks over HTTP are noisy and impractical, but this is a payment
 * authenticity check and the constant-time version costs nothing.
 *
 * Matches `digestsMatch` in auth/auth.service.ts, with one deliberate
 * difference: the buffers are built as **utf8, not hex**. `receivedHmac` is
 * attacker-controlled, and `Buffer.from(str, 'hex')` silently truncates at the
 * first non-hex character — `Buffer.from('zz…', 'hex')` is an EMPTY buffer.
 * `timingSafeEqual` then throws on the length mismatch rather than returning
 * false, turning a malformed signature into an unhandled 500. Comparing the hex
 * strings byte-for-byte as utf8 is equivalent in security terms and total over
 * any input. The auth.service variant is safe as written because both of its
 * operands are digests this codebase produced.
 *
 * The length check leaks only the length of a signature the caller already
 * chose, which is not secret.
 */
function signaturesMatch(computed: string, received: string): boolean {
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class PaymobAdapter implements IPaymentProvider {
  readonly name: PaymentProviderKey = 'paymob';

  // ── Step helpers ─────────────────────────────────────────────────────────

  /** Step 1: Exchange API key for a short-lived auth token. */
  private async authenticate(): Promise<string> {
    const apiKey = config.PAYMOB_API_KEY;
    if (!apiKey) throw new Error('PAYMOB_API_KEY is not configured');

    const res = await paymobPost<{ token?: string; detail?: string }>(
      '/api/auth/tokens',
      { api_key: apiKey }
    );

    if (!res.token) {
      throw new Error(`Paymob authentication failed: ${res.detail ?? JSON.stringify(res)}`);
    }
    return res.token;
  }

  // ── refundPayment ────────────────────────────────────────────────────────

  /**
   * Reverses a Paymob transaction via `/api/acceptance/void_refund/refund`.
   *
   * Paymob refunds are asynchronous: the endpoint accepts the request and the
   * outcome arrives on the transaction callback. This therefore reports
   * `pending`, and the caller must treat that as "money is on its way" rather
   * than as a failure.
   *
   * There is no idempotency key in Paymob's API. A retried refund can
   * double-refund at the gateway, so the caller's reservation on the order
   * ledger — which refuses a second refund beyond the remaining balance — is
   * the only protection. That is why `refundPayment` is called AFTER the
   * reservation, never before.
   */
  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const { providerPaymentId, amountInSmallestUnit } = params;

    if (!providerPaymentId) {
      throw new RefundNotSupportedError(
        'Paymob',
        'no transaction id was recorded for this order'
      );
    }

    const authToken = await this.authenticate();

    const res = await paymobPost<{
      id?: number | string;
      success?: boolean | string;
      message?: string;
      detail?: string;
    }>(
      '/api/acceptance/void_refund/refund',
      {
        transaction_id: providerPaymentId,
        amount_cents: String(amountInSmallestUnit),
      },
      authToken
    );

    // Paymob signals failure with a `message`/`detail` body rather than an HTTP
    // status the helper would surface, so the body has to be inspected.
    const accepted = res.success === true || res.success === 'true' || Boolean(res.id);
    if (!accepted) {
      throw new Error(
        `Paymob refund rejected: ${res.message ?? res.detail ?? JSON.stringify(res)}`
      );
    }

    return {
      providerRefundId: String(res.id ?? `paymob_refund_${providerPaymentId}`),
      status: 'pending',
    };
  }

  /** Step 2: Register the order with Paymob and get a Paymob order ID. */
  private async createPaymobOrder(
    authToken: string,
    amountCents: number,
    currency: string,
    merchantOrderId: string
  ): Promise<number> {
    const res = await paymobPost<{ id?: number; detail?: string }>(
      '/api/ecommerce/orders',
      {
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: amountCents,
        currency,
        merchant_order_id: merchantOrderId,
        items: [],
      }
    );

    if (!res.id) {
      throw new Error(`Paymob order creation failed: ${res.detail ?? JSON.stringify(res)}`);
    }
    return res.id;
  }

  /** Step 3: Obtain a payment key (token) for the iframe / redirect. */
  private async getPaymentKey(
    authToken: string,
    paymobOrderId: number,
    amountCents: number,
    currency: string,
    billingData: Record<string, string>
  ): Promise<string> {
    const integrationId = config.PAYMOB_INTEGRATION_ID_CARD;
    if (!integrationId) throw new Error('PAYMOB_INTEGRATION_ID_CARD is not configured');

    // The callback_url tells Paymob where to POST the HMAC-signed transaction
    // result after the customer completes or fails payment. Without this field,
    // Paymob will NOT fire the webhook even if "Auto Callback" is enabled in
    // the dashboard. The path must match the registered route exactly.
    const callbackUrl = `${config.BACKEND_URL}/api/v1/payments/paymob/webhook`;

    const res = await paymobPost<{ token?: string; detail?: string }>(
      '/api/acceptance/payment_keys',
      {
        auth_token: authToken,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        billing_data: billingData,
        currency,
        integration_id: parseInt(integrationId, 10),
        callback_url: callbackUrl,
      }
    );

    if (!res.token) {
      throw new Error(`Paymob payment key request failed: ${res.detail ?? JSON.stringify(res)}`);
    }

    logger.info('PaymobAdapter: payment key obtained', {
      paymobOrderId,
      callbackUrl,
      integrationId,
    });

    return res.token;
  }

  // ── IPaymentProvider.initiatePayment ─────────────────────────────────────

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const { orderId, customerId, storeId, amountInSmallestUnit, currency } = params;

    const order = await Order.findOne({
      _id: orderId,
      customerId: new Types.ObjectId(customerId),
      storeId: new Types.ObjectId(storeId),
    }).lean();

    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status !== 'pending') {
      throw new Error(`Cannot initiate payment for order in status '${order.status}'`);
    }

    // Step 1 — Auth
    const authToken = await this.authenticate();

    // Step 2 — Paymob order
    const paymobOrderId = await this.createPaymobOrder(
      authToken,
      amountInSmallestUnit,
      currency.toUpperCase(),
      orderId
    );

    // Step 3 — Payment key (iframe token)
    // Billing data fields are validated by Paymob. Use realistic test values.
    const billingData = {
      apartment:       'NA',
      email:           'test@paymob.com',   // use a real-looking email
      floor:           'NA',
      first_name:      'Test',
      last_name:       'User',
      street:          'NA',
      building:        'NA',
      phone_number:    '+201000000000',     // valid EG format: +2 then 01xxxxxxxx
      shipping_method: 'NA',
      postal_code:     'NA',
      city:            'Cairo',
      country:         'EG',
      state:           'NA',
    };

    const paymentToken = await this.getPaymentKey(
      authToken,
      paymobOrderId,
      amountInSmallestUnit,
      currency.toUpperCase(),
      billingData
    );

    // Store Paymob's order ID on the Vendbase order for later reconciliation.
    await Order.updateOne(
      { _id: orderId },
      { paymentIntentId: String(paymobOrderId) }
    );

    return {
      providerPaymentId: String(paymobOrderId),
      clientData: {
        paymentToken,
        // The iframe URL requires the PAYMOB_IFRAME_ID (from Paymob Dashboard → Developers → Iframes).
        // This is DIFFERENT from PAYMOB_INTEGRATION_ID_CARD (used in Step 3 for payment key generation).
        iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${config.PAYMOB_IFRAME_ID ?? config.PAYMOB_INTEGRATION_ID_CARD}?payment_token=${paymentToken}`,
      },
    };
  }

  // ── IPaymentProvider.verifyWebhookSignature ───────────────────────────────
  //
  // Paymob sends an HMAC-SHA512 callback. The fields to concatenate are
  // documented at: https://docs.paymob.com/docs/transaction-webhooks
  //
  // The callback arrives as a POST body with `obj` (transaction) and `hmac`.

  async verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<ProviderEvent> {
    const hmacSecret = config.PAYMOB_HMAC_SECRET;
    if (!hmacSecret) throw new Error('PAYMOB_HMAC_SECRET is not configured');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
    } catch {
      throw new Error('Paymob webhook: invalid JSON body');
    }

    // Non-transaction events (e.g. type: "TOKEN") don't carry an HMAC or the
    // transaction obj fields. Skip HMAC verification for those and return early.
    const eventType = payload.type as string | undefined;
    if (eventType && eventType !== 'TRANSACTION') {
      logger.info('PaymobAdapter: skipping HMAC for non-TRANSACTION event', { type: eventType });
      return { eventId: `paymob_nontx_${Date.now()}`, type: 'unknown', rawEvent: payload };
    }

    // Paymob sends the HMAC as a URL query parameter (?hmac=...), NOT in the
    // JSON body. The controller extracts it from req.query and injects it as
    // the synthetic 'x-paymob-hmac' header before calling this method.
    const receivedHmac = (
      (headers['x-paymob-hmac'] as string | undefined)
      ?? (payload.hmac as string | undefined)   // fallback: body (future-proofing)
    )?.toLowerCase();
    const obj = (payload.obj as Record<string, unknown>) ?? {};

    // Build the concatenated string in Paymob's documented field order.
    // Rules per Paymob docs:
    //   - Boolean fields: use literal "true" or "false" (lowercase)
    //   - Numeric fields: use the number as a string, no decimals
    //   - The `order` field: concatenate obj.order.id (not the whole order object)
    //   - Nested fields (source_data.*): traverse the nested object
    //   - Missing fields: use empty string ""
    const hmacFields = [
      'amount_cents', 'created_at', 'currency', 'error_occured',
      'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
      'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
      'is_voided', 'order', 'owner', 'pending',
      'source_data.pan', 'source_data.sub_type', 'source_data.type',
      'success',
    ];

    // Names only — never the values. A field absent from the payload is the
    // usual cause of a mismatch (Paymob adds or renames one, or a wallet
    // transaction simply has no card fields), and the NAME is enough to
    // diagnose that. See the failure branch below.
    const missingFields: string[] = [];

    const concatenated = hmacFields.map((field) => {
      let value: string;

      if (field.includes('.')) {
        // Nested field: e.g. source_data.pan
        const [parent, child] = field.split('.');
        const parentObj = obj[parent] as Record<string, unknown> | undefined;
        const raw = parentObj?.[child];
        value = raw == null ? '' : String(raw);
      } else if (field === 'order') {
        // Special case: use obj.order.id, not the order object itself
        const orderObj = obj.order as Record<string, unknown> | undefined;
        const raw = orderObj?.id;
        value = raw == null ? '' : String(raw);
      } else {
        const raw = obj[field];
        value = raw == null ? '' : String(raw);
      }

      if (value === '') missingFields.push(field);
      return value;
    }).join('');

    const computedHmac = crypto
      .createHmac('sha512', hmacSecret)
      .update(concatenated)
      .digest('hex')
      .toLowerCase();

    if (!receivedHmac || !signaturesMatch(computedHmac, receivedHmac)) {
      // ── What is deliberately NOT logged here ────────────────────────────────
      // This replaced an unconditional INFO log that fired on EVERY webhook and
      // dumped the full field breakdown — including `source_data.pan`, the
      // cardholder `owner`, the whole concatenated preimage, and the received
      // signature — into the persistent log file. It was left-over debug
      // instrumentation on the payment path.
      //
      // Retained: the transaction reference and which fields were empty, which
      // is what actually diagnoses a mismatch.
      // Dropped: every field VALUE, the preimage, and both signatures. A
      // signature is not a credential, but logging one invites replaying it
      // out of the log, and none of it is needed to find the fault.
      logger.warn('PaymobAdapter: HMAC signature mismatch — event rejected', {
        transId: String(obj.id ?? '(none)'),
        hmacPresent: Boolean(receivedHmac),
        fieldCount: hmacFields.length,
        missingFields,
      });
      throw new Error('Paymob webhook: HMAC signature mismatch');
    }

    return this.normaliseEvent(payload, obj);
  }

  // ── IPaymentProvider.handleProviderEvent ─────────────────────────────────

  async handleProviderEvent(event: ProviderEvent): Promise<void> {
    const paymobPayload = event.rawEvent as Record<string, unknown>;
    const obj = (paymobPayload.obj as Record<string, unknown>) ?? {};

    const isSuccess = obj.success === true || obj.success === 'true';
    const isPending = obj.pending === true || obj.pending === 'true';
    const orderId   = event.orderId;
    const transId   = String(obj.id ?? '');

    logger.info('PaymobAdapter: processing event', {
      eventId: event.eventId,
      type: event.type,
      transId,
      orderId,
      isSuccess,
      isPending,
    });

    if (!orderId) {
      logger.warn('PaymobAdapter: no orderId in event — skipping', { eventId: event.eventId });
      return;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      logger.warn('PaymobAdapter: order not found', { orderId, eventId: event.eventId });
      return;
    }

    const oldStatus = order.status;

    if (event.type === 'payment.succeeded' && isSuccess && !isPending) {
      try {
        await Payment.create({
          orderId: new Types.ObjectId(orderId),
          customerId: order.customerId,
          stripePaymentIntentId: `paymob_${transId}`, // legacy prefixed form, kept for back-compat
          provider: 'paymob',
          providerPaymentId: transId,
          amount: Number(obj.amount_cents ?? 0),
          currency: String(obj.currency ?? 'egp').toLowerCase(),
          status: 'succeeded',
          stripeEventId: event.eventId,
        });
      } catch (err: unknown) {
        const mongoErr = err as { code?: number };
        if (mongoErr.code === 11000) {
          logger.info('PaymobAdapter: duplicate transaction ignored (idempotency)', {
            transId,
            eventId: event.eventId,
          });
          return;
        }
        throw err;
      }

      order.status = 'processing';
      // Payment is its own axis. Setting it here is what makes the order
      // refundable — without it the refund service sees `unpaid` and refuses to
      // return money Paymob genuinely collected.
      order.paymentStatus = 'paid';
      await order.save();

      logger.info('PaymobAdapter: payment succeeded — order updated to processing', {
        storeId: order.storeId.toString(),
        orderId,
        oldStatus,
        newStatus: 'processing',
        transId,
      });

    } else if (event.type === 'payment.failed') {
      try {
        await Payment.create({
          orderId: new Types.ObjectId(orderId),
          customerId: order.customerId,
          stripePaymentIntentId: `paymob_${transId}`,
          provider: 'paymob',
          providerPaymentId: transId,
          amount: Number(obj.amount_cents ?? 0),
          currency: String(obj.currency ?? 'egp').toLowerCase(),
          status: 'failed',
          stripeEventId: event.eventId,
        });
      } catch (err: unknown) {
        const mongoErr = err as { code?: number };
        if (mongoErr.code === 11000) {
          logger.info('PaymobAdapter: duplicate failed transaction ignored', {
            transId,
            eventId: event.eventId,
          });
          return;
        }
        throw err;
      }

      logger.info('PaymobAdapter: payment failed — order remains pending', {
        orderId,
        oldStatus,
        transId,
      });
    } else {
      logger.info('PaymobAdapter: unhandled event type — no action taken', {
        type: event.type,
        eventId: event.eventId,
      });
    }
  }

  // ── Private: normalise Paymob callback → ProviderEvent ───────────────────

  private normaliseEvent(
    payload: Record<string, unknown>,
    obj: Record<string, unknown>
  ): ProviderEvent {
    const isSuccess = obj.success === true || obj.success === 'true';
    const isPending = obj.pending === true || obj.pending === 'true';
    const transId   = String(obj.id ?? Date.now());

    // Extract the Vendbase orderId from Paymob's order.merchant_order_id
    const paymobOrder = obj.order as Record<string, unknown> | undefined;
    const orderId = String(paymobOrder?.merchant_order_id ?? '');

    let type: ProviderEvent['type'] = 'unknown';
    if (isSuccess && !isPending) type = 'payment.succeeded';
    else if (!isSuccess && !isPending) type = 'payment.failed';

    return {
      eventId: `paymob_${transId}`,
      type,
      rawEvent: payload,
      orderId: orderId || undefined,
    };
  }
}
