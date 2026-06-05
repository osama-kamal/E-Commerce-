import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersApi } from '../api/orders';
import { Order } from '../types';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersApi.getMyOrders().then(res => setOrders(res.data.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">Loading…</div>;

  if (orders.length === 0) return (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center">
      <p className="text-5xl mb-4">📦</p>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">No orders yet</h2>
      <Link to="/" className="btn-primary inline-block mt-4">Start shopping</Link>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Orders</h1>
      <div className="space-y-4">
        {orders.map(order => (
          <Link key={order._id} to={`/orders/${order._id}`} className="card p-5 flex items-center justify-between hover:shadow-md transition-shadow block">
            <div>
              <p className="font-medium text-gray-900">Order #{order._id.slice(-8).toUpperCase()}</p>
              <p className="text-sm text-gray-500 mt-0.5">{new Date(order.createdAt).toLocaleDateString()} · {order.items.length} item{order.items.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[order.status]}`}>
                {order.status}
              </span>
              <span className="font-bold text-gray-900">${order.totalAmount.toFixed(2)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
