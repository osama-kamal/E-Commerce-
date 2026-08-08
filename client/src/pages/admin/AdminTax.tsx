/**
 * AdminTax — merchant configuration for destination-based tax rates.
 *
 * Two things a merchant must understand, surfaced in the UI rather than buried
 * in docs because getting either wrong misprices every order:
 *
 *   1. RATES COMPOUND. Every active rate matching the destination applies and
 *      they are summed — correct for Canada (GST + PST) and US state+county,
 *      but a trap if you add a country-wide rate expecting a state rate to
 *      override it. Scope the country rate to the states it should cover.
 *
 *   2. INCLUSIVE vs EXCLUSIVE is a store-wide decision, not a per-rate one,
 *      because it describes how the merchant lists prices. It lives in Store
 *      Settings; this page links to it.
 */

import { useEffect, useState, FormEvent } from 'react';
import { Plus, Trash2, Info, Percent } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { taxApi } from '../../api/tax';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { CardGridSkeleton } from '../../components/Skeleton';
import { TaxRate } from '../../types';

const emptyForm = {
  name: '',
  rate: '',
  country: '',
  state: '',
  appliesToShipping: false,
};

export default function AdminTax() {
  const pricesIncludeTax = useAppSelector(s => s.currentStore.current?.pricesIncludeTax) ?? false;

  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    try {
      const res = await taxApi.listRates();
      setRates(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();

    const rate = Number(form.rate);
    if (!form.name.trim() || !form.country.trim()) {
      toast.error('A tax rate needs a name and a country');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Rate must be between 0 and 100');
      return;
    }

    setSaving(true);
    try {
      await taxApi.createRate({
        name: form.name.trim(),
        rate,
        country: form.country.trim().toUpperCase(),
        state: form.state.trim() ? form.state.trim().toUpperCase() : null,
        appliesToShipping: form.appliesToShipping,
      });
      setForm(emptyForm);
      toast.success('Tax rate created');
      await load();
    } catch { /* axios interceptor surfaces the message */ } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rate: TaxRate) => {
    if (!window.confirm(`Delete "${rate.name}"?`)) return;
    try {
      await taxApi.deleteRate(rate._id);
      toast.success('Tax rate deleted');
      await load();
    } catch { /* interceptor */ }
  };

  const toggle = async (rate: TaxRate) => {
    try {
      await taxApi.updateRate(rate._id, { isActive: !rate.isActive });
      await load();
    } catch { /* interceptor */ }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl">
        <CardGridSkeleton count={3} lines={2} className="space-y-4" label="Loading tax settings…" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tax</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Rates are matched against the delivery address. With no rates configured, no tax is
          charged.
        </p>
      </header>

      {/* Pricing mode — the highest-consequence setting on this screen, so it is
          stated plainly rather than left for the merchant to infer. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-800/60">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        <div>
          <p className="font-medium text-gray-900 dark:text-white">
            Your prices are {pricesIncludeTax ? 'tax-inclusive' : 'tax-exclusive'}
          </p>
          <p className="mt-0.5 text-gray-600 dark:text-gray-400">
            {pricesIncludeTax
              ? 'Catalogue prices already contain tax. Customers pay the listed price and the invoice breaks out the tax component.'
              : 'Catalogue prices are before tax. Tax is added at checkout, so customers pay more than the listed price.'}
          </p>
          <Link to="/admin/settings" className="mt-1 inline-block text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
            Change in Store Settings →
          </Link>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-900/20">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <p className="text-amber-800 dark:text-amber-300">
          <strong className="font-semibold">Rates compound.</strong> Every active rate matching an
          address applies and they are added together. To make a state rate replace a country rate
          rather than stack on it, scope the country rate to the states it should cover.
        </p>
      </div>

      <section className="card p-5">
        {rates.length === 0 ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            No tax rates configured — no tax is being charged.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-gray-100 dark:divide-gray-800">
            {rates.map(rate => (
              <li key={rate._id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {rate.name}
                    <span className="ml-2 font-mono text-xs font-normal text-gray-400">
                      {rate.country === '*' ? 'Any country' : rate.country}
                      {rate.state ? ` / ${rate.state}` : ''}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {rate.rate}%
                    {rate.appliesToShipping ? ' · also taxes shipping' : ' · goods only'}
                  </p>
                </div>
                <button
                  onClick={() => toggle(rate)}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    rate.isActive
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {rate.isActive ? 'Active' : 'Inactive'}
                </button>
                <button
                  onClick={() => handleDelete(rate)}
                  className="text-gray-400 transition-colors hover:text-red-500"
                  aria-label={`Delete tax rate ${rate.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tax-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Name</label>
            <input
              id="tax-name" className="input" placeholder="e.g. VAT"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="tax-rate" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Rate (%)</label>
            <div className="relative">
              <input
                id="tax-rate" type="number" min="0" max="100" step="0.01" className="input pr-8"
                placeholder="20"
                value={form.rate}
                onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
              />
              <Percent className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            </div>
          </div>

          <div>
            <label htmlFor="tax-country" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Country (ISO-2, or * for any)
            </label>
            <input
              id="tax-country" className="input uppercase" placeholder="GB"
              maxLength={2}
              value={form.country}
              onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="tax-state" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              State / province (optional)
            </label>
            <input
              id="tax-state" className="input uppercase" placeholder="Leave blank for whole country"
              value={form.state}
              onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.appliesToShipping}
                onChange={e => setForm(f => ({ ...f, appliesToShipping: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              Also apply this rate to the shipping charge
              <span className="text-xs text-gray-400">
                (usual for EU VAT; often not for US sales tax)
              </span>
            </label>
          </div>

          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-1.5 px-4">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add tax rate
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
