import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Banknote, CheckCircle2, ClipboardList, CreditCard, type LucideIcon, Package,
  Settings, Truck, XCircle,
} from 'lucide-react';
import { createOrdersApi } from '../api/orders';
import { useTenant } from '../hooks/useTenant';
import { formatCurrency } from '../utils/format';
import { Order, OrderStatus } from '../types';

// ── Tracking timeline config ──────────────────────────────────────────────────
// `icon` is a component now. As emoji these four steps rendered at four different
// optical weights, so the timeline rail never looked evenly spaced.
const TIMELINE_STEPS: { status: OrderStatus; label: string; icon: LucideIcon; description: string }[] = [
  { status: 'pending',    label: 'Order Placed',   icon: ClipboardList, description: 'Your order has been received and is awaiting payment confirmation.' },
  { status: 'processing', label: 'Processing',     icon: Settings,      description: 'Payment confirmed. We are preparing your items for shipment.' },
  { status: 'shipped',    label: 'Shipped',        icon: Truck,         description: 'Your order is on its way! Track your package with the carrier.' },
  { status: 'delivered',  label: 'Delivered',      icon: CheckCircle2,  description: 'Your order has been delivered. Enjoy your purchase!' },
];

const STATUS_ORDER: Record<OrderStatus, number> = {
  pending:    0,
  processing: 1,
  shipped:    2,
  delivered:  3,
  cancelled:  -1,
};

function OrderTimeline({ status }: { status: OrderStatus }) {
  const currentIndex = STATUS_ORDER[status];
  const isCancelled = status === 'cancelled';

  if (isCancelled) {
    return (
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Order Status</h2>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <XCircle className="h-6 w-6 shrink-0 text-red-500" aria-hidden="true" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-400">Order Cancelled</p>
            <p className="text-sm text-red-600 dark:text-red-500">This order has been cancelled.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 mb-4">
      <h2 className="font-semibold text-gray-900 dark:text-white mb-6">Order Tracking</h2>

      <div className="relative">
        {/* Connecting line */}
        <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-200 dark:bg-gray-700" />
        {/* Filled progress line */}
        <motion.div
          className="absolute left-5 top-5 w-0.5 bg-primary-600 origin-top"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: currentIndex > 0 ? Math.min(currentIndex / (TIMELINE_STEPS.length - 1), 1) : 0 }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          style={{ height: `calc(100% - 2.5rem)` }}
        />

        <div className="space-y-6">
          {TIMELINE_STEPS.map((step, i) => {
            const isDone    = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isPending = i > currentIndex;

            return (
              <motion.div
                key={step.status}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.1 }}
                className="flex items-start gap-4 relative"
              >
                {/* Step circle */}
                {/* Completed steps go near-black rather than blue: the timeline
                    sat next to amber order totals and the blue read as a third
                    accent. Done/current/pending now differ by weight, not hue. */}
                <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
                  isDone    ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' :
                  isCurrent ? 'border-gray-900 bg-white text-gray-900 shadow-elevated dark:border-white dark:bg-gray-900 dark:text-white' :
                              'border-gray-200 bg-white text-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-600'
                }`}>
                  {isDone ? (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      className="inline-flex"
                    >
                      <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden="true" />
                    </motion.span>
                  ) : (
                    <step.icon className={`h-[18px] w-[18px] ${isPending ? 'opacity-50' : ''}`} aria-hidden="true" />
                  )}
                  {/* Pulse ring for current step */}
                  {isCurrent && (
                    <span className="absolute inset-0 animate-ping rounded-full border border-gray-400 opacity-30" />
                  )}
                </div>

                {/* Step content */}
                <div className={`pt-1.5 ${isPending ? 'opacity-40' : ''}`}>
                  <p className={`font-semibold text-sm ${
                    isCurrent ? 'text-primary-600 dark:text-primary-400' :
                    isDone    ? 'text-gray-900 dark:text-white' :
                                'text-gray-400 dark:text-gray-500'
                  }`}>
                    {step.label}
                    {isCurrent && (
                      <span className="ml-2 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-2 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                  </p>
                  {(isDone || isCurrent) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-xs">
                      {step.description}
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const success = searchParams.get('success');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Read from the ORDER, not the active store: currency is snapshotted at
  // purchase so a store that later switches currency cannot retroactively
  // reinterpret historical invoices.
  const currency = order?.currency ?? 'USD';

  // This page is routed both on the main site and under /s/:slug, so the
  // lookup must run against whichever tenant owns the order being viewed.
  const tenant = useTenant();
  const orders = useMemo(() => createOrdersApi(tenant.api), [tenant.api]);

  useEffect(() => {
    if (!id) return;
    orders.getById(id).then(res => setOrder(res.data.data)).finally(() => setLoading(false));
  }, [id]);

  const handleCancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      const res = await orders.cancel(id);
      setOrder(res.data.data);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    </div>
  );

  if (!order) return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
        <Package className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Order not found</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        This order may have been removed, or the link is incorrect.
      </p>
      <Link to="/orders" className="btn btn-brand btn-lg inline-flex">Back to Orders</Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Success banner */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Payment successful! Your order is being processed.
        </motion.div>
      )}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Order #{order._id.slice(-8).toUpperCase()}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Placed on {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Link to="/orders" className="text-sm text-primary-600 hover:underline">← All Orders</Link>
      </motion.div>

      {/* Tracking timeline */}
      <OrderTimeline status={order.status} />

      {/* Items */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Items</h2>
        <div className="space-y-3">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-500 shrink-0">
                  {item.quantity}×
                </span>
                <div>
                  <span className="text-gray-700 dark:text-gray-300">{item.name}</span>
                  {item.selectedSize && (
                    <span className="ml-2 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded">
                      Size: {item.selectedSize}
                    </span>
                  )}
                </div>
              </div>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatCurrency(item.price * item.quantity, currency)}
              </span>
            </div>
          ))}

          {/* Full money breakdown. Every figure is stored on the order, so an
              invoice reprinted years later shows what was actually charged even
              if the merchant has since changed rates. Legacy orders predate
              these fields — `?? 0` keeps them rendering as they always did. */}
          <div className="border-t dark:border-gray-700 pt-3 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(order.subtotal ?? order.totalAmount, currency)}</span>
            </div>

            {order.discountAmount != null && order.discountAmount > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Coupon {order.couponCode ? `(${order.couponCode})` : 'discount'}</span>
                <span>−{formatCurrency(order.discountAmount, currency)}</span>
              </div>
            )}

            {order.shippingTotal != null && (
              <div className="flex justify-between">
                <span>
                  Shipping{order.shippingMethod ? ` · ${order.shippingMethod.name}` : ''}
                </span>
                <span>
                  {order.shippingTotal === 0 ? 'Free' : formatCurrency(order.shippingTotal, currency)}
                </span>
              </div>
            )}

            {/* Added lines only. An inclusive amount is already inside the
                total and is annotated below instead — listing it here would
                imply it was added on top. */}
            {(order.taxLines ?? [])
              .filter(line => !line.inclusive)
              .map(line => (
                <div key={line.name} className="flex justify-between">
                  <span>{line.name} ({line.rate}%)</span>
                  <span>{formatCurrency(line.amount, currency)}</span>
                </div>
              ))}

            <div className="flex justify-between border-t pt-2 font-bold text-gray-900 dark:border-gray-700 dark:text-white">
              <span>Total</span>
              <span>{formatCurrency(order.totalAmount, currency)}</span>
            </div>

            {(order.taxLines ?? []).some(l => l.inclusive) && order.taxTotal != null && (
              <p className="text-xs text-gray-400">
                Includes {formatCurrency(order.taxTotal, currency)}{' '}
                {(order.taxLines ?? []).map(l => l.name).join(' + ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Shipping address */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-2">Shipping Address</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {order.shippingAddress.line1}<br />
          {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />
          {order.shippingAddress.country}
        </p>
      </div>

      {/* Payment method */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-2">Payment Method</h2>
        {order.paymentMethod === 'cod' ? (
          <div className="flex items-center gap-2.5 text-sm">
            <Banknote className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Cash on Delivery</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs">Payment will be collected at your door upon delivery.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-sm">
            <CreditCard className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            <div>
              <p className="font-semibold text-blue-700 dark:text-blue-400">Online Payment</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs">Payment processed securely via Stripe.</p>
            </div>
          </div>
        )}
      </div>

      {/* Cancel button */}
      {order.status === 'pending' && (
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          {cancelling ? 'Cancelling…' : 'Cancel Order'}
        </button>
      )}
    </div>
  );
}
