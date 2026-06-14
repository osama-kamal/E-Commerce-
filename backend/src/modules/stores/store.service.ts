import { Types } from 'mongoose';
import { Store, IStore, SubscriptionPlan, SubscriptionStatus } from './store.model';
import { createError } from '../../middleware/errorHandler';

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

// ── Create a new store ────────────────────────────────────────────────────────

export async function createStore(input: CreateStoreInput): Promise<IStore> {
  const existing = await Store.findOne({ slug: input.slug.toLowerCase() });
  if (existing) throw createError('Store slug is already taken', 409, 'CONFLICT');

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

  // Build the update — name goes to root, everything else into settings.*
  const update: Record<string, unknown> = {};
  if (input.name) update.name = input.name.trim();

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

  // Fire-and-forget email to the platform admin
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? 'vendbase019@gmail.com';

  const { emailService } = await import('../../services/email.service');
  const subject = `[Plan Upgrade Request] ${storeName} → ${requestedPlan}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#4f46e5;">Plan Upgrade Request</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;color:#666;">Store</td><td style="padding:8px;font-weight:bold;">${storeName}</td></tr>
        <tr><td style="padding:8px;color:#666;">Store ID</td><td style="padding:8px;font-family:monospace;">${storeId}</td></tr>
        <tr><td style="padding:8px;color:#666;">Owner Email</td><td style="padding:8px;">${ownerEmail}</td></tr>
        <tr><td style="padding:8px;color:#666;">Requested Plan</td><td style="padding:8px;font-weight:bold;color:#4f46e5;">${requestedPlan.toUpperCase()}</td></tr>
      </table>
      <p style="margin-top:16px;color:#444;">
        To activate this plan, use the admin panel or run:<br/>
        <code style="background:#f4f4f4;padding:4px 8px;border-radius:4px;">
          PATCH /api/v1/admin/stores/${storeId}/plan
        </code>
      </p>
    </div>
  `;
  const text = `Plan Upgrade Request\nStore: ${storeName} (${storeId})\nOwner: ${ownerEmail}\nRequested: ${requestedPlan}`;

  await emailService.sendEmail({ to: adminEmail, subject, html, text });
}
