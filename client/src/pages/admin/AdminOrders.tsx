import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ordersApi } from '../../api/orders';
import { Order, OrderStatus } from '../../types';
import toast from 'react-hot-toast';

const STATUSES: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  shipped: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function PaymentBadge({ method }: { method?: string }) {
  if (method === 'cod') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        💵 COD
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
      💳 Online
    </span>
  );
}

function OrderDetailsModal({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Order Details</h2>
            <p className="text-sm text-gray-500 font-mono">#{order._id.slice(-8).toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full capitalize font-medium ${STATUS_COLORS[order.status]}`}>
              {order.status}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Order Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 dark:text-gray-400">Date</p>
              <p className="font-medium text-gray-900 dark:text-white">{new Date(order.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Total Amount</p>
              <p className="font-bold text-lg text-gray-900 dark:text-white">${order.totalAmount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Payment Method</p>
              <PaymentBadge method={order.paymentMethod} />
            </div>
            {order.couponCode && (
              <div>
                <p className="text-gray-500 dark:text-gray-400">Coupon Used</p>
                <p className="font-medium text-green-600">{order.couponCode} (-${order.discountAmount?.toFixed(2)})</p>
              </div>
            )}
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Products Ordered</h3>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white text-sm">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      ${item.price.toFixed(2)} × {item.quantity}
                      {item.selectedSize && <span className="ml-2 text-primary-600 dark:text-primary-400 font-medium">Size: {item.selectedSize}</span>}
                    </p>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Shipping Address */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Shipping Address</h3>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300">
              <p>{order.shippingAddress.line1}</p>
              <p>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
              <p>{order.shippingAddress.country}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filterStatus) params.status = filterStatus;
      const res = await ordersApi.getAll(params);
      setOrders(res.data.data.data);
      setTotalPages(res.data.data.totalPages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [page, filterStatus]);

  const handleStatusUpdate = async (orderId: string, status: string) => {
    setUpdatingId(orderId);
    try {
      await ordersApi.updateStatus(orderId, status);
      fetchOrders();
    } finally {
      setUpdatingId('');
    }
  };

  // Bulk helpers
  const allSelected = orders.length > 0 && orders.every(o => selected.has(o._id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(orders.map(o => o._id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus) { toast.error('Select a status first'); return; }
    if (!confirm(`Update ${selected.size} orders to "${bulkStatus}"?`)) return;
    setBulkLoading(true);
    try {
      const res = await ordersApi.bulkUpdateStatus(Array.from(selected), bulkStatus);
      toast.success((res.data as any).data?.message || `${selected.size} orders updated`);
      setSelected(new Set());
      setBulkStatus('');
      fetchOrders();
    } catch {
      // interceptor handles toast
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} orders permanently? This cannot be undone.`)) return;
    setBulkLoading(true);
    try {
      const res = await ordersApi.bulkDelete(Array.from(selected));
      toast.success((res.data as any).data?.message || `${selected.size} orders deleted`);
      setSelected(new Set());
      fetchOrders();
    } catch {
      // interceptor handles toast
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Orders</h1>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="input w-40"
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
      </div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {someSelected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl flex flex-wrap items-center gap-3"
          >
            <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
              {selected.size} order{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value)}
                className="input py-1.5 text-sm w-36"
              >
                <option value="">Set status…</option>
                {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
              <button
                onClick={handleBulkStatusUpdate}
                disabled={bulkLoading || !bulkStatus}
                className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
              >
                {bulkLoading ? '⏳ Updating...' : '✅ Apply'}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkLoading}
                className="bg-red-500 hover:bg-red-600 text-white text-sm py-1.5 px-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {bulkLoading ? '⏳...' : '🗑️ Delete'}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                ✕ Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                </th>
                {['Order ID', 'Date', 'Items', 'Total', 'Payment', 'Status', 'Update Status', 'Details'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 dark:text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b dark:border-gray-800 animate-pulse">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : orders.map(order => (
                <tr
                  key={order._id}
                  className={`border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${selected.has(order._id) ? 'bg-primary-50 dark:bg-primary-900/10' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(order._id)} onChange={() => toggleOne(order._id)} className="rounded" />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">#{order._id.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{new Date(order.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">${order.totalAmount.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <PaymentBadge method={order.paymentMethod} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[order.status]}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={order.status}
                      onChange={e => handleStatusUpdate(order._id, e.target.value)}
                      disabled={updatingId === order._id || order.status === 'delivered' || order.status === 'cancelled'}
                      className="input py-1 text-xs w-36"
                    >
                      {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedOrder(order)}
                      className="text-primary-600 hover:underline text-xs font-medium"
                    >
                      👁️ View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 border-t dark:border-gray-800">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-3 py-1 text-sm">←</button>
            <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-3 py-1 text-sm">→</button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
