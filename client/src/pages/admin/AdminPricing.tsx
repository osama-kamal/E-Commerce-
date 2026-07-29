import { useState, useEffect } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { storesApi } from '../../api/stores';
import { CardGridSkeleton } from '../../components/Skeleton';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { AnimatePresence } from 'framer-motion';
import api from '../../api/axios';

// ── Plan display type (mirrors PlanConfig on the backend) ────────────────────

export interface PlanDisplay {
  planId: string;
  displayName: string;
  price: string;
  period: string;
  features: string[];
  badge: string | null;
  ctaLabel: string;
  isContactSales: boolean;
  isHighlighted: boolean;
  sortOrder: number;
}

// ── Hardcoded fallback (used if API is unreachable) ───────────────────────────

const FALLBACK_PLANS: PlanDisplay[] = [
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
];

// Plan order used for upgrade/downgrade detection
const PLAN_ORDER = ['free', 'starter', 'pro', 'enterprise'];

// ── Border colors per plan ────────────────────────────────────────────────────

const PLAN_BORDER: Record<string, string> = {
  free: 'border-gray-200 dark:border-gray-700',
  starter: 'border-blue-400 dark:border-blue-500',
  pro: 'border-indigo-500 dark:border-indigo-400',
  enterprise: 'border-violet-500 dark:border-violet-400',
};

// ── Upgrade Request Modal ─────────────────────────────────────────────────────

function UpgradeModal({
  plan, onClose, onRequest, requesting,
}: {
  plan: PlanDisplay;
  onClose: () => void;
  onRequest: () => void;
  requesting: boolean;
}) {
  return (
    <Modal
      onClose={onClose}
      labelledBy="upgrade-modal-title"
      describedBy="upgrade-modal-desc"
      panelClassName="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
    >
      <>
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>

        <div className="text-center mb-6">
          <div className="text-4xl mb-3" aria-hidden="true">🚀</div>
          <h2 id="upgrade-modal-title" className="text-xl font-bold text-gray-900 dark:text-white">Upgrade to {plan.displayName}</h2>
          <p id="upgrade-modal-desc" className="text-gray-500 dark:text-gray-400 text-sm mt-2">Online payment is coming soon. For now, contact us to activate your plan manually.</p>
        </div>

        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 mb-5 text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <p className="font-semibold">💳 Payment options:</p>
          <p>• Bank transfer</p>
          <p>• Vodafone Cash / InstaPay</p>
          <p>• Contact us at <span className="font-mono">vendbase019@gmail.com</span></p>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 text-center">
          Click <strong>"Request Activation"</strong> and we'll reach out within 24 hours to confirm your payment and activate the plan.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={onRequest} disabled={requesting} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
            {requesting ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Sending…</> : '📩 Request Activation'}
          </button>
        </div>
      </>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPricing() {
  const currentStore = useAppSelector(s => s.currentStore.current);
  const [plans, setPlans] = useState<PlanDisplay[]>(FALLBACK_PLANS);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<PlanDisplay | null>(null);
  const [requesting, setRequesting] = useState(false);

  const currentPlanId = currentStore?.subscriptionPlan ?? 'free';

  // Fetch dynamic plan configs from the API
  useEffect(() => {
    api.get('/plans')
      .then(res => {
        const data: PlanDisplay[] = res.data?.data ?? [];
        if (data.length > 0) setPlans(data);
      })
      .catch(() => {
        // Silent fallback — FALLBACK_PLANS already set as default state
      })
      .finally(() => setPlansLoading(false));
  }, []);

  const handleUpgradeClick = (plan: PlanDisplay) => {
    setSelectedPlan(plan);
  };

  const handleRequest = async () => {
    if (!selectedPlan || !currentStore) return;
    setRequesting(true);
    try {
      const res = await storesApi.requestUpgrade(currentStore._id, selectedPlan.planId);
      toast.success(res.data.data.message || "Request sent! We'll contact you within 24 hours.");
      setSelectedPlan(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to send request';
      toast.error(`${msg}. Please email vendbase019@gmail.com directly.`);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Choose Your Plan</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Scale your store as you grow. Upgrade or downgrade anytime.</p>
      </div>

      {/* Plan cards */}
      {plansLoading ? (
        <CardGridSkeleton
          count={4}
          lines={5}
          padding="p-6"
          headline
          footer
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10"
          label="Loading plans…"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {plans.map(plan => {
            const isCurrent = plan.planId === currentPlanId;
            const currentIdx = PLAN_ORDER.indexOf(currentPlanId);
            const planIdx = PLAN_ORDER.indexOf(plan.planId);
            const isDowngrade = planIdx < currentIdx;
            const borderClass = PLAN_BORDER[plan.planId] ?? 'border-gray-200 dark:border-gray-700';

            return (
              <div
                key={plan.planId}
                className={`relative card p-6 flex flex-col border-2 transition-all ${borderClass} ${
                  isCurrent ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-gray-950' : ''
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    ✓ Current Plan
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.displayName}</h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-gray-900 dark:text-white">{plan.price}</span>
                    {plan.period && <span className="text-gray-400 text-sm">{plan.period}</span>}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !isCurrent && !isDowngrade && handleUpgradeClick(plan)}
                  disabled={isCurrent || isDowngrade}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    isCurrent
                      ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 cursor-default'
                      : isDowngrade
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                      : plan.isHighlighted
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5'
                      : 'bg-gray-900 dark:bg-white hover:bg-gray-700 dark:hover:bg-gray-100 text-white dark:text-gray-900 hover:-translate-y-0.5'
                  }`}
                >
                  {isCurrent ? '✓ Active' : isDowngrade ? 'Downgrade' : plan.ctaLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* FAQ */}
      <div className="mt-10 card p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Frequently Asked Questions</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {[
            { q: 'How do I pay?', a: 'We accept bank transfer, Vodafone Cash, and InstaPay. Contact us after requesting activation.' },
            { q: 'Can I downgrade?', a: "Yes, contact support and we'll adjust your plan at the end of your billing cycle." },
            { q: 'Is there a free trial?', a: 'All new stores start on a free trial. No credit card required.' },
            { q: 'What happens if I exceed limits?', a: "We'll notify you and give you time to upgrade before any restrictions apply." },
          ].map(item => (
            <div key={item.q} className="space-y-1">
              <p className="font-medium text-gray-800 dark:text-gray-200">{item.q}</p>
              <p className="text-gray-500 dark:text-gray-400">{item.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade modal */}
      <AnimatePresence>
        {selectedPlan && (
          <UpgradeModal
            plan={selectedPlan}
            onClose={() => setSelectedPlan(null)}
            onRequest={handleRequest}
            requesting={requesting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
