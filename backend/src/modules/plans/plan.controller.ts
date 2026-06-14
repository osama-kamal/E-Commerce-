import { Request, Response, NextFunction } from 'express';
import { PlanConfig } from './plan.model';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

const VALID_PLAN_IDS = ['free', 'starter', 'pro', 'enterprise'] as const;

// ── Seed defaults (used if collection is empty) ───────────────────────────────

const DEFAULT_CONFIGS = [
  {
    planId: 'free',
    displayName: 'Free',
    price: '$0',
    period: 'forever',
    features: ['15 products', '50 orders/month', 'Basic analytics', 'Email support', '1 store'],
    badge: null,
    ctaLabel: 'Current plan',
    isContactSales: false,
    isHighlighted: false,
    sortOrder: 0,
  },
  {
    planId: 'starter',
    displayName: 'Starter',
    price: '$29',
    period: '/month',
    features: ['500 products', '500 orders/month', 'Advanced analytics', 'Priority email support', '3 stores', 'Custom domain'],
    badge: null,
    ctaLabel: 'Upgrade to Starter',
    isContactSales: false,
    isHighlighted: false,
    sortOrder: 1,
  },
  {
    planId: 'pro',
    displayName: 'Pro',
    price: '$79',
    period: '/month',
    features: ['Unlimited products', 'Unlimited orders', 'Full analytics suite', 'Live chat support', '10 stores', 'Custom domain', 'API access', 'Remove branding'],
    badge: '⭐ Most Popular',
    ctaLabel: 'Upgrade to Pro',
    isContactSales: false,
    isHighlighted: true,
    sortOrder: 2,
  },
  {
    planId: 'enterprise',
    displayName: 'Enterprise',
    price: 'Custom',
    period: '',
    features: ['Everything in Pro', 'Unlimited stores', 'Dedicated support', 'SLA guarantee', 'Custom integrations', 'White-label option'],
    badge: '🏢 Enterprise',
    ctaLabel: 'Upgrade to Premium',
    isContactSales: false,
    isHighlighted: false,
    sortOrder: 3,
  },
] as const;

async function ensureDefaults(): Promise<void> {
  const count = await PlanConfig.countDocuments();
  if (count === 0) {
    await PlanConfig.insertMany(DEFAULT_CONFIGS);
    logger.info('PlanConfig: seeded default plan display configs');
  }
}

// ── GET /api/v1/plans  — public ───────────────────────────────────────────────

export async function listPlanConfigs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await ensureDefaults();
    const plans = await PlanConfig.find().sort({ sortOrder: 1 }).lean();
    sendSuccess(res, plans);
  } catch (err) {
    next(err);
  }
}

// ── PUT /api/v1/plans/:planId  — super-admin only ─────────────────────────────

export async function updatePlanConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { planId } = req.params;

    if (!VALID_PLAN_IDS.includes(planId as any)) {
      return next(createError(`planId must be one of: ${VALID_PLAN_IDS.join(', ')}`, 400, 'BAD_REQUEST'));
    }

    const {
      displayName,
      price,
      period,
      features,
      badge,
      ctaLabel,
      isContactSales,
      isHighlighted,
      sortOrder,
    } = req.body as Partial<{
      displayName: string;
      price: string;
      period: string;
      features: string[];
      badge: string | null;
      ctaLabel: string;
      isContactSales: boolean;
      isHighlighted: boolean;
      sortOrder: number;
    }>;

    // Build update object — only apply fields that were actually sent
    const update: Record<string, unknown> = {};
    if (displayName !== undefined) update.displayName = String(displayName).slice(0, 60);
    if (price !== undefined) update.price = String(price).slice(0, 20);
    if (period !== undefined) update.period = String(period).slice(0, 20);
    if (features !== undefined) {
      if (!Array.isArray(features)) return next(createError('features must be an array of strings', 400, 'BAD_REQUEST'));
      update.features = features.map(f => String(f).slice(0, 200));
    }
    if (badge !== undefined) update.badge = badge === null ? null : String(badge).slice(0, 60);
    if (ctaLabel !== undefined) update.ctaLabel = String(ctaLabel).slice(0, 60);
    if (isContactSales !== undefined) update.isContactSales = Boolean(isContactSales);
    if (isHighlighted !== undefined) update.isHighlighted = Boolean(isHighlighted);
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);

    if (Object.keys(update).length === 0) {
      return next(createError('No updatable fields provided', 400, 'BAD_REQUEST'));
    }

    await ensureDefaults();

    const plan = await PlanConfig.findOneAndUpdate(
      { planId },
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    logger.info('PlanConfig updated', { planId, update });
    sendSuccess(res, plan);
  } catch (err) {
    next(err);
  }
}
