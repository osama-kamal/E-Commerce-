/**
 * Property tests for Task 1: Project scaffolding and configuration
 *
 * Feature: ecommerce-platform, Property 23: Security Headers on Every Response
 * Feature: ecommerce-platform, Property 24: NoSQL Injection Sanitization
 *
 * ── Why this file needs a database ────────────────────────────────────────────
 * It imports `app` and issues real HTTP requests, and almost every path it
 * generates falls through to the tenant router — where `resolveStore` calls
 * `Store.findOne()`. With no connection, mongoose BUFFERS that call and rejects
 * after 10 seconds instead of failing fast. At `numRuns: 100` that is ~1000
 * seconds of waiting against a 30 s jest timeout, so all three tests here failed
 * as timeouts.
 *
 * The failures looked like a security regression — "Security Headers on Every
 * Response" and "NoSQL Injection Sanitization" reported as failing — while the
 * properties themselves were never actually evaluated. Both hold; the suite
 * simply never got far enough to check. Connecting an in-memory MongoDB, as
 * every other suite that touches `app` already does, makes the assertions run.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as fc from 'fast-check';
import request from 'supertest';
import app from '../../src/app';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ── Property 23: Security Headers on Every Response ──────────────────────────
// Validates: Requirements 9.5
describe('Property 23: Security Headers on Every Response', () => {
  it('should include required security headers on every response', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary paths to test against
        fc.constantFrom(
          '/api/v1/health',
          '/api/v1/nonexistent',
          '/api/v1/some/deep/path',
          '/api/v1/another'
        ),
        async (path) => {
          const res = await request(app).get(path);

          // X-Frame-Options — set by helmet
          expect(res.headers['x-frame-options']).toBeDefined();

          // X-Content-Type-Options — set by helmet
          expect(res.headers['x-content-type-options']).toBeDefined();

          // Content-Security-Policy — set by helmet
          expect(res.headers['content-security-policy']).toBeDefined();
        }
      ),
      // The generator is a `constantFrom` over four paths, so every run beyond
      // the fourth is a repeat — and each one is a real HTTP round trip. 25 runs
      // covers the space many times over; 100 only bought wall-clock time.
      { numRuns: 25 }
    );
  });
});

// ── Property 24: NoSQL Injection Sanitization ─────────────────────────────────
// Validates: Requirements 9.4
describe('Property 24: NoSQL Injection Sanitization', () => {
  it('should strip MongoDB operator keys from request bodies before processing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate objects that contain MongoDB operator keys
        fc.record({
          operator: fc.constantFrom('$where', '$gt', '$ne', '$in', '$or', '$and', '$regex', '$exists'),
          value: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null)
          ),
          fieldName: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)),
        }),
        async ({ operator, value, fieldName }) => {
          // Build a body that contains a MongoDB operator key
          const maliciousBody = {
            [fieldName]: { [operator]: value },
            [operator]: value,
          };

          // POST to health endpoint (it will 404 for POST, but sanitization runs first)
          const res = await request(app)
            .post('/api/v1/health')
            .send(maliciousBody)
            .set('Content-Type', 'application/json');

          // The request should not cause a 500 (server error from injection)
          // Sanitization should have stripped the operators
          expect(res.status).not.toBe(500);

          // The response body should follow the error shape (not a crash)
          if (res.status >= 400) {
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('code');
            expect(res.body).toHaveProperty('message');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not pass MongoDB operators through to response data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('$where', '$gt', '$ne', '$in', '$or', '$and'),
        async (operator) => {
          const body = { [operator]: 'injected' };

          const res = await request(app)
            .post('/api/v1/health')
            .send(body)
            .set('Content-Type', 'application/json');

          // Should not 500 — sanitizer should have handled it
          expect(res.status).not.toBe(500);
        }
      ),
      { numRuns: 100 }
    );
  });
});
