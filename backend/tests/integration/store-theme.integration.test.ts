/**
 * Storefront theme selection — PATCH /stores/:id/settings and the public read.
 *
 * The theme is presentation-only, so the contract these tests pin is narrow but
 * important:
 *
 *   · every existing store reads back as 'default' with no migration, because
 *     documents written before the field existed have no `theme` key and
 *     Mongoose supplies the schema default on read;
 *   · only the six known themes are accepted;
 *   · the value round-trips through the settings endpoint, which had no
 *     `validate()` middleware and an allowlist that would otherwise have
 *     silently dropped an unknown root field;
 *   · ownership is still enforced;
 *   · changing a theme touches nothing else on the document.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store, STORE_THEMES, resolveTheme } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { signAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let ownerId: Types.ObjectId;
let ownerToken: string;
let strangerToken: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Store.deleteMany({}), User.deleteMany({})]);

  ownerId = new Types.ObjectId();
  store = await Store.create({
    name: 'Theme Store', slug: 'theme-store', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: store._id, email: 'owner@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  ownerToken = signAccessToken(ownerId, 'admin', store._id!.toString());

  // A genuine outsider: an admin of a DIFFERENT store.
  //
  // This was originally created with `storeId: store._id`, which made it an
  // admin OF THIS STORE — a legitimate caller, not a stranger. It only appeared
  // to prove access control because the endpoint used to demand `ownerId`
  // equality. Full matrix lives in store-settings-authz.integration.test.ts.
  const otherStore = await Store.create({
    name: 'Other', slug: 'other-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'active',
  });
  const strangerId = new Types.ObjectId();
  await User.create({
    _id: strangerId, storeId: otherStore._id, email: 'stranger@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  strangerToken = signAccessToken(strangerId, 'admin', otherStore._id!.toString());
});

const patchSettings = (body: Record<string, unknown>, token = ownerToken) =>
  request(app)
    .patch(`/api/v1/stores/${store._id!.toString()}/settings`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── Default ──────────────────────────────────────────────────────────────────

describe('default theme', () => {
  it('is "default" for a newly created store', async () => {
    const fresh = await Store.findById(store._id).lean();
    expect(fresh!.theme).toBe('default');
  });

  /**
   * Mongoose applies a schema default on CREATE, never on read, and `.lean()`
   * returns raw BSON. A pre-existing store therefore reads back as `undefined`,
   * NOT `'default'` — the assumption this suite was written to check, and which
   * turned out to be wrong. Two mechanisms cover it; both are pinned below.
   */
  it('a pre-existing document genuinely has no theme on disk', async () => {
    await Store.collection.updateOne({ _id: store._id }, { $unset: { theme: '' } });

    const raw = await Store.collection.findOne({ _id: store._id });
    expect(raw!.theme).toBeUndefined();

    const lean = await Store.findById(store._id).lean();
    expect(lean!.theme).toBeUndefined();   // the default is NOT applied on read
  });

  it('resolveTheme normalises a missing or unknown value to "default"', () => {
    expect(resolveTheme(undefined)).toBe('default');
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme('')).toBe('default');
    expect(resolveTheme('neon-cyberpunk')).toBe('default');
    expect(resolveTheme(42)).toBe('default');
    // …and passes a real theme straight through.
    expect(resolveTheme('luxury')).toBe('luxury');
  });

  it('serves "default" to the storefront for an unmigrated store', async () => {
    await Store.collection.updateOne({ _id: store._id }, { $unset: { theme: '' } });

    const res = await request(app)
      .get('/api/v1/stores/current')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('default');
  });

  it('the backfill sets the field without overwriting a real choice', async () => {
    // One store missing the field, one that has already chosen a theme.
    await Store.collection.updateOne({ _id: store._id }, { $unset: { theme: '' } });
    const chosen = await Store.create({
      name: 'Chosen', slug: 'chosen-store', ownerId: new Types.ObjectId(),
      isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'active',
      theme: 'luxury',
    });

    // Same operation the migration script performs.
    await Store.collection.updateMany(
      { theme: { $exists: false } },
      { $set: { theme: 'default' } }
    );

    const backfilled = await Store.collection.findOne({ _id: store._id });
    const untouched = await Store.collection.findOne({ _id: chosen._id });

    expect(backfilled!.theme).toBe('default');
    expect(untouched!.theme).toBe('luxury');
  });
});

// ── Switching ────────────────────────────────────────────────────────────────

describe('switching themes', () => {
  it.each(STORE_THEMES)('accepts and persists "%s"', async (theme) => {
    const res = await patchSettings({ theme });
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe(theme);

    const persisted = await Store.findById(store._id).lean();
    expect(persisted!.theme).toBe(theme);
  });

  it('rejects an unknown theme with 400', async () => {
    const res = await patchSettings({ theme: 'neon-cyberpunk' });
    expect(res.status).toBe(400);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.theme).toBe('default');
  });

  it('rejects a non-string theme', async () => {
    const res = await patchSettings({ theme: 42 });
    expect(res.status).toBe(400);
  });

  it('leaves the theme untouched when the field is absent from the payload', async () => {
    await patchSettings({ theme: 'luxury' });
    const res = await patchSettings({ contactEmail: 'hi@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('luxury');
  });
});

// ── Isolation: presentation must not leak into anything else ─────────────────

describe('theme changes are presentation-only', () => {
  it('does not alter plan, status, currency, slug or settings', async () => {
    await Store.updateOne({ _id: store._id }, { 'settings.contactEmail': 'keep@example.com' });
    const before = await Store.findById(store._id).lean();

    await patchSettings({ theme: 'marketplace' });
    const after = await Store.findById(store._id).lean();

    expect(after!.theme).toBe('marketplace');
    expect(after!.subscriptionPlan).toBe(before!.subscriptionPlan);
    expect(after!.subscriptionStatus).toBe(before!.subscriptionStatus);
    expect(after!.currency).toBe(before!.currency);
    expect(after!.slug).toBe(before!.slug);
    expect(after!.isActive).toBe(before!.isActive);
    expect(after!.settings.contactEmail).toBe('keep@example.com');
  });

  it('writes theme to the document root, not into settings', async () => {
    await patchSettings({ theme: 'minimal' });
    const raw = await Store.collection.findOne({ _id: store._id });

    expect(raw!.theme).toBe('minimal');
    expect((raw!.settings as Record<string, unknown>).theme).toBeUndefined();
  });
});

// ── Authorisation ────────────────────────────────────────────────────────────

describe('authorisation', () => {
  it('rejects an admin belonging to a different store', async () => {
    const res = await patchSettings({ theme: 'luxury' }, strangerToken);
    expect(res.status).toBe(403);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.theme).toBe('default');
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app)
      .patch(`/api/v1/stores/${store._id!.toString()}/settings`)
      .send({ theme: 'luxury' });
    expect(res.status).toBe(401);
  });
});

// ── Public read: the storefront needs the theme without authentication ───────

describe('public exposure', () => {
  it('returns the theme from GET /stores/current', async () => {
    await patchSettings({ theme: 'fashion' });

    const res = await request(app)
      .get('/api/v1/stores/current')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('fashion');
  });
});
