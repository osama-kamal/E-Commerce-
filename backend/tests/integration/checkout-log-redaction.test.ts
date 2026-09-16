/**
 * Checkout-failure logging must not retain the shopper's address.
 *
 * `placeOrder`'s catch block logged `req.body` verbatim, so every failed
 * checkout wrote the customer's street, city and postcode — next to their
 * `userId` — into a persistent log file. That is personal data under GDPR,
 * kept indefinitely, in a file nobody treats as a customer record.
 *
 * The diagnostic value was in the request's SHAPE, never the address values.
 * These tests pin that the shape survives and the values do not.
 */

import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';

const placeOrderService = jest.fn();
jest.mock('../../src/modules/orders/order.service', () => ({
  placeOrder: (...args: unknown[]) => placeOrderService(...args),
}));

import { placeOrder } from '../../src/modules/orders/order.controller';
import { logger } from '../../src/utils/logger';

// A deliberately identifiable address — every one of these strings is a value
// that must not reach the log.
const PII = {
  line1: '221B Baker Street',
  city: 'Marylebone',
  state: 'Greater London',
  postalCode: 'NW1 6XE',
  country: 'GB',
};

const BODY = {
  shippingAddress: PII,
  paymentMethod: 'online',
  couponCode: 'SUMMER20',
  shippingRateId: '6a03b5108bdcd392044d1c37',
  idempotencyKey: 'idem-key-abcdefgh',
};

let captured: string;
let errorSpy: jest.SpyInstance;

function makeReq(body: unknown): Request {
  return {
    body,
    user: { userId: new Types.ObjectId(), role: 'customer', storeId: new Types.ObjectId() },
    store: { _id: new Types.ObjectId() },
  } as unknown as Request;
}

const res = { status: () => res, json: () => res } as unknown as Response;

beforeEach(() => {
  captured = '';
  placeOrderService.mockRejectedValue(new Error('shipping zone lookup failed'));
  errorSpy = jest.spyOn(logger, 'error').mockImplementation(((msg: unknown, meta?: unknown) => {
    // `JSON.stringify(new Error('x'))` is `{}` — Error's own properties are
    // non-enumerable. Winston's formatter expands them, so the capture has to
    // as well, or the assertions would be checking a string the real logger
    // never produces.
    captured += `${String(msg)} ${JSON.stringify(meta ?? {}, (_key, value) =>
      value instanceof Error ? { message: value.message, stack: value.stack } : value
    )}\n`;
  }) as never);
});

afterEach(() => {
  errorSpy.mockRestore();
});

async function failCheckout(body: unknown = BODY): Promise<void> {
  const next = jest.fn() as unknown as NextFunction;
  await placeOrder(makeReq(body), res, next);
}

describe('checkout failure logging — what must NOT appear', () => {
  it('omits every address value', async () => {
    await failCheckout();

    expect(captured).not.toContain(PII.line1);
    expect(captured).not.toContain(PII.city);
    expect(captured).not.toContain(PII.state);
    expect(captured).not.toContain(PII.postalCode);
  });

  it('omits the street address even when other fields are absent', async () => {
    await failCheckout({ shippingAddress: { line1: '221B Baker Street' } });

    expect(captured).not.toContain('221B Baker Street');
  });
});

describe('checkout failure logging — what MUST remain', () => {
  it('still records that the checkout failed, and why', async () => {
    await failCheckout();

    expect(captured).toContain('[placeOrder] Failed to place order');
    expect(captured).toContain('shipping zone lookup failed');
  });

  it('keeps the non-PII controls that identify the fault', async () => {
    await failCheckout();

    expect(captured).toContain('online');                       // paymentMethod
    expect(captured).toContain('SUMMER20');                     // coupon — a shared token
    expect(captured).toContain('6a03b5108bdcd392044d1c37');     // shippingRateId
    expect(captured).toContain('hasIdempotencyKey');
  });

  it('keeps country, which shipping-zone and tax matching key on', async () => {
    await failCheckout();

    expect(captured).toContain('GB');
  });

  it('reports which address fields arrived, so a missing one is diagnosable', async () => {
    await failCheckout();

    // The usual cause of DESTINATION_NOT_SERVED / empty tax rates.
    expect(captured).toContain('fieldsPresent');
    expect(captured).toContain('postalCode');  // the NAME, not "NW1 6XE"
  });

  it('distinguishes a missing field from a present one', async () => {
    await failCheckout({
      shippingAddress: { line1: 'x', city: 'y', state: 'z', country: 'GB' }, // no postalCode
      paymentMethod: 'cod',
    });

    const meta = JSON.parse(captured.slice(captured.indexOf('{')).trim());
    expect(meta.request.shippingAddress.fieldsPresent).toEqual(['line1', 'city', 'state', 'country']);
    expect(meta.request.shippingAddress.fieldsPresent).not.toContain('postalCode');
  });
});

describe('checkout failure logging — degenerate bodies', () => {
  it('does not throw on a missing or non-object body', async () => {
    for (const body of [undefined, null, 'a string', 42]) {
      await expect(failCheckout(body)).resolves.not.toThrow();
    }
  });

  it('reports a null address rather than inventing one', async () => {
    await failCheckout({ paymentMethod: 'cod' });

    const meta = JSON.parse(captured.slice(captured.indexOf('{')).trim());
    expect(meta.request.shippingAddress).toBeNull();
  });
});
