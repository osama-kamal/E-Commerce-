/**
 * Tests for liveness vs readiness.
 *
 * There was a single /health endpoint that returned 200 unconditionally — it
 * reported healthy with a completely dead database, so any uptime monitor
 * pointed at it would stay green through a total outage.
 *
 * Split into:
 *   /health        liveness  — "the process is up", always 200. Must stay
 *                             unconditional: server.ts binds the port before
 *                             connecting to Mongo and render.yaml probes here,
 *                             so failing during a slow connect would have the
 *                             platform kill the container mid-boot.
 *   /health/ready  readiness — "this instance can serve traffic", 503 when
 *                             MongoDB is unreachable.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

// Controllable Redis availability so the optional-dependency behaviour is
// asserted directly rather than inferred from whatever the environment happens
// to be doing.
const isRedisAvailableMock = jest.fn(() => true);
jest.mock('../../src/config/redis', () => ({
  isRedisAvailable: () => isRedisAvailableMock(),
  getRedisClient: () => { throw new Error('not used'); },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongod.stop();
});

describe('liveness /health', () => {
  it('returns 200 with a connected database', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('still returns 200 when the database is down', async () => {
    await mongoose.disconnect();
    try {
      const res = await request(app).get('/api/v1/health');
      // Liveness must not depend on Mongo — see the header comment.
      expect(res.status).toBe(200);
    } finally {
      await mongoose.connect(mongod.getUri());
    }
  });
});

describe('readiness /health/ready', () => {
  it('reports ready with a connected database', async () => {
    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.mongodb.ready).toBe(true);
    expect(res.body.checks.mongodb.state).toBe('connected');
  });

  it('returns 503 when the database is disconnected', async () => {
    await mongoose.disconnect();
    try {
      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.mongodb.ready).toBe(false);
      expect(res.body.checks.mongodb.state).toBe('disconnected');
    } finally {
      await mongoose.connect(mongod.getUri());
    }
  });

  it('marks mongodb as required and redis as optional', async () => {
    const res = await request(app).get('/api/v1/health/ready');

    expect(res.body.checks.mongodb.required).toBe(true);
    expect(res.body.checks.redis.required).toBe(false);
  });

  it('stays ready when redis is down — it is an optional dependency', async () => {
    isRedisAvailableMock.mockReturnValueOnce(false);

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.redis.ready).toBe(false);
  });

  it('stays ready when the redis check itself throws', async () => {
    isRedisAvailableMock.mockImplementationOnce(() => {
      throw new Error('redis client exploded');
    });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.checks.redis.ready).toBe(false);
  });

  it('reports redis as ready when it is up', async () => {
    isRedisAvailableMock.mockReturnValueOnce(true);

    const res = await request(app).get('/api/v1/health/ready');
    expect(res.body.checks.redis.ready).toBe(true);
  });

  it('does not shadow the liveness route', async () => {
    const live = await request(app).get('/api/v1/health');
    expect(live.body).not.toHaveProperty('checks');
  });
});
