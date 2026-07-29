import React, { useEffect, useState } from 'react';
import { DashboardContainer } from '../../components/dashboard/DashboardContainer';
import { CardGridSkeleton, Skeleton, StatCardsSkeleton } from '../../components/Skeleton';
import { adminApi } from '../../api/admin';
import { Store } from '../../types';
import { Link } from 'react-router-dom';

// Derive platform admin status purely from the JWT role claim.
// role: 'super-admin' → platform dashboard
// role: 'admin'       → store dashboard
function checkIsPlatformAdmin(): boolean {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return false;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload?.role === 'super-admin';
  } catch {
    return false;
  }
}

// ── Platform-level dashboard ──────────────────────────────────────────────────

function PlatformDashboard() {
  const [stores, setStores] = useState<Store[]>([]);
  const [pendingUpgrades, setPendingUpgrades] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      adminApi.listAllStores(1, 100),
      adminApi.listPendingUpgrades(),
    ])
      .then(([storesRes, pendingRes]) => {
        setStores(storesRes.data.data.data ?? []);
        setPendingUpgrades(pendingRes.data.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleActivate = async (store: Store) => {
    if (!store.requestedPlan) return;
    if (!window.confirm(`Activate ${store.requestedPlan.toUpperCase()} plan for "${store.name}"?`)) return;
    setActivatingId(store._id);
    try {
      await adminApi.updateStorePlan(store._id, store.requestedPlan, 'active');
      setPendingUpgrades(prev => prev.filter(s => s._id !== store._id));
      setStores(prev => prev.map(s => s._id === store._id
        ? { ...s, subscriptionPlan: store.requestedPlan!, subscriptionStatus: 'active', requestedPlan: undefined }
        : s
      ));
    } catch {
      // toast from interceptor
    } finally {
      setActivatingId(null);
    }
  };

  const totalStores = stores.length;
  const activeStores = stores.filter(s => s.subscriptionStatus === 'active').length;
  const trialingStores = stores.filter(s => s.subscriptionStatus === 'trialing').length;
  const paidStores = stores.filter(s => s.subscriptionPlan !== 'free').length;
  const freeStores = stores.filter(s => s.subscriptionPlan === 'free').length;
  const starterStores = stores.filter(s => s.subscriptionPlan === 'starter').length;
  const proStores = stores.filter(s => s.subscriptionPlan === 'pro').length;
  const enterpriseStores = stores.filter(s => s.subscriptionPlan === 'enterprise').length;

  // Most recently created stores
  const recentStores = [...stores]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  if (loading) {
    // Mirrors the loaded layout below (header → KPI row → two-column panels) so
    // the page does not jump when the real numbers arrive.
    return (
      <div className="p-6 max-w-7xl">
        <div className="mb-6 space-y-2" aria-hidden="true">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="mb-8">
          <StatCardsSkeleton count={4} label="Loading platform data…" />
        </div>
        <CardGridSkeleton count={2} lines={5} className="grid lg:grid-cols-2 gap-6" label="" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">🌐</span>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Overview</h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 ml-10">
          High-level metrics across all {totalStores} tenant stores.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Stores',
            value: totalStores,
            icon: '🏪',
            bg: 'bg-indigo-50 dark:bg-indigo-900/20',
            text: 'text-indigo-600 dark:text-indigo-400',
            sub: `${activeStores} active`,
          },
          {
            label: 'On Trial',
            value: trialingStores,
            icon: '⏳',
            bg: 'bg-amber-50 dark:bg-amber-900/20',
            text: 'text-amber-600 dark:text-amber-400',
            sub: 'trial period',
          },
          {
            label: 'Paid Subscriptions',
            value: paidStores,
            icon: '💰',
            bg: 'bg-emerald-50 dark:bg-emerald-900/20',
            text: 'text-emerald-600 dark:text-emerald-400',
            sub: `of ${totalStores} total`,
          },
          {
            label: 'Active Stores',
            value: activeStores,
            icon: '✅',
            bg: 'bg-violet-50 dark:bg-violet-900/20',
            text: 'text-violet-600 dark:text-violet-400',
            sub: 'subscription active',
          },
        ].map(card => (
          <div key={card.label} className={`card p-5 ${card.bg} border border-transparent`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xl">{card.icon}</span>
            </div>
            <p className={`text-3xl font-bold ${card.text} mb-1`}>{card.value}</p>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{card.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pending upgrade requests */}
        {pendingUpgrades.length > 0 && (
          <div className="lg:col-span-2 card p-5 border-2 border-amber-300 dark:border-amber-700">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">🔔</span>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Pending Upgrade Requests
              </h2>
              <span className="ml-auto text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold">
                {pendingUpgrades.length} pending
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Store</th>
                    <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current Plan</th>
                    <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Requested Plan</th>
                    <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Requested On</th>
                    <th className="text-right pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pendingUpgrades.map(store => (
                    <tr key={store._id} className="hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors">
                      <td className="py-3">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{store.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{store._id}</p>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 capitalize font-medium">
                          {store.subscriptionPlan}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 capitalize font-semibold">
                          ⭐ {store.requestedPlan ?? '—'}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(store.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleActivate(store)}
                          disabled={activatingId === store._id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 ml-auto"
                        >
                          {activatingId === store._id ? (
                            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : '✅'}
                          Activate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Plan breakdown */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Plan Distribution</h2>
          <div className="space-y-3">
            {[
              { label: 'Free',       count: freeStores,       color: 'bg-gray-400',    textColor: 'text-gray-600 dark:text-gray-300' },
              { label: 'Starter',    count: starterStores,    color: 'bg-blue-500',    textColor: 'text-blue-600 dark:text-blue-400' },
              { label: 'Pro',        count: proStores,        color: 'bg-indigo-500',  textColor: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Enterprise', count: enterpriseStores, color: 'bg-violet-500',  textColor: 'text-violet-600 dark:text-violet-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className={`text-xs font-medium w-20 ${row.textColor}`}>{row.label}</span>
                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.color} transition-all duration-500`}
                    style={{ width: totalStores > 0 ? `${(row.count / totalStores) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-6 text-right">{row.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Link
              to="/admin/stores"
              className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              Manage all stores →
            </Link>
          </div>
        </div>

        {/* Recently created stores */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Recently Created Stores</h2>
          <div className="space-y-2">
            {recentStores.length === 0 ? (
              <p className="text-sm text-gray-400">No stores yet.</p>
            ) : (
              recentStores.map(store => (
                <div key={store._id} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-xs font-bold shrink-0">
                    {store.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{store.name}</p>
                    <p className="text-xs text-gray-400">{new Date(store.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                      store.subscriptionPlan === 'free'
                        ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                    }`}>
                      {store.subscriptionPlan}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                      store.subscriptionStatus === 'active'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {store.subscriptionStatus}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Link
              to="/admin/pricing"
              className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              Manage plans & pricing →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  // Derive from the JWT — not localStorage — to prevent stale store ID leaking
  // platform view to users who aren't the platform admin.
  const isPlatformAdmin = checkIsPlatformAdmin();

  if (isPlatformAdmin) {
    return <PlatformDashboard />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Analytics Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Comprehensive insights into your business performance
          </p>
        </div>

        <DashboardContainer />
      </div>
    </div>
  );
}
