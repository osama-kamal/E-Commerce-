import { Types } from 'mongoose';
import { Store, IStore, SubscriptionPlan, SubscriptionStatus, StoreTheme, STORE_THEMES } from './store.model';
import { createError } from '../../middleware/errorHandler';
import { escapeHtml } from '../../utils/escapeHtml';
import { config } from '../../config/index';
import { getPlanLimits } from '../../config/planLimits';
import { trialEndFrom, resolveSubscriptionAccess } from './subscription-access';

export interface CreateStoreInput {
  name: string;
  slug: string;
  ownerId: string;
  subscriptionPlan?: SubscriptionPlan;
}

export interface UpdateStoreInput {
  name?: string;
  slug?: string;
  customDomain?: string;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionStatus?: SubscriptionStatus;
  isActive?: boolean;
}

// ── Plan capability helpers ───────────────────────────────────────────────────

/**
 * Capabilities a plan grants, for the client to gate UI against.
 *
 * PLAN_LIMITS declared six limits and only `maxProducts` was ever read, so every
 * paid differentiator was free. This exposes the boolean capabilities so the
 * storefront can hide platform branding on plans that paid to remove it, without
 * duplicating the plan table in the frontend (which would drift).
 */
export function getPlanCapabilities(plan: string) {
  const limits = getPlanLimits(plan);
  return {
    customDomain: limits.customDomain,
    removeBranding: limits.removeBranding,
    // NOTE: apiAccess is reported but NOT enforced anywhere — this codebase has
    // no API-key mechanism or separate API surface to gate. Enforcing it against
    // ordinary JWT traffic would break the app. It needs that feature first.
    apiAccess: limits.apiAccess,
    maxProducts: limits.maxProducts,
    maxOrdersPerMonth: limits.maxOrdersPerMonth,
    maxStores: limits.maxStores,
  };
}

/**
 * The subscription block returned to the client for the active store.
 *
 * Capabilities are derived from the EFFECTIVE plan, not the declared one, so a
 * store whose trial lapsed or whose payments failed stops advertising paid
 * features in its own UI. Previously the client received the raw
 * `subscriptionPlan` and independently recomputed trial state from `createdAt`,
 * so the browser and the server could — and did — disagree about who was
 * entitled to what.
 */
export function getStoreSubscriptionView(store: {
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
}) {
  const access = resolveSubscriptionAccess(store);
  return {
    level: access.level,
    reason: access.reason,
    effectivePlan: access.effectivePlan,
    isTrialing: access.isTrialing,
    trialEndsAt: access.trialEndsAt ? access.trialEndsAt.toISOString() : null,
    trialDaysRemaining: access.trialDaysRemaining,
    planCapabilities: getPlanCapabilities(access.effectivePlan),
  };
}

/**
 * Throws when the owner already holds as many stores as their plan allows.
 *
 * An owner's allowance is taken from the most permissive plan among the stores
 * they already own — upgrading any one store lifts the cap, which matches how
 * the pricing page presents it. A first store is always permitted.
 */
async function assertCanCreateStore(ownerId: string): Promise<void> {
  const owned = await Store.find({ ownerId: new Types.ObjectId(ownerId) })
    .select('subscriptionPlan')
    .lean();

  if (owned.length === 0) return; // first store is always allowed

  const allowance = owned.reduce((best, s) => {
    const max = getPlanLimits(s.subscriptionPlan).maxStores;
    if (max === -1 || best === -1) return -1; // unlimited wins
    return Math.max(best, max);
  }, 0);

  if (allowance === -1) return;

  if (owned.length >= allowance) {
    throw createError(
      `Your plan allows a maximum of ${allowance} store${allowance === 1 ? '' : 's'}. ` +
      `Upgrade to create more.`,
      403,
      'PLAN_LIMIT_EXCEEDED'
    );
  }
}

/** Throws when the store's plan does not include custom domains. */
function assertCanUseCustomDomain(plan: string): void {
  if (!getPlanLimits(plan).customDomain) {
    throw createError(
      'Custom domains are not available on your current plan. Upgrade to connect your own domain.',
      403,
      'PLAN_LIMIT_EXCEEDED'
    );
  }
}

// ── Custom-domain assignment guard ────────────────────────────────────────────

/** Bare hostname from a configured URL, or null if it cannot be parsed. */
function hostOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hostnames that must never resolve to a tenant.
 *
 * Derived from configuration rather than hardcoded so each deployment protects
 * its OWN domains — a hardcoded list would silently protect nothing on a fork.
 */
function platformHosts(): Set<string> {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '::1']);
  for (const host of [hostOf(config.FRONTEND_URL), hostOf(config.BACKEND_URL)]) {
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Refuses a custom domain that would capture platform traffic.
 *
 * `resolveStoreByHost` checks `customDomain` FIRST, ahead of the reserved-
 * subdomain logic — so the reservation of `api`, `admin` and friends protects
 * only the subdomain path and does nothing here. Without this guard, setting
 * `customDomain` to the platform's apex is enough to have every visitor to the
 * platform homepage served one tenant's storefront.
 *
 * Blocks the platform hosts themselves, any subdomain of them (which covers
 * `api.`/`admin.` without needing to enumerate labels), and the loopback names.
 *
 * This is a containment guard, NOT proof of ownership. It stops a tenant
 * capturing the PLATFORM; it cannot stop one claiming an unrelated third
 * party's hostname. That needs DNS verification — see DOMAINS.md — which is why
 * the field stays super-admin-only until then.
 */
export function assertAssignableCustomDomain(domain: string): string {
  const host = domain.trim().toLowerCase();

  for (const platform of platformHosts()) {
    if (host === platform || host.endsWith(`.${platform}`)) {
      throw createError(
        `"${host}" is a platform hostname and cannot be assigned to a store.`,
        400,
        'RESERVED_DOMAIN'
      );
    }
  }

  return host;
}

// ── Create a new store ────────────────────────────────────────────────────────

export async function createStore(input: CreateStoreInput): Promise<IStore> {
  const existing = await Store.findOne({ slug: input.slug.toLowerCase() });
  if (existing) throw createError('Store slug is already taken', 409, 'CONFLICT');

  await assertCanCreateStore(input.ownerId);

  const store = await Store.create({
    name: input.name,
    slug: input.slug.toLowerCase(),
    ownerId: new Types.ObjectId(input.ownerId),
    subscriptionPlan: input.subscriptionPlan ?? 'free',
    subscriptionStatus: 'trialing',
    // Server-owned trial deadline — see subscription-access.ts. Must be set on
    // BOTH creation paths (here and onboarding.service) or a store created via
    // "add another store" would read as un-migrated and never expire.
    trialEndsAt: trialEndFrom(new Date()),
  });

  return store.toObject() as unknown as IStore;
}

// ── Get store by slug ─────────────────────────────────────────────────────────

export async function getStoreBySlug(slug: string): Promise<IStore> {
  const store = await Store.findOne({ slug: slug.toLowerCase(), isActive: true }).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── Get store by custom domain ────────────────────────────────────────────────

export async function getStoreByDomain(domain: string): Promise<IStore | null> {
  const store = await Store.findOne({ customDomain: domain.toLowerCase(), isActive: true }).lean();
  return store as unknown as IStore | null;
}

// ── Resolve a store from a browser hostname ───────────────────────────────────

/**
 * Subdomain labels that belong to the PLATFORM, never to a tenant.
 *
 * A store whose slug collides with one of these is simply unreachable by
 * subdomain; it still resolves by custom domain and by /s/:slug. Reserving them
 * matters because `api` and `admin` are real platform hosts — letting a tenant
 * claim them by registering the matching slug would let them intercept traffic
 * intended for platform infrastructure.
 */
const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'dashboard', 'staging', 'preview', 'mail', 'cdn', 'assets',
]);

/**
 * Which store, if any, a hostname belongs to.
 *
 * ── Why this is an endpoint rather than middleware ────────────────────────────
 * `resolveStore` already inspects `req.headers.host` for exactly this, but in
 * the deployed topology it never sees the shopper's host: the frontend rewrites
 * `/api/*` to the backend, so `Host` is the backend's own. Those branches are
 * effectively dead in production. The SPA therefore has to pass the hostname it
 * is actually being served on, explicitly.
 *
 * Accepting a client-supplied host is not a privilege escalation. Storefronts
 * are public, callers can already choose a tenant with `X-Store-Slug`, and
 * every authenticated action is still cross-checked against the JWT's storeId
 * in `authenticateJWT`. This decides which PUBLIC catalogue to render, nothing
 * more.
 *
 * Returns `null` for a platform host, which is the normal case and not an error.
 */
export async function resolveStoreByHost(rawHost: string): Promise<IStore | null> {
  // Strip port and normalise. A browser hostname never carries a scheme, but a
  // caller might send one, so be forgiving about it.
  const host = rawHost
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];

  if (!host) return null;

  // 1. Custom domain — an exact match always wins. A merchant who has pointed
  //    their own domain here expects it to beat any subdomain coincidence.
  //
  //    Note this deliberately does NOT re-check the plan's customDomain
  //    capability. The capability gates SETTING a domain; enforcing it on read
  //    would take a live shop offline the moment a subscription lapsed, which
  //    punishes the merchant's customers for a billing problem.
  const byDomain = await Store.findOne({ customDomain: host, isActive: true }).lean();
  if (byDomain) return byDomain as unknown as IStore;

  // 2. Subdomain — `acme.vendbase.com` → slug `acme`. Requires at least three
  //    labels so a bare apex (`vendbase.com`) is never read as a tenant.
  const labels = host.split('.');
  if (labels.length >= 3) {
    const candidate = labels[0];
    if (!RESERVED_SUBDOMAINS.has(candidate)) {
      const bySlug = await Store.findOne({ slug: candidate, isActive: true }).lean();
      if (bySlug) return bySlug as unknown as IStore;
    }
  }

  // Platform host, or a host pointed here that matches no tenant.
  return null;
}

// ── Get store by ID ───────────────────────────────────────────────────────────

export async function getStoreById(storeId: string): Promise<IStore> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');
  const store = await Store.findById(storeId).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── List stores owned by a user ───────────────────────────────────────────────

export async function getStoresByOwner(ownerId: string): Promise<IStore[]> {
  const stores = await Store.find({ ownerId: new Types.ObjectId(ownerId) }).sort({ createdAt: -1 }).lean();
  return stores as unknown as IStore[];
}

// ── Update store ──────────────────────────────────────────────────────────────

export async function updateStore(storeId: string, ownerId: string, input: UpdateStoreInput): Promise<IStore> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');

  // ── Custom domains are not self-serve ──────────────────────────────────────
  // Refused here as well as in `updateMyStoreSchema`, so the rule survives a
  // future route being wired to this service with a different (or no) schema.
  // The owner path previously accepted any string with no ownership proof; see
  // the header of updateMyStoreSchema for what that allowed.
  if (input.customDomain !== undefined) {
    throw createError(
      'Custom domains are connected by the platform administrator. ' +
        'Contact support with the domain you want to use.',
      403,
      'FORBIDDEN'
    );
  }

  if (input.slug) {
    const conflict = await Store.findOne({ slug: input.slug.toLowerCase(), _id: { $ne: storeId } });
    if (conflict) throw createError('Store slug is already taken', 409, 'CONFLICT');
    input.slug = input.slug.toLowerCase();
  }

  const store = await Store.findOneAndUpdate(
    { _id: storeId, ownerId: new Types.ObjectId(ownerId) },
    input,
    { new: true, runValidators: true }
  ).lean();

  if (!store) throw createError('Store not found or access denied', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── Super-admin: update any store ─────────────────────────────────────────────

export async function adminUpdateStore(storeId: string, input: UpdateStoreInput): Promise<IStore> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');

  // ── Custom domain — the only path that may set one ─────────────────────────
  // Reached by super-admin alone (requireSuperAdmin on the route). Two checks
  // beyond the schema's format validation:
  //   • the platform's own hostnames are never assignable, even by an operator —
  //     a typo here would take the platform homepage offline
  //   • the paid-capability boundary still holds; the operator performs the
  //     assignment, they do not waive the plan it belongs to
  if (input.customDomain !== undefined) {
    const normalised = assertAssignableCustomDomain(input.customDomain);

    const current = await Store.findById(storeId).select('subscriptionPlan').lean();
    if (!current) throw createError('Store not found', 404, 'NOT_FOUND');
    assertCanUseCustomDomain(current.subscriptionPlan);

    // Reported as a conflict rather than surfacing the raw duplicate-key error
    // from the unique index, which reaches the client as a 500.
    const taken = await Store.findOne({ customDomain: normalised, _id: { $ne: storeId } })
      .select('_id')
      .lean();
    if (taken) {
      throw createError('That domain is already connected to another store', 409, 'CONFLICT');
    }

    input.customDomain = normalised;
  }

  if (input.slug) {
    const conflict = await Store.findOne({ slug: input.slug.toLowerCase(), _id: { $ne: storeId } });
    if (conflict) throw createError('Store slug is already taken', 409, 'CONFLICT');
    input.slug = input.slug.toLowerCase();
  }

  const store = await Store.findByIdAndUpdate(storeId, input, { new: true, runValidators: true }).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── Delete store ──────────────────────────────────────────────────────────────

export async function deleteStore(storeId: string, ownerId: string): Promise<void> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');

  const result = await Store.findOneAndDelete({
    _id: storeId,
    ownerId: new Types.ObjectId(ownerId),
  });

  if (!result) throw createError('Store not found or access denied', 404, 'NOT_FOUND');
}

// ── List all stores (super-admin) ─────────────────────────────────────────────

export async function listAllStores(page: number, limit: number): Promise<{ data: IStore[]; total: number; page: number; totalPages: number }> {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Store.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Store.countDocuments(),
  ]);
  return { data: data as unknown as IStore[], total, page, totalPages: Math.ceil(total / limit) };
}

// ── Update store settings (logo, contact, social) ────────────────────────────

export interface StoreSettingsInput {
  name?: string;
  theme?: StoreTheme;
  pricesIncludeTax?: boolean;
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
}

export async function updateStoreSettings(storeId: string, input: StoreSettingsInput): Promise<IStore> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');

  // Build the update — name and theme go to root, everything else into settings.*
  const update: Record<string, unknown> = {};
  if (input.name) update.name = input.name.trim();

  // Theme is a ROOT field, so it must be handled outside the settings.* loop
  // below — routing it through that loop would write `settings.theme`, which the
  // schema does not define and Mongoose would silently discard.
  //
  // This route has no `validate()` middleware, so the value is checked here
  // rather than trusted. Mongoose's enum would also reject it, but a 400 with a
  // clear message beats a ValidationError surfacing as a 500.
  if (input.theme !== undefined) {
    if (!STORE_THEMES.includes(input.theme)) {
      throw createError(
        `Invalid theme. Expected one of: ${STORE_THEMES.join(', ')}`,
        400,
        'BAD_REQUEST'
      );
    }
    update.theme = input.theme;
  }

  // Also a ROOT field, for the same reason as `theme` above — routing it
  // through the settings.* loop would write `settings.pricesIncludeTax`, which
  // the schema does not define and Mongoose would silently discard, leaving the
  // merchant's tax mode stuck on the default with no error.
  //
  // Changing this reinterprets the WHOLE catalogue: the same £100 product is
  // either £100 + tax or £100 including tax. Existing orders are unaffected —
  // they store their own resolved breakdown.
  if (input.pricesIncludeTax !== undefined) {
    if (typeof input.pricesIncludeTax !== 'boolean') {
      throw createError('pricesIncludeTax must be a boolean', 400, 'BAD_REQUEST');
    }
    update.pricesIncludeTax = input.pricesIncludeTax;
  }

  const settingsFields = ['logoUrl', 'contactEmail', 'contactPhone', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube'] as const;
  for (const field of settingsFields) {
    if (input[field] !== undefined) {
      update[`settings.${field}`] = input[field];
    }
  }

  const store = await Store.findByIdAndUpdate(storeId, { $set: update }, { new: true, runValidators: true }).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── Super-admin: update store plan & status ───────────────────────────────────

export async function updateStorePlan(
  storeId: string,
  plan: SubscriptionPlan,
  status: SubscriptionStatus
): Promise<IStore> {
  if (!Types.ObjectId.isValid(storeId)) throw createError('Invalid store ID', 400, 'BAD_REQUEST');

  const store = await Store.findByIdAndUpdate(
    storeId,
    {
      subscriptionPlan: plan,
      subscriptionStatus: status,
      // Clear the pending request once the plan is activated
      $unset: { requestedPlan: '' },
    },
    { new: true, runValidators: true }
  ).lean();

  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');
  return store as unknown as IStore;
}

// ── Owner: request plan upgrade (sends notification email to admin) ───────────

export async function requestPlanUpgrade(
  storeId: string,
  requestedPlan: SubscriptionPlan,
  ownerEmail: string,
  storeName: string
): Promise<void> {
  // Fetch the current store status to decide whether to change it.
  const store = await Store.findById(storeId).select('subscriptionStatus').lean();
  const currentStatus = store?.subscriptionStatus ?? 'trialing';

  // Only flip the status to pending_upgrade for stores that aren't already
  // on an active paid plan. Active stores keep their current status so they
  // don't lose feature access while the upgrade is being reviewed.
  const newStatus = currentStatus === 'active' ? currentStatus : 'pending_upgrade';

  await Store.findByIdAndUpdate(storeId, {
    subscriptionStatus: newStatus,
    requestedPlan,
  });

  // Notify the platform operator. No hardcoded fallback address — see
  // config.ADMIN_NOTIFY_EMAIL. The upgrade request is already persisted on the
  // store above (requestedPlan / subscriptionStatus), so a missing address
  // delays the notification rather than losing the request.
  const { config } = await import('../../config/index');
  const adminEmail = config.ADMIN_NOTIFY_EMAIL;

  if (!adminEmail) {
    const { logger } = await import('../../utils/logger');
    logger.warn('requestPlanUpgrade: ADMIN_NOTIFY_EMAIL not configured — notification not sent', {
      storeId, storeName, ownerEmail, requestedPlan,
    });
    return;
  }

  const { emailService } = await import('../../services/email.service');
  const { subject, html, text } = buildPlanUpgradeRequestEmail({
    storeId,
    storeName,
    ownerEmail,
    requestedPlan,
  });

  await emailService.sendEmail({ to: adminEmail, subject, html, text });
}

/**
 * Builds the plan-upgrade notification sent to the PLATFORM operator.
 *
 * Extracted from requestPlanUpgrade so the escaping is directly testable.
 *
 * `storeName` and `ownerEmail` are tenant-controlled and were previously
 * interpolated raw into the HTML, letting any store owner inject markup —
 * a working phishing link or a tracking pixel — into the platform owner's inbox.
 * `storeId` is an ObjectId and `requestedPlan` is validated against a fixed list
 * before reaching here, but both are escaped anyway rather than relying on that.
 */
export function buildPlanUpgradeRequestEmail(input: {
  storeId: string;
  storeName: string;
  ownerEmail: string;
  requestedPlan: string;
}): { subject: string; html: string; text: string } {
  const storeName = escapeHtml(input.storeName);
  const ownerEmail = escapeHtml(input.ownerEmail);
  const storeId = escapeHtml(input.storeId);
  const plan = escapeHtml(input.requestedPlan.toUpperCase());

  // Subject and text bodies are not HTML, so they use the raw values.
  const subject = `[Plan Upgrade Request] ${input.storeName} → ${input.requestedPlan}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#4f46e5;">Plan Upgrade Request</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;color:#666;">Store</td><td style="padding:8px;font-weight:bold;">${storeName}</td></tr>
        <tr><td style="padding:8px;color:#666;">Store ID</td><td style="padding:8px;font-family:monospace;">${storeId}</td></tr>
        <tr><td style="padding:8px;color:#666;">Owner Email</td><td style="padding:8px;">${ownerEmail}</td></tr>
        <tr><td style="padding:8px;color:#666;">Requested Plan</td><td style="padding:8px;font-weight:bold;color:#4f46e5;">${plan}</td></tr>
      </table>
      <p style="margin-top:16px;color:#444;">
        To activate this plan, use the admin panel or run:<br/>
        <code style="background:#f4f4f4;padding:4px 8px;border-radius:4px;">
          PATCH /api/v1/admin/stores/${storeId}/plan
        </code>
      </p>
    </div>
  `;

  const text = `Plan Upgrade Request\nStore: ${input.storeName} (${input.storeId})\nOwner: ${input.ownerEmail}\nRequested: ${input.requestedPlan}`;

  return { subject, html, text };
}
