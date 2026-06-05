import { useEffect, useState } from 'react';
import { newsletterApi } from '../../api/newsletter';
import toast from 'react-hot-toast';

interface Subscriber {
  _id: string;
  email: string;
  isActive: boolean;
  subscribedAt: string;
  unsubscribedAt?: string;
}

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

export default function AdminNewsletter() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // Send newsletter form
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);

  useEffect(() => {
    fetchData();
  }, [showInactive]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [subscribersRes, statsRes] = await Promise.all([
        newsletterApi.getSubscribers(!showInactive),
        newsletterApi.getStats(),
      ]);
      setSubscribers(subscribersRes.data.data);
      setStats(statsRes.data.data);
    } catch {
      toast.error('Failed to load newsletter data');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error('Please fill in both subject and message');
      return;
    }
    setSending(true);
    try {
      const res = await newsletterApi.sendNewsletter(subject.trim(), message.trim());
      const { sent, failed } = res.data.data;
      toast.success(`✅ Sent to ${sent} subscriber${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);
      setSubject('');
      setMessage('');
      setShowSendForm(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to send newsletter');
    } finally {
      setSending(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">📧 Newsletter Subscribers</h1>
          <p className="text-gray-600">Manage your newsletter subscribers</p>
        </div>
        <button
          onClick={() => setShowSendForm(v => !v)}
          className="btn-primary flex items-center gap-2"
        >
          <span>✉️</span>
          {showSendForm ? 'Cancel' : 'Send Newsletter'}
        </button>
      </div>

      {/* Send Newsletter Form */}
      {showSendForm && (
        <div className="card p-6 mb-6 border-2 border-blue-200 bg-blue-50">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span>✉️</span> Send to {stats.active} Active Subscriber{stats.active !== 1 ? 's' : ''}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Special Offer This Week!"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Write your newsletter message here..."
                rows={6}
                className="input w-full resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSendForm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || stats.active === 0}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {sending ? (
                  <><span className="inline-block animate-spin">⏳</span> Sending...</>
                ) : (
                  <><span>🚀</span> Send to {stats.active} Subscriber{stats.active !== 1 ? 's' : ''}</>
                )}
              </button>
            </div>
            {stats.active === 0 && (
              <p className="text-sm text-red-500">No active subscribers to send to.</p>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-4 bg-gradient-to-br from-blue-50 to-blue-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Subscribers</p>
              <p className="text-3xl font-bold text-blue-600">{stats.total}</p>
            </div>
            <div className="text-4xl">📊</div>
          </div>
        </div>
        <div className="card p-4 bg-gradient-to-br from-green-50 to-green-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Active Subscribers</p>
              <p className="text-3xl font-bold text-green-600">{stats.active}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>
        <div className="card p-4 bg-gradient-to-br from-red-50 to-red-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Unsubscribed</p>
              <p className="text-3xl font-bold text-red-600">{stats.inactive}</p>
            </div>
            <div className="text-4xl">❌</div>
          </div>
        </div>
      </div>

      {/* Filter Toggle */}
      <div className="card p-4 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-gray-700">Show unsubscribed users</span>
        </label>
      </div>

      {/* Subscribers Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-2 text-gray-600">Loading subscribers...</p>
          </div>
        ) : subscribers.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-5xl mb-4">📭</p>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">No subscribers yet</h3>
            <p className="text-sm text-gray-500">
              {showInactive ? 'No unsubscribed users found' : 'Start collecting email subscribers!'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subscribed At</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unsubscribed At</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {subscribers.map((subscriber) => (
                  <tr key={subscriber._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <span className="text-2xl mr-2">📧</span>
                        <span className="text-sm font-medium text-gray-900">{subscriber.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {subscriber.isActive ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✅ Active</span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">❌ Unsubscribed</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(subscriber.subscribedAt)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {subscriber.unsubscribedAt ? formatDate(subscriber.unsubscribedAt) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Export Button */}
      {subscribers.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => {
              const csv = [
                ['Email', 'Status', 'Subscribed At', 'Unsubscribed At'],
                ...subscribers.map(s => [
                  s.email,
                  s.isActive ? 'Active' : 'Unsubscribed',
                  formatDate(s.subscribedAt),
                  s.unsubscribedAt ? formatDate(s.unsubscribedAt) : '-',
                ]),
              ].map(row => row.join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `newsletter-subscribers-${new Date().toISOString().split('T')[0]}.csv`;
              a.click();
              toast.success('CSV exported successfully!');
            }}
            className="btn-primary"
          >
            📥 Export to CSV
          </button>
        </div>
      )}
    </div>
  );
}
