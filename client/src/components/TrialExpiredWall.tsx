import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch';
import { fetchCurrentStore } from '../store/storeSlice';
import { motion } from 'framer-motion';

/**
 * Full-screen paywall shown when the 7-day trial has expired and the store
 * is not on a paid plan. Replaces the entire admin content area.
 */
export default function TrialExpiredWall() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currentStore = useAppSelector(s => s.currentStore.current);

  // If the super-admin just activated a plan, the vendor can click this to
  // re-fetch the store data without a full page reload.
  const handleRefresh = () => {
    dispatch(fetchCurrentStore());
  };

  return (
    <div className="flex-1 bg-gray-950 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-lg w-full text-center"
      >
        {/* Icon */}
        <div className="relative inline-block mb-6">
          <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-4xl">🔒</span>
            </div>
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-white mb-3">
          Your free trial has ended
        </h1>
        <p className="text-gray-400 text-base mb-2">
          <span className="text-white font-semibold">{currentStore?.name ?? 'Your store'}</span> had
          7 days of full access. To continue using the dashboard, choose a plan.
        </p>
        <p className="text-gray-500 text-sm mb-8">
          Your data is safe — products, orders, and settings are preserved.
        </p>

        {/* Plan highlights */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { plan: 'Starter', price: '$29/mo', highlight: '500 products', color: 'border-blue-500/40 bg-blue-500/5' },
            { plan: 'Pro', price: '$79/mo', highlight: 'Unlimited everything', color: 'border-indigo-500/60 bg-indigo-500/10', badge: '⭐ Popular' },
            { plan: 'Enterprise', price: 'Custom', highlight: 'Dedicated support', color: 'border-violet-500/40 bg-violet-500/5' },
          ].map(p => (
            <div key={p.plan} className={`rounded-xl border p-4 text-left ${p.color}`}>
              {p.badge && (
                <span className="text-xs font-bold text-indigo-400 block mb-1">{p.badge}</span>
              )}
              <p className="text-white font-semibold text-sm">{p.plan}</p>
              <p className="text-gray-300 text-xs mt-0.5">{p.price}</p>
              <p className="text-gray-500 text-xs mt-1">{p.highlight}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/admin/pricing')}
            className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-base transition-all shadow-lg shadow-indigo-600/30 hover:-translate-y-0.5"
          >
            🚀 Choose a Plan
          </button>
          <a
            href="mailto:support@shophub.com?subject=Trial Extension Request"
            className="px-8 py-3.5 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:border-white/20 font-medium text-base transition-all"
          >
            Contact Support
          </a>
        </div>

        {/* Already activated? Refresh the session without reloading */}
        <button
          onClick={handleRefresh}
          className="mt-5 text-xs text-gray-600 hover:text-gray-400 transition-colors underline underline-offset-2"
        >
          Already activated a plan? Click here to refresh
        </button>

        <p className="text-gray-600 text-xs mt-4">
          Need more time? Email us at{' '}
          <a href="mailto:support@shophub.com" className="text-gray-500 hover:text-gray-400 underline">
            support@shophub.com
          </a>
        </p>
      </motion.div>
    </div>
  );
}
