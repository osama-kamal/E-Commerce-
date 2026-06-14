import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ordersApi } from '../api/orders';
import { Order, OrderStatus } from '../types';

// ── Tracking timeline config ──────────────────────────────────────────────────

const TIMELINE_STEPS: { status: OrderStatus; label: string; icon: string; description: string }[] = [
  { status: 'pending',    label: 'Order Placed',   icon: '📋', description: 'Your order has been received and is awaiting payment confirmation.' },
  { status: 'processing', label: 'Processing',     icon: '⚙️', description: 'Payment confirmed. We are preparing your items for shipment.' },
  { status: 'shipped',    label: 'Shipped',        icon: '🚚', description: 'Your order is on its way! Track your package with the carrier.' },
  { status: 'delivered',  label: 'Delivered',      icon: '✅', description: 'Your order has been delivered. Enjoy your purchase!' },
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
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <span className="text-2xl">❌</span>
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
                <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 border-2 transition-all ${
                  isDone    ? 'bg-primary-600 border-primary-600 text-white' :
                  isCurrent ? 'bg-white dark:bg-gray-900 border-primary-600 shadow-md shadow-primary-100' :
                              'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                }`}>
                  {isDone ? (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                    >
                      ✓
                    </motion.span>
                  ) : (
                    <span className={isPending ? 'opacity-40' : ''}>{step.icon}</span>
                  )}
                  {/* Pulse ring for current step */}
                  {isCurrent && (
                    <span className="absolute inset-0 rounded-full border-2 border-primary-400 animate-ping opacity-30" />
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

  useEffect(() => {
    if (!id) return;
    ordersApi.getById(id).then(res => setOrder(res.data.data)).finally(() => setLoading(false));
  }, [id]);

  const handleCancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      const res = await ordersApi.cancel(id);
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
    <div className="text-center py-20 text-gray-400">
      <p className="text-4xl mb-3">📦</p>
      <p>Order not found</p>
      <Link to="/orders" className="btn-primary inline-block mt-4">Back to Orders</Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Success banner */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-400 p-4 rounded-xl mb-6 text-sm flex items-center gap-2"
        >
          🎉 Payment successful! Your order is being processed.
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
                ${(item.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}

          {order.discountAmount && order.discountAmount > 0 && (
            <div className="flex justify-between text-sm text-green-600 dark:text-green-400 pt-1">
              <span>Coupon {order.couponCode ? `(${order.couponCode})` : 'discount'}</span>
              <span>−${order.discountAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t dark:border-gray-700 pt-3 flex justify-between font-bold text-gray-900 dark:text-white">
            <span>Total</span>
            <span>${order.totalAmount.toFixed(2)}</span>
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
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xl">💵</span>
            <div>
              <p className="font-semibold text-amber-700 dark:text-amber-400">Cash on Delivery</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs">Payment will be collected at your door upon delivery.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xl">💳</span>
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
