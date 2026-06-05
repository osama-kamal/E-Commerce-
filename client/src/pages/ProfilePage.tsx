import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ordersApi } from '../api/orders';
import { useAppSelector } from '../hooks/useAppDispatch';
import { Order } from '../types';

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  shipped:    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  delivered:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function OrderRow({ order, index }: { order: Order; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="card overflow-hidden"
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div>
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
              #{order._id.slice(-8).toUpperCase()}
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
              {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[order.status]}`}>
            {order.status}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-bold text-gray-900 dark:text-white">${order.totalAmount.toFixed(2)}</span>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-gray-400 text-sm"
          >
            ▼
          </motion.span>
        </div>
      </button>

      {/* Expandable items */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-500 shrink-0">
                      {item.quantity}×
                    </span>
                    <span className="text-gray-700 dark:text-gray-300 truncate">{item.name}</span>
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium shrink-0 ml-4">
                    ${(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="border-t border-gray-100 dark:border-gray-800 pt-2 flex justify-between text-sm font-semibold text-gray-900 dark:text-white">
                <span>Total</span>
                <span>${order.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    ordersApi.getMyOrders(page, 10)
      .then(res => {
        setOrders(res.data.data.data);
        setTotalPages(res.data.data.totalPages);
      })
      .finally(() => setLoading(false));
  }, [user, page, navigate]);

  if (!user) return null;

  // Derive initials for avatar placeholder
  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Profile card */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card p-6 flex items-center gap-5 mb-8"
      >
        {/* Avatar placeholder */}
        <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
          {initials}
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{user.email}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 capitalize mt-0.5">{user.role}</p>
          <p className="text-xs text-gray-400 mt-1">
            Member since {new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </p>
        </div>
      </motion.div>

      {/* Orders section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">My Orders</h2>
        {orders.length > 0 && (
          <span className="text-sm text-gray-400">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-4 shimmer h-16" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">📦</p>
          <p className="text-gray-500 dark:text-gray-400">No orders yet.</p>
          <button onClick={() => navigate('/')} className="btn-primary mt-4 px-6">Start Shopping</button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, i) => (
            <OrderRow key={order._id} order={order} index={i} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-4">←</button>
          <span className="flex items-center text-sm text-gray-600 dark:text-gray-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-4">→</button>
        </div>
      )}
    </div>
  );
}
