import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { fetchCurrentStore, fetchMyStores, setCurrentStore } from '../../store/storeSlice';
import { clearCart } from '../../store/cartSlice';
import { removeCoupon } from '../../store/couponSlice';
import { setTokens } from '../../store/authSlice';
import api from '../../api/axios';
import { Store } from '../../types';
import toast from 'react-hot-toast';

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminNewStore() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; slug?: string }>({});

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugManual) setSlug(slugify(v));
  };

  const handleSlugChange = (v: string) => {
    setSlugManual(true);
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Store name is required';
    if (!slug.trim()) e.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(slug)) e.slug = 'Only lowercase letters, numbers, and hyphens';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      // POST /api/v1/stores — uses the authenticated user's JWT, no store context needed
      const res = await api.post<{ data: { store: Store; accessToken: string } }>('/stores', {
        name: name.trim(),
        slug,
      });
      const { store: newStore, accessToken } = res.data.data;

      // 1. Swap the access token FIRST — it's scoped to the new store.
      //    This must happen before any request that carries X-Store-ID for the new store,
      //    otherwise the cross-tenant guard will reject with 403.
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('currentStoreId', newStore._id);
      dispatch(setTokens({ accessToken }));

      // 2. Clear stale cart & coupon from the previous store
      dispatch(clearCart());
      dispatch(removeCoupon());

      // 3. Update Redux store state
      dispatch(setCurrentStore(newStore));
      dispatch(fetchCurrentStore());
      dispatch(fetchMyStores()); // refresh the switcher list

      toast.success(`"${newStore.name}" created! Switching now…`);

      // 4. Hard redirect — forces all data to re-fetch with the new token + store ID
      setTimeout(() => {
        navigate('/admin');
        window.location.reload();
      }, 600);
    } catch {
      // toast fired by axios interceptor
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-lg">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/admin')}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 mb-4 transition-colors"
        >
          ← Back to Dashboard
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Store</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add another store to your account. You can switch between stores anytime from the sidebar.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        {/* Store Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Store Name
          </label>
          <input
            className="input"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="e.g. My Fashion Store"
            autoFocus
          />
          {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
        </div>

        {/* Slug */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Store Slug <span className="text-gray-400 font-normal">(URL identifier)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm shrink-0">shophub.com/</span>
            <input
              className="input flex-1 font-mono"
              value={slug}
              onChange={e => handleSlugChange(e.target.value)}
              placeholder="my-fashion-store"
            />
          </div>
          {slug && !errors.slug && (
            <p className="text-xs text-gray-400 mt-1">
              Your store URL: <span className="text-primary-600 dark:text-primary-400 font-mono">{slug}.shophub.com</span>
            </p>
          )}
          {errors.slug && <p className="text-red-500 text-xs mt-1">{errors.slug}</p>}
        </div>

        {/* Info box */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-0.5">ℹ️ Same account, new store</p>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            This store will be added to your existing account. No new email or password needed.
            Switch between stores using the dropdown in the sidebar.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="btn-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating…
              </>
            ) : '🏪 Create Store'}
          </button>
        </div>
      </div>
    </div>
  );
}
