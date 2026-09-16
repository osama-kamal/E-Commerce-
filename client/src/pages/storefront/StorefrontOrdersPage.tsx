/**
 * StorefrontOrdersPage  (/s/:slug/orders)
 *
 * Order history for a storefront customer. Fetches orders via sfApi so the
 * X-Store-Slug header is present on all requests.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Package } from 'lucide-react';
import { CardGridSkeleton } from '../../components/Skeleton';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { Order, PaginatedResponse } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  shipped:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  delivered:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function StorefrontOrdersPage() {
  const { slug, sfApi } = useStorefront();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry. The effect's other deps do not change on a retry, so
  // without this the button would clear the error and then never refetch.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/s/${slug}/orders`, { replace: true });
      return;
    }

    setError(null);

    /**
     * GET /orders is PAGINATED, so the payload is
     * `{ data: { data: Order[], total, page, totalPages } }` — two levels, not
     * one. This read `res.data.data` and handed the wrapper object to
     * `setOrders`, which made `orders.length === 0` false (it is `undefined`)
     * and sent an object into `orders.map()`. The TypeError unmounted the tree,
     * so the page rendered blank rather than showing an order or an empty
     * state. The main-site OrdersPage always unwrapped both levels; only this
     * copy was short. Typing the response as PaginatedResponse<Order> is what
     * stops it coming back — the wrong depth is now a compile error.
     */
    sfApi.get<{ data: PaginatedResponse<Order> }>('/orders')
      .then(res => setOrders(res.data.data.data))
      // A blanket swallow is why this failure was invisible: a 401, a 500 and
      // "you have never ordered" all rendered the same empty state.
      .catch(err => {
        setError(err?.response?.data?.message ?? 'Could not load your orders.');
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, navigate, sfApi, slug, reloadNonce]);

  if (!isAuthenticated) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/s/${slug}`} className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600">
          ← Back to store
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Orders</h1>
      </div>

      {loading ? (
        <CardGridSkeleton count={4} lines={2} className="space-y-4" label="Loading your orders…" />
      ) : error ? (
        <div className="surface py-24 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <AlertTriangle className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Could not load your orders
          </h2>
          <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {error}
          </p>
          <button
            onClick={() => { setLoading(true); setReloadNonce(n => n + 1); }}
            className="btn-secondary px-6"
          >
            Retry
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="surface py-24 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <Package className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">No orders yet</h2>
          <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Your order history will appear here once you place your first order.
          </p>
          <Link to={`/s/${slug}`} className="btn btn-brand btn-lg inline-flex">Start Shopping</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map(order => (
            <div key={order._id} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-xs text-gray-400 font-mono">#{order._id.slice(-8).toUpperCase()}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {order.status}
                </span>
              </div>

              <div className="space-y-1.5 mb-3">
                {order.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[60%]">
                      {item.name} × {item.quantity}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  Total: ${order.totalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
