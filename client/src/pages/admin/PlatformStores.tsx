import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../../api/admin';
import { CardGridSkeleton, TableSkeleton } from '../../components/Skeleton';
import { Store } from '../../types';
import toast from 'react-hot-toast';

const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;
type Plan = typeof PLANS[number];

const PLAN_COLORS: Record<Plan, string> = {
  free:       'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  starter:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pro:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  enterprise: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
};

const STATUS_COLORS: Record<string, string> = {
  active:           'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  trialing:         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  past_due:         'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled:        'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  suspended:        'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  pending_upgrade:  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};

// ── Impersonation helpers ─────────────────────────────────────────────────────
// We stash the platform admin's original token under a separate key so we can
// restore it cleanly when the admin clicks "Return to Platform Admin".

const PLATFORM_TOKEN_KEY  = 'platformAdminToken';
const PLATFORM_STORE_KEY  = 'platformAdminStore';

function saveImpersonationBackup() {
  const token = localStorage.getItem('accessToken');
  const store = localStorage.getItem('currentStore');
  if (token) localStorage.setItem(PLATFORM_TOKEN_KEY, token);
  if (store) localStorage.setItem(PLATFORM_STORE_KEY, store);
}

export function isImpersonating(): boolean {
  return !!localStorage.getItem(PLATFORM_TOKEN_KEY);
}

export function returnToPlatformAdmin() {
  const token = localStorage.getItem(PLATFORM_TOKEN_KEY);
  const storeRaw = localStorage.getItem(PLATFORM_STORE_KEY);
  if (!token || !storeRaw) return;

  // Restore the super-admin's original token and store context
  const storeObj = JSON.parse(storeRaw) as { _id?: string };
  localStorage.setItem('accessToken', token);
  if (storeObj._id) localStorage.setItem('currentStoreId', storeObj._id);
  localStorage.setItem('currentStore', storeRaw);
  localStorage.removeItem(PLATFORM_TOKEN_KEY);
  localStorage.removeItem(PLATFORM_STORE_KEY);

  window.location.href = '/admin';
}

// ── Plan + Status selector for inline editing ─────────────────────────────────

function PlanEditor({
  store,
  onUpdated,
}: {
  store: Store;
  onUpdated: (updated: Store) => void;
}) {
  const [plan, setPlan] = useState(store.subscriptionPlan as Plan);
  const [status, setStatus] = useState(store.subscriptionStatus);
  const [saving, setSaving] = useState(false);

  const hasChanged = plan !== store.subscriptionPlan || status !== store.subscriptionStatus;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await adminApi.updateStorePlan(store._id, plan, status);
      onUpdated(res.data.data);
      toast.success(`✅ ${store.name} updated to ${plan} / ${status}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={plan}
        onChange={e => setPlan(e.target.value as Plan)}
        className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {PLANS.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <select
        value={status}
        onChange={e => setStatus(e.target.value)}
        className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {['active', 'trialing', 'past_due', 'cancelled', 'suspended'].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {hasChanged && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : '💾'}
          Save
        </button>
      )}
    </div>
  );
}

// ── Login as Admin button ─────────────────────────────────────────────────────

function getJwtUserId(): string | undefined {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return undefined;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload?.userId === 'string' ? payload.userId : undefined;
  } catch {
    return undefined;
  }
}

function LoginAsAdminButton({ store }: { store: Store }) {
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // If this store is owned by the currently logged-in super-admin, show a
  // quick-nav dropdown instead of an impersonate button (no token swap needed).
  const currentUserId = getJwtUserId();
  const isOwnStore = !!currentUserId && store.ownerId === currentUserId;

  if (isOwnStore) {
    const links = [
      { label: '📊 Dashboard',  href: '/admin' },
      { label: '🛒 Orders',     href: '/admin/orders' },
      { label: '📦 Products',   href: '/admin/products' },
      { label: '👥 Users',      href: '/admin/users' },
      { label: '🗂️ Categories', href: '/admin/categories' },
      { label: '📧 Newsletter', href: '/admin/newsletter' },
      { label: '⚙️ Settings',   href: '/admin/settings' },
    ];

    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          title="Jump to any section of your store"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium transition-colors border border-emerald-200 dark:border-emerald-800"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Manage Store
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
            {links.map(l => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  const handleClick = async () => {
    setLoading(true);
    try {
      const currentToken = localStorage.getItem('accessToken') ?? '';

      const res = await fetch(`/api/v1/stores/${store._id}/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message ?? `HTTP ${res.status}`);
      }

      const json = await res.json();
      const newToken: string = json?.data?.accessToken;
      if (!newToken) throw new Error('No token returned');

      // Stash the platform admin credentials before overwriting them
      saveImpersonationBackup();

      // Swap to the target store context
      localStorage.setItem('accessToken', newToken);
      localStorage.setItem('currentStoreId', store._id);
      localStorage.setItem('currentStore', JSON.stringify(store));

      toast.success(`👤 Viewing as admin of ${store.name}`);

      // Hard-reload so AdminLayout re-initialises with the new store context
      window.location.href = '/admin';
    } catch (err: any) {
      toast.error(`Failed to impersonate: ${err?.message ?? 'Unknown error'}`);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={`Log in as admin of ${store.name}`}
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 font-medium transition-colors disabled:opacity-50 border border-indigo-200 dark:border-indigo-800"
    >
      {loading ? (
        <span className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-500 rounded-full animate-spin" />
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
        </svg>
      )}
      Log in as Admin
    </button>
  );
}

// ── Store row ─────────────────────────────────────────────────────────────────

function StoreRow({
  store,
  index,
  onUpdated,
}: {
  store: Store;
  index: number;
  onUpdated: (updated: Store) => void;
}) {
  const planKey = store.subscriptionPlan as Plan;
  const statusKey = store.subscriptionStatus;

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 w-8 text-center">
        {index + 1}
      </td>
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{store.name}</p>
          <p className="text-xs text-gray-400 font-mono">{store.slug}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono hidden md:table-cell">
        {store._id}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[planKey] ?? PLAN_COLORS.free}`}>
          {store.subscriptionPlan}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[statusKey] ?? STATUS_COLORS.trialing}`}>
          {store.subscriptionStatus === 'pending_upgrade' ? '⏳ pending upgrade' : store.subscriptionStatus}
        </span>
      </td>
      <td className="px-4 py-3">
        {store.requestedPlan ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 capitalize">
            ⭐ {store.requestedPlan}
          </span>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-400">
        {new Date(store.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <PlanEditor store={store} onUpdated={onUpdated} />
      </td>
      <td className="px-4 py-3">
        <LoginAsAdminButton store={store} />
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Upgrade Requests tab ──────────────────────────────────────────────────────

type PendingStore = Store & {
  ownerEmail: string | null;
  ownerName: string | null;
  requestedPlan?: string;
  subscriptionEndsAt?: string | null;
  daysRemaining?: number | null;
};

function UpgradeRequestsTab() {
  const [requests, setRequests] = useState<PendingStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  // Per-row end date pickers (storeId → ISO date string)
  const [endDates, setEndDates] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    adminApi
      .listPendingUpgrades()
      .then(res => {
        const data = (res.data.data ?? []) as PendingStore[];
        setRequests(data);
        // Pre-populate endDates with +30 days as a sensible default
        const defaults: Record<string, string> = {};
        data.forEach(s => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          defaults[s._id] = d.toISOString().slice(0, 10);
        });
        setEndDates(defaults);
      })
      .catch(() => toast.error('Failed to load upgrade requests'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async (store: PendingStore) => {
    if (!store.requestedPlan) {
      toast.error('No requested plan found for this store.');
      return;
    }
    setActivating(store._id);
    try {
      const endsAt = endDates[store._id];
      await adminApi.updateStorePlan(store._id, store.requestedPlan, 'active', endsAt);
      toast.success(`✅ ${store.name} activated on ${store.requestedPlan} plan.`);
      setRequests(prev => prev.filter(r => r._id !== store._id));
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to activate plan');
    } finally {
      setActivating(null);
    }
  };

  const handleReject = async (store: PendingStore) => {
    setActivating(store._id);
    try {
      await adminApi.updateStorePlan(store._id, store.subscriptionPlan, 'trialing');
      toast.success(`Request from ${store.name} dismissed.`);
      setRequests(prev => prev.filter(r => r._id !== store._id));
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to dismiss request');
    } finally {
      setActivating(null);
    }
  };

  if (loading) {
    return (
      <CardGridSkeleton
        count={3}
        lines={4}
        className="space-y-4"
        label="Loading upgrade requests…"
      />
    );
  }

  if (requests.length === 0) {
    return (
      <div className="card flex items-center justify-center py-20 text-center">
        <div>
          <p className="text-4xl mb-3">🎉</p>
          <p className="font-medium text-gray-800 dark:text-gray-200">No pending upgrade requests</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Requests will appear here when store owners click "Request Activation".
          </p>
          <button onClick={load} className="btn-secondary text-sm mt-4 px-4 py-2">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {requests.length} pending request{requests.length !== 1 ? 's' : ''}
        </p>
        <button onClick={load} className="btn-secondary text-xs px-3 py-1.5">
          ↻ Refresh
        </button>
      </div>

      <div className="space-y-4">
        {requests.map(store => {
          const isLoading = activating === store._id;
          const isActive = store.subscriptionStatus === 'active';

          return (
            <div key={store._id} className="card border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Header row */}
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">{store.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{store.slug}</p>
                  {store.ownerEmail && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">📧 {store.ownerEmail}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Current plan badge */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    PLAN_COLORS[store.subscriptionPlan as Plan] ?? 'bg-gray-100 text-gray-600'
                  }`}>
                    {store.subscriptionPlan}
                  </span>
                  <span className="text-gray-400 text-xs">→</span>
                  {/* Requested plan badge */}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    ⬆ {store.requestedPlan}
                  </span>
                  {/* Status badge */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_COLORS[store.subscriptionStatus] ?? 'bg-gray-100 text-gray-500'
                  }`}>
                    {store.subscriptionStatus.replace('_', ' ')}
                  </span>
                </div>
              </div>

              {/* Details row */}
              <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-gray-50 dark:bg-gray-800/30 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Current Plan</p>
                  <p className="font-medium text-gray-800 dark:text-gray-200 capitalize">{store.subscriptionPlan}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Current Ends</p>
                  <p className="font-medium text-gray-800 dark:text-gray-200">
                    {store.subscriptionEndsAt
                      ? new Date(store.subscriptionEndsAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : <span className="text-xs text-gray-400 italic">Not set</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Days Remaining</p>
                  <p className={`font-semibold ${
                    store.daysRemaining == null ? 'text-gray-400' :
                    store.daysRemaining <= 3 ? 'text-red-600 dark:text-red-400' :
                    store.daysRemaining <= 10 ? 'text-amber-600 dark:text-amber-400' :
                    'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {store.daysRemaining == null
                      ? <span className="text-xs italic font-normal">No end date set</span>
                      : store.daysRemaining === 0
                        ? 'Expired'
                        : `${store.daysRemaining}d`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Requested</p>
                  <p className="text-gray-600 dark:text-gray-400 text-xs">
                    {store.updatedAt
                      ? new Date(store.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </p>
                </div>
              </div>

              {/* Action row */}
              <div className="px-5 py-3 flex flex-wrap items-center gap-3">
                {/* New plan end date picker */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">New plan ends:</label>
                  <input
                    type="date"
                    value={endDates[store._id] ?? ''}
                    onChange={e => setEndDates(prev => ({ ...prev, [store._id]: e.target.value }))}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {isActive && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ Currently active — activating immediately overrides the current cycle
                    </p>
                  )}
                  <button
                    onClick={() => handleActivate(store)}
                    disabled={isLoading || !store.requestedPlan}
                    // hover was emerald-500 — LIGHTER than the base, the opposite
                    // direction to every other button in the app. btn-success
                    // darkens on hover like the rest.
                    className="btn btn-success btn-sm gap-1.5 font-semibold"
                  >
                    {isLoading ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '✓'} Activate Now
                  </button>
                  <button
                    onClick={() => handleReject(store)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PlatformStores() {
  const [tab, setTab] = useState<'stores' | 'upgrades'>('stores');
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState<Plan | 'all'>('all');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    adminApi
      .listAllStores(1, 100)
      .then(res => setStores(res.data.data.data ?? []))
      .catch(() => toast.error('Failed to load stores'))
      .finally(() => setLoading(false));

    // Badge count for the Upgrade Requests tab
    adminApi
      .listPendingUpgrades()
      .then(res => setPendingCount(res.data.data?.length ?? 0))
      .catch(() => {});
  }, []);

  const handleUpdated = (updated: Store) => {
    setStores(prev => prev.map(s => (s._id === updated._id ? updated : s)));
  };

  const filtered = stores.filter(s => {
    const matchesSearch =
      search.trim() === '' ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.slug.toLowerCase().includes(search.toLowerCase()) ||
      s._id.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = filterPlan === 'all' || s.subscriptionPlan === filterPlan;
    return matchesSearch && matchesPlan;
  });

  const totalStores = stores.length;
  const activeStores = stores.filter(s => s.subscriptionStatus === 'active').length;
  const trialingStores = stores.filter(s => s.subscriptionStatus === 'trialing').length;
  const paidStores = stores.filter(s => s.subscriptionPlan !== 'free').length;

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Stores</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage all tenant stores — view plans, update subscriptions, and log in as any store admin.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        {([
          { id: 'stores',   label: 'All Stores',       icon: '🏪' },
          { id: 'upgrades', label: 'Upgrade Requests',  icon: '⬆', badge: pendingCount },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {'badge' in t && t.badge > 0 && (
              <span className="ml-1 bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'upgrades' ? (
        <UpgradeRequestsTab />
      ) : (
        <>      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Stores',  value: totalStores,    icon: '🏪', color: 'text-indigo-600 dark:text-indigo-400' },
          { label: 'Active Paid',   value: activeStores,   icon: '✅', color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'On Trial',      value: trialingStores, icon: '⏳', color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Paid Plans',    value: paidStores,     icon: '💎', color: 'text-violet-600 dark:text-violet-400' },
        ].map(card => (
          <div key={card.label} className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{card.icon}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{card.label}</span>
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, slug, or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={filterPlan}
          onChange={e => setFilterPlan(e.target.value as Plan | 'all')}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="all">All plans</option>
          {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton
            headers={[
              { label: '#', className: 'w-8' },
              'Store',
              { label: 'ID', className: 'hidden md:table-cell' },
              'Plan',
              'Status',
              'Requested',
              { label: 'Created', className: 'hidden lg:table-cell' },
              'Manage Plan',
              'Access',
            ]}
            rows={6}
            label="Loading stores…"
            headerClassName="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            theadClassName="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
          />
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-center">
            <div>
              <p className="text-3xl mb-2">🔍</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">No stores match your filters.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Store</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Requested</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Manage Plan</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Access</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((store, i) => (
                  <StoreRow key={store._id} store={store} index={i} onUpdated={handleUpdated} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3 text-right">
        Showing {filtered.length} of {totalStores} stores
      </p>
      </>
      )}
    </div>
  );
}
