/**
 * Host → store resolution.
 *
 * The root domain was bound to one store by a build-time literal
 * (`VITE_STORE_ID`), so the platform's own address served a single hardcoded
 * tenant and the platform and a tenant were the same surface. Tenancy now comes
 * from the hostname, resolved here.
 *
 * This endpoint exists rather than reusing `resolveStore`'s host branches
 * because the frontend rewrites `/api/*` to the backend — the backend never
 * sees the shopper's Host, so those branches are dead in production. The SPA
 * passes its own hostname explicitly.
 *
 * The security-relevant cases are the reserved subdomains: `api` and `admin`
 * are real platform hosts, so a tenant must not be able to claim them by
 * registering a matching slug.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { resolveStoreByHost } from '../../src/modules/stores/store.service';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Store.deleteMany({});
});

async function makeStore(overrides: Record<string, unknown> = {}) {
  return Store.create({
    name: 'Acme',
    slug: 'acme',
    ownerId: new Types.ObjectId(),
    isActive: true,
    subscriptionPlan: 'pro',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    ...overrides,
  });
}

describe('resolveStoreByHost', () => {
  it('matches a custom domain exactly', async () => {
    await makeStore({ customDomain: 'shop.acme.com' });
    const store = await resolveStoreByHost('shop.acme.com');
    expect(store?.slug).toBe('acme');
  });

  it('matches a subdomain against the slug', async () => {
    await makeStore();
    const store = await resolveStoreByHost('acme.vendbase.com');
    expect(store?.slug).toBe('acme');
  });

  it('prefers a custom domain over a subdomain coincidence', async () => {
    // A merchant who pointed their own domain here expects it to win.
    await makeStore({ slug: 'other', customDomain: 'acme.vendbase.com' });
    await makeStore({ slug: 'acme' });

    const store = await resolveStoreByHost('acme.vendbase.com');
    expect(store?.slug).toBe('other');
  });

  it('returns null for the apex platform domain', async () => {
    await makeStore();
    // Two labels only — never read as a tenant, or the platform's own domain
    // would resolve to whichever store happened to match.
    expect(await resolveStoreByHost('vendbase.com')).toBeNull();
  });

  it('returns null for localhost', async () => {
    await makeStore();
    expect(await resolveStoreByHost('localhost')).toBeNull();
  });

  it.each(['www', 'api', 'admin', 'app', 'dashboard', 'staging', 'cdn'])(
    'refuses to resolve the reserved subdomain "%s"',
    async (label) => {
      // A tenant registering slug 'api' must not capture api.vendbase.com.
      await makeStore({ slug: label });
      expect(await resolveStoreByHost(`${label}.vendbase.com`)).toBeNull();
    }
  );

  it('ignores a port', async () => {
    await makeStore();
    expect((await resolveStoreByHost('acme.vendbase.com:5173'))?.slug).toBe('acme');
  });

  it('is case-insensitive', async () => {
    await makeStore({ customDomain: 'shop.acme.com' });
    expect((await resolveStoreByHost('SHOP.ACME.COM'))?.slug).toBe('acme');
  });

  it('does not resolve an inactive store', async () => {
    // A store the platform has switched off must go dark on its own domain too.
    await makeStore({ isActive: false, customDomain: 'shop.acme.com' });
    expect(await resolveStoreByHost('shop.acme.com')).toBeNull();
    expect(await resolveStoreByHost('acme.vendbase.com')).toBeNull();
  });

  it('returns null for an unknown host', async () => {
    await makeStore();
    expect(await resolveStoreByHost('someone-elses-domain.com')).toBeNull();
  });

  it('still resolves a store whose plan no longer includes custom domains', async () => {
    // Enforcing the capability on READ would take a live shop offline the
    // moment a subscription lapsed, punishing the merchant's customers for a
    // billing problem. The capability gates SETTING the domain, not serving it.
    await makeStore({ subscriptionPlan: 'free', customDomain: 'shop.acme.com' });
    expect((await resolveStoreByHost('shop.acme.com'))?.slug).toBe('acme');
  });
});

describe('GET /stores/resolve', () => {
  it('returns the store for a tenant host', async () => {
    await makeStore({ customDomain: 'shop.acme.com' });

    const res = await request(app)
      .get('/api/v1/stores/resolve')
      .query({ host: 'shop.acme.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.store.slug).toBe('acme');
    // The SPA needs these to render the storefront without a second round-trip.
    expect(res.body.data.store.theme).toBeDefined();
    expect(res.body.data.store.planCapabilities).toBeDefined();
  });

  it('answers 200 with a null store for a platform host', async () => {
    // Deliberately NOT 404: the platform host is the expected case on the root
    // domain, and a 404 would fire the client's global error toast on every
    // cold load of the marketing page.
    const res = await request(app)
      .get('/api/v1/stores/resolve')
      .query({ host: 'vendbase.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.store).toBeNull();
  });

  it('requires the host parameter', async () => {
    const res = await request(app).get('/api/v1/stores/resolve');
    expect(res.status).toBe(400);
  });

  it('is public — no authentication required', async () => {
    // A shopper hitting a storefront cold has no token; gating this would make
    // every tenant domain unreachable.
    await makeStore({ customDomain: 'shop.acme.com' });
    const res = await request(app)
      .get('/api/v1/stores/resolve')
      .query({ host: 'shop.acme.com' });

    expect(res.status).toBe(200);
  });

  it('is not shadowed by the /:id param route', async () => {
    // `/stores/:id` sits below this in the router; if ordering regressed,
    // 'resolve' would be parsed as a store ID and 400 on ObjectId validation.
    const res = await request(app)
      .get('/api/v1/stores/resolve')
      .query({ host: 'vendbase.com' });

    expect(res.body.code).not.toBe('BAD_REQUEST');
    expect(res.status).toBe(200);
  });
});
