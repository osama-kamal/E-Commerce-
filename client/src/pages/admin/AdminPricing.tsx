import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { fetchCurrentStore, setCurrentStore } from '../../store/storeSlice';
import { storesApi } from '../../api/stores';
import { Store } from '../../types';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

// ── Plan definitions ──────────────────────────────────────────────────────────

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    color: 'border-gray-200 dark:border-gray-700',
    badge: null,
    features: [
      '100 products',
      '50 orders/month',
      'Basic analytics',
      'Email support',
      '1 store',
    ],
    cta: 'Current plan',
    ctaDisabled: true,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$29',
    period: '/month',
    color: 'border-blue-400 dark:border-blue-500',
    badge: null,
    features: [
      '500 products',
      '500 orders/month',
      'Advanced analytics',
      'Priority email support',
      '3 stores',
      'Custom domain',
    ],
    cta: 'Upgrade to Starter',
    ctaDisabled: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    period: '/month',
    color: 'border-indigo-500 dark:border-indigo-400',
    badge: '⭐ Most Popular',
    features: [
      'Unlimited products',
      'Unlimited orders',
      'Full analytics suite',
      'Live chat support',
      '10 stores',
      'Custom domain',
      'API access',
      'Remove branding',
    ],
    cta: 'Upgrade to Pro',
    ctaDisabled: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    color: 'border-violet-500 dark:border-violet-400',
    badge: '🏢 Enterprise',
    features: [
      'Everything in Pro',
      'Unlimited stores',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
      'White-label option',
    ],
    cta: 'Contact Sales',
    ctaDisabled: false,
  },
] as const;

type PlanId = typeof PLANS[number]['id'];

// ── Upgrade Request Modal ─────────────────────────────────────────────────────

function UpgradeModal({
  plan,
  onClose,
  onRequest,
  requesting,
}: {
  plan: typeof PLANS[number];
  onClose: () => void;
  onRequest: () => void;
  requesting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>

        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🚀</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Upgrade to {plan.name}</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-2">
            Online payment is coming soon. For now, contact us to activate your plan manually.
          </p>
        </div>

        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 mb-5 text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <p className="font-semibold">💳 Payment options:</p>
          <p>• Bank transfer</p>
          <p>• Vodafone Cash / InstaPay</p>
          <p>• Contact us at <span className="font-mono">support@shophub.com</span></p>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 text-center">
          Click <strong>"Request Activation"</strong> and we'll reach out within 24 hours to confirm your payment and activate the plan.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={onRequest}
            disabled={requesting}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {requesting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending…
              </>
            ) : '📩 Request Activation'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Debug Plan Switcher (dev tool) ────────────────────────────────────────────
// Visible to all store admins — uses the owner's own store ID directly

function DebugPlanSwitcher({ store }: { store: Store }) {
  const dispatch = useAppDispatch();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (plan: string) => {
    setSwitching(true);
    setError(null);
    try {
      // Use the store's own ID — this hits PATCH /api/v1/admin/stores/:id/plan
      // which is in the tenant router and requires role:admin in the JWT
      const res = await storesApi.updatePlan(store._id, plan, 'active');
      dispatch(setCurrentStore(res.data.data));
      toast.success(`✅ Plan switched to ${plan} (active)`);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to switch plan';
      setError(msg);
      toast.error(msg);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="card p-5 border-2 border-dashed border-amber-300 dark:border-amber-700">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🛠️</span>
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Debug: Switch Plan Instantly</h3>
        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">Dev Only</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Current: <strong className="text-gray-700 dark:text-gray-300">{store.subscriptionPlan}</strong>
        <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${
          store.subscriptionStatus === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        }`}>{store.subscriptionStatus}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {(['free', 'starter', 'pro', 'enterprise'] as const).map(plan => (
          <button
            key={plan}
            onClick={() => handleSwitch(plan)}
            disabled={switching || store.subscriptionPlan === plan}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
              store.subscriptionPlan === plan
                ? 'bg-indigo-600 text-white cursor-default'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300'
            }`}
          >
            {switching && store.subscriptionPlan !== plan ? '…' : plan}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-2">
          ⚠️ {error}
          {error.includes('permission') && (
            <span className="block mt-1 text-gray-400">
              Your JWT role must be "admin". Try logging out and back in.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPricing() {
  const dispatch = useAppDispatch();
  const currentStore = useAppSelector(s => s.currentStore.current);
  const [selectedPlan, setSelectedPlan] = useState<typeof PLANS[number] | null>(null);
  const [requesting, setRequesting] = useState(false);

  const currentPlanId = currentStore?.subscriptionPlan ?? 'free';

  const handleUpgradeClick = (plan: typeof PLANS[number]) => {
    if (plan.id === 'enterprise') {
      window.open('mailto:support@shophub.com?subject=Enterprise Plan Inquiry', '_blank');
      return;
    }
    setSelectedPlan(plan);
  };

  const handleRequest = async () => {
    if (!selectedPlan || !currentStore) return;
    setRequesting(true);
    try {
      const res = await storesApi.requestUpgrade(currentStore._id, selectedPlan.id);
      toast.success(res.data.data.message || 'Request sent! We\'ll contact you within 24 hours.');
      setSelectedPlan(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to send request';
      toast.error(`${msg}. Please email support@shophub.com directly.`);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Choose Your Plan</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Scale your store as you grow. Upgrade or downgrade anytime.
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        {PLANS.map(plan => {
          const isCurrent = plan.id === currentPlanId;
          const isDowngrade = PLANS.findIndex(p => p.id === plan.id) < PLANS.findIndex(p => p.id === currentPlanId);

          return (
            <div
              key={plan.id}
              className={`relative card p-6 flex flex-col border-2 transition-all ${plan.color} ${
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
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
                    : plan.id === 'pro'
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5'
                    : 'bg-gray-900 dark:bg-white hover:bg-gray-700 dark:hover:bg-gray-100 text-white dark:text-gray-900 hover:-translate-y-0.5'
                }`}
              >
                {isCurrent ? '✓ Active' : isDowngrade ? 'Downgrade' : plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* Debug tool — only visible in development mode */}
      {import.meta.env.DEV && currentStore && (
        <DebugPlanSwitcher store={currentStore} />
      )}

      {/* FAQ */}
      <div className="mt-10 card p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Frequently Asked Questions</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {[
            { q: 'How do I pay?', a: 'We accept bank transfer, Vodafone Cash, and InstaPay. Contact us after requesting activation.' },
            { q: 'Can I downgrade?', a: 'Yes, contact support and we\'ll adjust your plan at the end of your billing cycle.' },
            { q: 'Is there a free trial?', a: 'All new stores start on a free trial. No credit card required.' },
            { q: 'What happens if I exceed limits?', a: 'We\'ll notify you and give you time to upgrade before any restrictions apply.' },
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
