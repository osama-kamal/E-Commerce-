/**
 * StorefrontOrdersPage  (/s/:slug/orders)
 *
 * Order history for a storefront customer. Fetches orders via sfApi so the
 * X-Store-Slug header is present on all requests.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { Order } from '../../types';

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

  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/s/${slug}/orders`, { replace: true });
      return;
    }
    sfApi.get<{ data: Order[] }>('/orders')
      .then(res => setOrders(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated, navigate, sfApi, slug]);

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
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-24 card">
          <p className="text-5xl mb-4">📦</p>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">No orders yet</h2>
          <p className="text-sm text-gray-400 mb-6">Your order history will appear here.</p>
          <Link to={`/s/${slug}`} className="btn-primary px-8">Start Shopping</Link>
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
