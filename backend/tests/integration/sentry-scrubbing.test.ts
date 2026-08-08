/**
 * Sentry must not become a second copy of the customer database.
 *
 * An error tracker is a firehose pointed at a third party. This API's requests
 * carry shipping addresses, email addresses and bearer tokens, so shipping the
 * request alongside the stack trace would undo the redaction done in the
 * checkout logger for exactly the same data — and put it somewhere with a
 * different retention policy and a different access list.
 *
 * `scrubEvent` is the last thing that runs before an event leaves the process.
 * These tests are the reason it is exported: the redaction is the
 * security-critical half of the integration and must be checkable without a
 * DSN, a network, or an initialised SDK.
 */

import type { ErrorEvent } from '@sentry/node';
import { scrubEvent, isSentryEnabled, initSentry, captureError } from '../../src/config/sentry';

/** Values that must never survive scrubbing. */
const ADDRESS = '221B Baker Street';
const EMAIL = 'shopper@example.com';
const BEARER = 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token';

function eventWithRequest(overrides: Record<string, unknown> = {}): ErrorEvent {
  return {
    type: undefined,
    request: {
      url: 'https://api.example.com/api/v1/orders?email=shopper@example.com&token=abc123',
      method: 'POST',
      query_string: 'email=shopper@example.com&token=abc123',
      data: {
        shippingAddress: { line1: ADDRESS, city: 'Marylebone', postalCode: 'NW1 6XE' },
        email: EMAIL,
      },
      headers: {
        'authorization': BEARER,
        'cookie': 'refreshToken=abcdef123456',
        'stripe-signature': 't=1,v1=deadbeef',
        'x-paymob-hmac': 'a'.repeat(128),
        'content-type': 'application/json',
        'x-store-id': '6a03b5108bdcd392044d1c37',
      },
      ...overrides,
    },
  } as unknown as ErrorEvent;
}

const serialise = (e: ErrorEvent) => JSON.stringify(e);

describe('scrubEvent — request data', () => {
  it('drops the request body wholesale', () => {
    const scrubbed = scrubEvent(eventWithRequest());

    expect(scrubbed.request?.data).toBeUndefined();
    expect(serialise(scrubbed)).not.toContain(ADDRESS);
    expect(serialise(scrubbed)).not.toContain('NW1 6XE');
  });

  it('drops the query string, from both the field and the URL', () => {
    const scrubbed = scrubEvent(eventWithRequest());

    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(scrubbed.request?.url).toBe('https://api.example.com/api/v1/orders');
    expect(serialise(scrubbed)).not.toContain(EMAIL);
    expect(serialise(scrubbed)).not.toContain('abc123');
  });

  it('strips a URL fragment as well as a query', () => {
    const scrubbed = scrubEvent(
      eventWithRequest({ url: 'https://api.example.com/reset#token=secret', query_string: undefined })
    );

    expect(scrubbed.request?.url).toBe('https://api.example.com/reset');
    expect(serialise(scrubbed)).not.toContain('secret');
  });

  it('removes credential-bearing headers but keeps diagnostic ones', () => {
    const scrubbed = scrubEvent(eventWithRequest());
    const headers = scrubbed.request?.headers ?? {};

    expect(headers['authorization']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
    expect(headers['stripe-signature']).toBeUndefined();
    expect(headers['x-paymob-hmac']).toBeUndefined();

    // Kept — these identify the tenant and the payload shape, and are not secret.
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-store-id']).toBe('6a03b5108bdcd392044d1c37');

    expect(serialise(scrubbed)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('matches header names case-insensitively', () => {
    const scrubbed = scrubEvent(
      eventWithRequest({ headers: { Authorization: BEARER, Cookie: 'x=1' } })
    );

    expect(serialise(scrubbed)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialise(scrubbed)).not.toContain('x=1');
  });

  it('keeps the method and path, which are the whole diagnostic value', () => {
    const scrubbed = scrubEvent(eventWithRequest());

    expect(scrubbed.request?.method).toBe('POST');
    expect(scrubbed.request?.url).toContain('/api/v1/orders');
  });
});

describe('scrubEvent — user identity', () => {
  it('keeps the pseudonymous id and discards everything else', () => {
    const event = {
      user: {
        id: '6a03b5108bdcd392044d1c35',
        email: EMAIL,
        username: 'sherlock',
        ip_address: '203.0.113.4',
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.user).toEqual({ id: '6a03b5108bdcd392044d1c35' });
    expect(serialise(scrubbed)).not.toContain(EMAIL);
    expect(serialise(scrubbed)).not.toContain('203.0.113.4');
    expect(serialise(scrubbed)).not.toContain('sherlock');
  });
});

describe('scrubEvent — breadcrumbs', () => {
  it('keeps the call shape and drops the payload', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'http',
          data: {
            url: 'https://api.stripe.com/v1/charges',
            method: 'POST',
            status_code: 500,
            body: { email: EMAIL, address: ADDRESS },
          },
        },
      ],
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.breadcrumbs?.[0].data).toEqual({
      url: 'https://api.stripe.com/v1/charges',
      method: 'POST',
      status_code: 500,
    });
    expect(serialise(scrubbed)).not.toContain(EMAIL);
    expect(serialise(scrubbed)).not.toContain(ADDRESS);
  });

  it('leaves a breadcrumb without data untouched', () => {
    const event = { breadcrumbs: [{ category: 'console', message: 'hello' }] } as unknown as ErrorEvent;
    expect(scrubEvent(event).breadcrumbs?.[0].message).toBe('hello');
  });
});

describe('scrubEvent — degenerate events', () => {
  it('handles an event with no request, user, or breadcrumbs', () => {
    const event = { message: 'boom' } as unknown as ErrorEvent;
    expect(() => scrubEvent(event)).not.toThrow();
    expect(scrubEvent(event).message).toBe('boom');
  });

  it('handles a request with no headers', () => {
    const event = { request: { url: 'https://x.test/a', method: 'GET' } } as unknown as ErrorEvent;
    expect(() => scrubEvent(event)).not.toThrow();
  });
});

describe('no DSN means no SDK', () => {
  it('stays disabled without SENTRY_DSN, so tests and CI are untouched', () => {
    // The suite runs without SENTRY_DSN set; init must decline rather than
    // reach for the network.
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('captureError is a silent no-op when disabled', () => {
    expect(() => captureError(new Error('boom'), { storeId: 'x' })).not.toThrow();
  });
});
