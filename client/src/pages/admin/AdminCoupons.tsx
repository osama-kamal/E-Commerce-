import { useEffect, useState } from 'react';
import { couponsApi, CouponData } from '../../api/coupons';
import toast from 'react-hot-toast';

interface Coupon {
  _id: string;
  code: string;
  type: 'percent' | 'fixed';
  discount: number;
  minOrderAmount: number;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
}

const emptyForm: CouponData = {
  code: '',
  type: 'percent',
  discount: 10,
  minOrderAmount: 0,
  maxUses: 0,
  isActive: true,
  expiresAt: null,
};

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCoupons();
  }, []);

  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const res = await couponsApi.list();
      setCoupons(res.data.data);
    } catch {
      toast.error('Failed to load coupons');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditingId(coupon._id);
    setForm({
      code: coupon.code,
      type: coupon.type,
      discount: coupon.discount,
      minOrderAmount: coupon.minOrderAmount,
      maxUses: coupon.maxUses,
      isActive: coupon.isActive,
      expiresAt: coupon.expiresAt
        ? new Date(coupon.expiresAt).toISOString().split('T')[0]
        : null,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      toast.error('Coupon code is required');
      return;
    }
    if (form.discount <= 0) {
      toast.error('Discount must be greater than 0');
      return;
    }
    if (form.type === 'percent' && form.discount > 100) {
      toast.error('Percent discount cannot exceed 100');
      return;
    }

    setSaving(true);
    try {
      const payload: CouponData = {
        ...form,
        code: form.code.toUpperCase().trim(),
        expiresAt: form.expiresAt || null,
      };

      if (editingId) {
        await couponsApi.update(editingId, payload);
        toast.success('Coupon updated');
      } else {
        await couponsApi.create(payload);
        toast.success('Coupon created');
      }
      setShowModal(false);
      fetchCoupons();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this coupon? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await couponsApi.delete(id);
      toast.success('Coupon deleted');
      setCoupons(prev => prev.filter(c => c._id !== id));
    } catch {
      toast.error('Failed to delete coupon');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isExpired = (expiresAt?: string) =>
    expiresAt ? new Date(expiresAt) < new Date() : false;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">🏷️ Coupons</h1>
          <p className="text-gray-600 text-sm">Manage promo codes and discounts</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <span>+</span> Create Coupon
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="mt-2 text-gray-500 text-sm">Loading coupons…</p>
          </div>
        ) : coupons.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-5xl mb-3">🏷️</p>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">No coupons yet</h3>
            <p className="text-sm text-gray-500">Create your first promo code to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Discount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Min Order</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uses</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {coupons.map(coupon => (
                  <tr key={coupon._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">{coupon.code}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{coupon.type}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {coupon.type === 'percent' ? `${coupon.discount}%` : `$${coupon.discount.toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {coupon.minOrderAmount > 0 ? `$${coupon.minOrderAmount.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {coupon.usedCount}
                      {coupon.maxUses > 0 && <span className="text-gray-400"> / {coupon.maxUses}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {!coupon.isActive ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          Inactive
                        </span>
                      ) : isExpired(coupon.expiresAt) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Expired
                        </span>
                      ) : coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                          Maxed out
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(coupon.expiresAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(coupon)}
                          className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(coupon._id)}
                          disabled={deletingId === coupon._id}
                          className="text-xs px-2.5 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors font-medium disabled:opacity-50"
                        >
                          {deletingId === coupon._id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />

          {/* Modal */}
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {editingId ? 'Edit Coupon' : 'Create Coupon'}
            </h2>

            {/* Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. SAVE20"
                className="input w-full font-mono uppercase"
                disabled={!!editingId}
              />
              {editingId && (
                <p className="text-xs text-gray-400 mt-1">Code cannot be changed after creation.</p>
              )}
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Discount Type <span className="text-red-500">*</span>
              </label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as 'percent' | 'fixed' }))}
                className="input w-full"
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount ($)</option>
              </select>
            </div>

            {/* Discount value */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Discount Value <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  {form.type === 'percent' ? '%' : '$'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={form.type === 'percent' ? 100 : undefined}
                  value={form.discount}
                  onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))}
                  className="input w-full pl-8"
                />
              </div>
            </div>

            {/* Min order */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Minimum Order Amount ($)
              </label>
              <input
                type="number"
                min={0}
                value={form.minOrderAmount}
                onChange={e => setForm(f => ({ ...f, minOrderAmount: Number(e.target.value) }))}
                className="input w-full"
                placeholder="0 = no minimum"
              />
            </div>

            {/* Max uses */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Uses
              </label>
              <input
                type="number"
                min={0}
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: Number(e.target.value) }))}
                className="input w-full"
                placeholder="0 = unlimited"
              />
              <p className="text-xs text-gray-400 mt-1">0 = unlimited uses</p>
            </div>

            {/* Expires at */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Expiry Date
              </label>
              <input
                type="date"
                value={form.expiresAt ?? ''}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value || null }))}
                className="input w-full"
                min={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank for no expiry</p>
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                Active (coupon can be used)
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
