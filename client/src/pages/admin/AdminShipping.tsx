/**
 * AdminShipping — merchant configuration for delivery zones and rates.
 *
 * A ZONE is a set of destination countries; a RATE is a purchasable delivery
 * option within one. A customer's address resolves to exactly one zone and is
 * offered every active rate in it.
 *
 * Note what this screen deliberately does NOT do: compute prices. It edits the
 * rate definitions; the server derives what any given basket is charged. Doing
 * the arithmetic here as well would let the two drift, and only one of them is
 * authoritative.
 */

import { useEffect, useState, FormEvent } from 'react';
import { Plus, Trash2, Globe, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { shippingApi } from '../../api/shipping';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { formatCurrency } from '../../utils/format';
import { CardGridSkeleton } from '../../components/Skeleton';
import { ShippingZone, ShippingRate, ShippingRateType } from '../../types';

const RATE_TYPE_LABELS: Record<ShippingRateType, string> = {
  flat: 'Flat rate',
  free_over: 'Free over threshold',
  price_tier: 'Price tiers',
};

const emptyZone = { name: '', countries: '' };
const emptyRate = {
  zoneId: '',
  name: '',
  description: '',
  type: 'flat' as ShippingRateType,
  flatAmount: '0',
  freeOverThreshold: '',
};

export default function AdminShipping() {
  const currency = useAppSelector(s => s.currentStore.current?.currency) ?? 'USD';

  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [zoneForm, setZoneForm] = useState(emptyZone);
  const [rateForm, setRateForm] = useState(emptyRate);

  const load = async () => {
    try {
      const [zoneRes, rateRes] = await Promise.all([
        shippingApi.listZones(),
        shippingApi.listRates(),
      ]);
      setZones(zoneRes.data.data);
      setRates(rateRes.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Zones ──────────────────────────────────────────────────────────────────

  const handleCreateZone = async (e: FormEvent) => {
    e.preventDefault();
    const countries = zoneForm.countries
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    if (!zoneForm.name.trim() || countries.length === 0) {
      toast.error('A zone needs a name and at least one country');
      return;
    }

    setSaving(true);
    try {
      await shippingApi.createZone({ name: zoneForm.name.trim(), countries });
      setZoneForm(emptyZone);
      toast.success('Zone created');
      await load();
    } catch {
      // axios interceptor surfaces the message
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteZone = async (zone: ShippingZone) => {
    const owned = rates.filter(r => r.zoneId === zone._id).length;
    const warning = owned > 0
      ? `Delete "${zone.name}" and its ${owned} rate${owned === 1 ? '' : 's'}?`
      : `Delete "${zone.name}"?`;
    if (!window.confirm(warning)) return;

    try {
      await shippingApi.deleteZone(zone._id);
      toast.success('Zone deleted');
      await load();
    } catch { /* interceptor */ }
  };

  // ── Rates ──────────────────────────────────────────────────────────────────

  const handleCreateRate = async (e: FormEvent) => {
    e.preventDefault();
    if (!rateForm.zoneId || !rateForm.name.trim()) {
      toast.error('A rate needs a zone and a name');
      return;
    }

    setSaving(true);
    try {
      await shippingApi.createRate({
        zoneId: rateForm.zoneId,
        name: rateForm.name.trim(),
        description: rateForm.description.trim() || undefined,
        type: rateForm.type,
        flatAmount: Number(rateForm.flatAmount) || 0,
        freeOverThreshold:
          rateForm.type === 'free_over' && rateForm.freeOverThreshold !== ''
            ? Number(rateForm.freeOverThreshold)
            : null,
      });
      setRateForm({ ...emptyRate, zoneId: rateForm.zoneId });
      toast.success('Rate created');
      await load();
    } catch { /* interceptor */ } finally {
      setSaving(false);
    }
  };

  const handleDeleteRate = async (rate: ShippingRate) => {
    if (!window.confirm(`Delete "${rate.name}"?`)) return;
    try {
      await shippingApi.deleteRate(rate._id);
      toast.success('Rate deleted');
      await load();
    } catch { /* interceptor */ }
  };

  const toggleRate = async (rate: ShippingRate) => {
    try {
      await shippingApi.updateRate(rate._id, { isActive: !rate.isActive });
      await load();
    } catch { /* interceptor */ }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl">
        <CardGridSkeleton count={3} lines={3} className="space-y-4" label="Loading shipping settings…" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shipping</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Group destinations into zones, then offer delivery options in each. Customers see every
          active rate for the zone their address falls into.
        </p>
      </header>

      {/* ── Zones ─────────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Zones</h2>
        </div>

        {zones.length === 0 ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            No zones yet. Until you add one, no delivery options are offered and checkout will
            show no shipping methods.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-gray-100 dark:divide-gray-800">
            {zones.map(zone => (
              <li key={zone._id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{zone.name}</p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {zone.countries.includes('*')
                      ? 'Rest of world'
                      : zone.countries.join(', ')}
                  </p>
                </div>
                <span className="text-xs text-gray-400">
                  {rates.filter(r => r.zoneId === zone._id).length} rate(s)
                </span>
                <button
                  onClick={() => handleDeleteZone(zone)}
                  className="text-gray-400 transition-colors hover:text-red-500"
                  aria-label={`Delete zone ${zone.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreateZone} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
          <div>
            <label htmlFor="zone-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Zone name
            </label>
            <input
              id="zone-name" className="input" placeholder="e.g. United Kingdom"
              value={zoneForm.name}
              onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="zone-countries" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Countries (ISO-2, comma separated — use * for rest of world)
            </label>
            <input
              id="zone-countries" className="input" placeholder="GB, IE"
              value={zoneForm.countries}
              onChange={e => setZoneForm(f => ({ ...f, countries: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-1.5 px-4">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add
            </button>
          </div>
        </form>
      </section>

      {/* ── Rates ─────────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Truck className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Delivery rates</h2>
        </div>

        {rates.length === 0 ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">No rates yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-gray-100 dark:divide-gray-800">
            {rates.map(rate => {
              const zone = zones.find(z => z._id === rate.zoneId);
              return (
                <li key={rate._id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {rate.name}
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        {zone?.name ?? 'unknown zone'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {RATE_TYPE_LABELS[rate.type]}
                      {' · '}
                      {formatCurrency(rate.flatAmount, currency)}
                      {rate.type === 'free_over' && rate.freeOverThreshold != null && (
                        <> · free over {formatCurrency(rate.freeOverThreshold, currency)}</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleRate(rate)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                      rate.isActive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {rate.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => handleDeleteRate(rate)}
                    className="text-gray-400 transition-colors hover:text-red-500"
                    aria-label={`Delete rate ${rate.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleCreateRate} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rate-zone" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Zone</label>
            <select
              id="rate-zone" className="input"
              value={rateForm.zoneId}
              onChange={e => setRateForm(f => ({ ...f, zoneId: e.target.value }))}
            >
              <option value="">Select a zone…</option>
              {zones.map(z => <option key={z._id} value={z._id}>{z.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="rate-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Rate name</label>
            <input
              id="rate-name" className="input" placeholder="e.g. Standard (3–5 days)"
              value={rateForm.name}
              onChange={e => setRateForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="rate-type" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Type</label>
            <select
              id="rate-type" className="input"
              value={rateForm.type}
              onChange={e => setRateForm(f => ({ ...f, type: e.target.value as ShippingRateType }))}
            >
              {(Object.keys(RATE_TYPE_LABELS) as ShippingRateType[]).map(t => (
                <option key={t} value={t}>{RATE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rate-amount" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Price ({currency})
            </label>
            <input
              id="rate-amount" type="number" min="0" step="0.01" className="input"
              value={rateForm.flatAmount}
              onChange={e => setRateForm(f => ({ ...f, flatAmount: e.target.value }))}
            />
          </div>

          {rateForm.type === 'free_over' && (
            <div>
              <label htmlFor="rate-threshold" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Free when order is at least ({currency})
              </label>
              <input
                id="rate-threshold" type="number" min="0" step="0.01" className="input"
                placeholder="e.g. 50"
                value={rateForm.freeOverThreshold}
                onChange={e => setRateForm(f => ({ ...f, freeOverThreshold: e.target.value }))}
              />
              <p className="mt-1 text-xs text-gray-400">
                Compared against the discounted subtotal, so a coupon can carry an order over the
                threshold.
              </p>
            </div>
          )}

          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-1.5 px-4">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add rate
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
