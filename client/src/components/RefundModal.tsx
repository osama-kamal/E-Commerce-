/**
 * RefundModal — issue a refund against an order.
 *
 * ── Design constraint ─────────────────────────────────────────────────────────
 * This component performs NO money arithmetic. It collects an intent (which
 * items, how many, whether shipping and restocking are included) and asks the
 * server what that is worth. Every figure on screen came from `previewRefund`,
 * which is the same engine `createRefund` charges with — so what the merchant
 * approves is exactly what moves.
 *
 * Proration of discount and tax across lines is subtle enough that a second
 * implementation here would drift from the server's within a release, and the
 * drift would be in money.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { refundsApi, RefundRequest } from '../api/refunds';
import { formatCurrency } from '../utils/format';
import { Order, RefundPreview } from '../types';

interface Props {
  order: Order;
  onClose: () => void;
  /** Called after a successful refund so the caller can refresh its list. */
  onRefunded: () => void;
}

/**
 * Rendered conditionally by the parent (the shared Modal has no `isOpen`
 * prop), so mounting IS opening — state starts fresh every time.
 */
export default function RefundModal({ order, onClose, onRefunded }: Props) {
  const currency = order.currency ?? 'USD';

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [refundShipping, setRefundShipping] = useState(false);
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Stable per-open, so double-clicking "Refund" cannot issue two refunds.
   * Regenerated each time the modal opens — a deliberate second refund of the
   * same items is legitimate and must not be swallowed as a replay.
   */
  const [idempotencyKey] = useState(
    () => `refund_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([productId, quantity]) => ({ productId, quantity })),
    [quantities]
  );

  const hasSelection = lines.length > 0 || refundShipping;

  // Re-price on every change. Cheap, and it keeps the displayed total honest
  // rather than letting it lag behind the selection.
  useEffect(() => {
    if (!hasSelection) { setPreview(null); setPreviewError(null); return; }

    let cancelled = false;
    setLoading(true);

    refundsApi
      .preview(order._id, { lines, refundShipping })
      .then(res => { if (!cancelled) { setPreview(res.data.data); setPreviewError(null); } })
      .catch(err => {
        if (cancelled) return;
        setPreview(null);
        // Surfaced inline rather than as a toast: it is a correction to the
        // current selection, not a transient failure.
        setPreviewError(err?.response?.data?.message ?? 'Could not price this refund');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [order._id, lines, refundShipping, hasSelection]);

  const setQty = (productId: string, qty: number, max: number) => {
    setQuantities(prev => ({ ...prev, [productId]: Math.max(0, Math.min(qty, max)) }));
  };

  const selectAll = () => {
    setQuantities(Object.fromEntries(order.items.map(i => [i.productId, i.quantity])));
  };

  const handleSubmit = async () => {
    if (!preview || submitting) return;
    setSubmitting(true);
    try {
      const request: RefundRequest = {
        lines,
        refundShipping,
        restock,
        reason: reason.trim() || undefined,
        idempotencyKey,
      };
      await refundsApi.create(order._id, request);
      toast.success(`Refunded ${formatCurrency(preview.totalRefunded, currency)}`);
      onRefunded();
      onClose();
    } catch {
      // The axios interceptor surfaces the message. The modal stays open so the
      // merchant can adjust rather than losing their selection.
    } finally {
      setSubmitting(false);
    }
  };

  const alreadyRefunded = order.refundedTotal ?? 0;

  return (
    <Modal onClose={onClose} labelledBy="refund-modal-title" panelClassName="w-full max-w-lg">
      <div className="space-y-5 p-6">
        <h2 id="refund-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
          Refund order
        </h2>
        <div className="rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800/60">
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Order total</span>
            <span>{formatCurrency(order.totalAmount, currency)}</span>
          </div>
          {alreadyRefunded > 0 && (
            <div className="flex justify-between text-amber-700 dark:text-amber-400">
              <span>Already refunded</span>
              <span>−{formatCurrency(alreadyRefunded, currency)}</span>
            </div>
          )}
        </div>

        {/* ── Items ─────────────────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Items to refund</p>
            <button
              type="button"
              onClick={selectAll}
              className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              Select all
            </button>
          </div>

          <ul className="space-y-2">
            {order.items.map(item => (
              <li
                key={`${item.productId}-${item.selectedSize ?? ''}`}
                className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {item.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatCurrency(item.price, currency)} · {item.quantity} ordered
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={item.quantity}
                  value={quantities[item.productId] ?? 0}
                  onChange={e => setQty(item.productId, Number(e.target.value), item.quantity)}
                  aria-label={`Quantity to refund for ${item.name}`}
                  className="input w-20 text-center"
                />
              </li>
            ))}
          </ul>
        </div>

        {/* ── Options ───────────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          {(order.shippingTotal ?? 0) > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={refundShipping}
                onChange={e => setRefundShipping(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                Also refund shipping ({formatCurrency(order.shippingTotal ?? 0, currency)})
                <span className="mt-0.5 block text-xs text-gray-400">
                  Off by default — you paid the carrier whether or not the goods came back.
                </span>
              </span>
            </label>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={restock}
              onChange={e => setRestock(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>
              Return these items to inventory
              <span className="mt-0.5 block text-xs text-gray-400">
                Uncheck if the goods came back damaged or were never returned.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="refund-reason" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Reason (optional)
            </label>
            <input
              id="refund-reason"
              className="input"
              placeholder="e.g. Item arrived damaged"
              value={reason}
              maxLength={200}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>

        {/* ── Server-computed breakdown ─────────────────────────────────── */}
        {previewError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {previewError}
          </div>
        )}

        {loading && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Calculating…
          </p>
        )}

        {preview && !loading && (
          <div className="space-y-1 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Items</span><span>{formatCurrency(preview.subtotalRefunded, currency)}</span>
            </div>
            {preview.shippingRefunded > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Shipping</span><span>{formatCurrency(preview.shippingRefunded, currency)}</span>
              </div>
            )}
            {/* Inclusive tax is already inside the item value — shown as a note
                rather than a line, exactly as on the original invoice. */}
            {!preview.taxInclusive && preview.taxRefunded > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Tax</span><span>{formatCurrency(preview.taxRefunded, currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 font-bold text-gray-900 dark:border-gray-700 dark:text-white">
              <span>Refund total</span>
              <span>{formatCurrency(preview.totalRefunded, currency)}</span>
            </div>
            {preview.taxInclusive && preview.taxRefunded > 0 && (
              <p className="text-xs text-gray-400">
                Includes {formatCurrency(preview.taxRefunded, currency)} tax
              </p>
            )}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!preview || loading || submitting}
            className="btn-primary flex-1 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Refunding…
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {preview ? `Refund ${formatCurrency(preview.totalRefunded, currency)}` : 'Refund'}
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-gray-400">
          This returns money to the customer through the original payment method and cannot be
          undone from here.
        </p>
      </div>
    </Modal>
  );
}
