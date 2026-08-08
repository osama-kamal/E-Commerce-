/**
 * Only server faults reach Sentry.
 *
 * Every 400/401/403/404/409/422 that passes through `errorHandler` is the API
 * working correctly — a wrong password, a validation failure, a missing record.
 * A public storefront generates those constantly. Reporting them would bury the
 * one event that means something under thousands that do not, and Sentry bills
 * per event, so the noise is also the invoice.
 *
 * The gate is `statusCode >= 500`. These tests pin it, and pin that the context
 * attached to a real report is tenant-identifying but not personal.
 */

import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';

const captureError = jest.fn();
jest.mock('../../src/config/sentry', () => ({
  captureError: (...args: unknown[]) => captureError(...args),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { errorHandler, createError, AppError } from '../../src/middleware/errorHandler';

const USER_ID = new Types.ObjectId();
const STORE_ID = new Types.ObjectId();

function run(err: AppError): void {
  const req = {
    method: 'POST',
    url: '/api/v1/orders?token=secret',
    route: { path: '/orders' },
    user: { userId: USER_ID, role: 'customer', storeId: STORE_ID },
    store: { _id: STORE_ID },
  } as unknown as Request;

  const res = {
    status: () => res,
    json: () => res,
  } as unknown as Response;

  errorHandler(err, req, res, (() => undefined) as NextFunction);
}

beforeEach(() => captureError.mockClear());

describe('client errors are NOT reported', () => {
  it.each([
    ['400 BAD_REQUEST', 400],
    ['401 UNAUTHORIZED', 401],
    ['402 SUBSCRIPTION_REQUIRED', 402],
    ['403 FORBIDDEN', 403],
    ['404 NOT_FOUND', 404],
    ['409 CONFLICT', 409],
    ['422 VALIDATION_ERROR', 422],
  ])('%s', (_label, status) => {
    run(createError('nope', status, 'SOME_CODE'));
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a Mongoose ValidationError, which maps to 422', () => {
    const err = new Error('Path `x` is required.') as AppError;
    err.name = 'ValidationError';
    run(err);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a duplicate-key MongoServerError, which maps to 409', () => {
    const err = new Error('E11000 duplicate key') as AppError;
    err.name = 'MongoServerError';
    (err as unknown as { code: number }).code = 11000;
    run(err);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('server faults ARE reported', () => {
  it('an explicit 500', () => {
    run(createError('kaboom', 500, 'INTERNAL_ERROR'));
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('an unclassified throw, which defaults to 500', () => {
    run(new Error('undefined is not a function') as AppError);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('a non-duplicate database error, which maps to 500', () => {
    const err = new Error('connection reset') as AppError;
    err.name = 'MongoServerError';
    run(err);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toMatchObject({ errorCode: 'DATABASE_ERROR' });
  });

  it('a 502 from a failed refund at the gateway', () => {
    run(createError('Refund failed: declined', 502, 'REFUND_FAILED'));
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});

describe('the context attached to a report', () => {
  it('carries tenant and route, and no query string', () => {
    run(createError('kaboom', 500, 'INTERNAL_ERROR'));

    const [, context] = captureError.mock.calls[0];
    expect(context).toEqual({
      userId: USER_ID.toString(),
      storeId: STORE_ID.toString(),
      method: 'POST',
      route: '/orders',        // the route TEMPLATE, not req.url
      statusCode: 500,
      errorCode: 'INTERNAL_ERROR',
    });

    // req.url carried `?token=secret`; the report must not.
    expect(JSON.stringify(context)).not.toContain('secret');
    expect(JSON.stringify(context)).not.toContain('?');
  });

  it('reports an unauthenticated 500 without inventing identifiers', () => {
    const req = { method: 'GET', url: '/api/v1/health' } as unknown as Request;
    const res = { status: () => res, json: () => res } as unknown as Response;

    errorHandler(
      createError('kaboom', 500, 'INTERNAL_ERROR'),
      req, res, (() => undefined) as NextFunction
    );

    expect(captureError).toHaveBeenCalledTimes(1);
    const [, context] = captureError.mock.calls[0];
    expect(context.userId).toBeUndefined();
    expect(context.storeId).toBeUndefined();
    expect(context.route).toBeUndefined();  // no route matched
  });
});
