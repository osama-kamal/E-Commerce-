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
  ProviderEvent,
  PaymentProviderKey,
} from './payment-provider.interface';

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
      }
    );

    if (!res.token) {
      throw new Error(`Paymob payment key request failed: ${res.detail ?? JSON.stringify(res)}`);
    }
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

    const fieldValues: Record<string, string> = {};

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

      fieldValues[field] = value;
      return value;
    }).join('');

    // Log the exact concatenated string and field breakdown for debugging
    logger.info('Paymob HMAC debug', {
      receivedHmac: receivedHmac ?? '(none)',
      concatenatedLength: concatenated.length,
      concatenatedPreview: concatenated.slice(0, 300),
      fieldValues,
    });

    const computedHmac = crypto
      .createHmac('sha512', hmacSecret)
      .update(concatenated)
      .digest('hex')
      .toLowerCase();

    if (!receivedHmac || computedHmac !== receivedHmac) {
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
          stripePaymentIntentId: `paymob_${transId}`, // reuse field — provider-agnostic ID
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
