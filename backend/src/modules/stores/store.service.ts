import { Types } from 'mongoose';
import { Store, IStore, SubscriptionPlan, SubscriptionStatus, StoreTheme, STORE_THEMES } from './store.model';
import { createError } from '../../middleware/errorHandler';
import { escapeHtml } from '../../utils/escapeHtml';
import { getPlanLimits } from '../../config/planLimits';

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

  // Custom domains are a paid capability. The owner-facing update path used to
  // accept one on any plan, including free.
  if (input.customDomain) {
    const current = await Store.findById(storeId).select('subscriptionPlan').lean();
    if (!current) throw createError('Store not found or access denied', 404, 'NOT_FOUND');
    assertCanUseCustomDomain(current.subscriptionPlan);
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
