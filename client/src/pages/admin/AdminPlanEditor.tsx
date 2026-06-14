import { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import type { PlanDisplay } from './AdminPricing';

// ── Per-plan editor ───────────────────────────────────────────────────────────

function PlanEditor({ plan, onSaved }: { plan: PlanDisplay; onSaved: (updated: PlanDisplay) => void }) {
  const [form, setForm] = useState<PlanDisplay>({ ...plan });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Keep form in sync if parent reloads
  useEffect(() => { setForm({ ...plan }); }, [plan]);

  const handleField = (key: keyof PlanDisplay, value: unknown) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleFeatureChange = (idx: number, val: string) => {
    const next = [...form.features];
    next[idx] = val;
    setForm(prev => ({ ...prev, features: next }));
  };

  const addFeature = () => setForm(prev => ({ ...prev, features: [...prev.features, ''] }));

  const removeFeature = (idx: number) =>
    setForm(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/plans/${plan.planId}`, {
        displayName: form.displayName,
        price: form.price,
        period: form.period,
        features: form.features.filter(f => f.trim() !== ''),
        badge: form.badge || null,
        ctaLabel: form.ctaLabel,
        isContactSales: form.isContactSales,
        isHighlighted: form.isHighlighted,
        sortOrder: form.sortOrder,
      });
      onSaved(res.data.data);
      toast.success(`${form.displayName} plan updated.`);
      setExpanded(false);
    } catch {
      // axios interceptor shows toast
    } finally {
      setSaving(false);
    }
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(plan);

  return (
    <div className="card border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-900 dark:text-white">{plan.displayName}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{plan.price}{plan.period}</span>
          {plan.badge && (
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
              {plan.badge}
            </span>
          )}
          {isDirty && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
              Unsaved changes
            </span>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-800 space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Display name */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
              <input
                value={form.displayName}
                onChange={e => handleField('displayName', e.target.value)}
                className="input-field w-full"
                maxLength={60}
              />
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Price</label>
              <input
                value={form.price}
                onChange={e => handleField('price', e.target.value)}
                placeholder="$29 or Custom"
                className="input-field w-full"
                maxLength={20}
              />
            </div>

            {/* Period */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Period</label>
              <input
                value={form.period}
                onChange={e => handleField('period', e.target.value)}
                placeholder="/month or forever or leave empty"
                className="input-field w-full"
                maxLength={20}
              />
            </div>

            {/* Badge */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Badge <span className="text-gray-400">(optional)</span></label>
              <input
                value={form.badge ?? ''}
                onChange={e => handleField('badge', e.target.value || null)}
                placeholder="⭐ Most Popular"
                className="input-field w-full"
                maxLength={60}
              />
            </div>

            {/* CTA label */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">CTA Button Label</label>
              <input
                value={form.ctaLabel}
                onChange={e => handleField('ctaLabel', e.target.value)}
                className="input-field w-full"
                maxLength={60}
              />
            </div>

            {/* Sort order */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Sort Order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={e => handleField('sortOrder', Number(e.target.value))}
                className="input-field w-full"
                min={0}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isHighlighted}
                onChange={e => handleField('isHighlighted', e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Highlight (indigo button)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isContactSales}
                onChange={e => handleField('isContactSales', e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Show "Contact Sales" modal on CTA click</span>
            </label>
          </div>

          {/* Features */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Features</label>
              <button
                onClick={addFeature}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
              >
                + Add feature
              </button>
            </div>
            <div className="space-y-2">
              {form.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-emerald-500 shrink-0 text-sm">✓</span>
                  <input
                    value={f}
                    onChange={e => handleFeatureChange(i, e.target.value)}
                    placeholder="Feature description"
                    className="input-field flex-1 text-sm"
                    maxLength={200}
                  />
                  <button
                    onClick={() => removeFeature(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors shrink-0 text-lg leading-none"
                    aria-label="Remove feature"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => { setForm({ ...plan }); setExpanded(false); }}
              className="btn-secondary text-sm px-4 py-2"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
              ) : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPlanEditor() {
  const [plans, setPlans] = useState<PlanDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/plans')
      .then(res => setPlans(res.data?.data ?? []))
      .catch(() => toast.error('Failed to load plan configs'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (updated: PlanDisplay) => {
    setPlans(prev => prev.map(p => p.planId === updated.planId ? updated : p));
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Plan Editor</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Update what customers see on the pricing page — names, prices, features, and CTA labels.
          Enforcement limits (product caps, order limits, etc.) are managed in code.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          <p className="text-2xl mb-2">📋</p>
          <p className="font-medium">No plan configs found.</p>
          <p className="text-sm mt-1">They'll be auto-seeded on the next pricing page load.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <PlanEditor key={plan.planId} plan={plan} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
