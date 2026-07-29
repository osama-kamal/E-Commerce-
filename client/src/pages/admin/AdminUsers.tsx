import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import { TableRowsSkeleton } from '../../components/Skeleton';
import { User } from '../../types';

type UserRole = 'admin' | 'customer';
type RoleFilter = UserRole | 'all';

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [togglingId, setTogglingId] = useState('');
  const [updatingRoleId, setUpdatingRoleId] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await adminApi.listUsers(
        page,
        20,
        roleFilter === 'all' ? undefined : roleFilter
      );
      setUsers(res.data.data.data);
      setTotal(res.data.data.total);
      setTotalPages(res.data.data.totalPages);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch whenever page or role filter changes
  useEffect(() => { fetchUsers(); }, [page, roleFilter]);

  // Reset to page 1 when the filter changes
  const handleRoleFilterChange = (value: RoleFilter) => {
    setRoleFilter(value);
    setPage(1);
  };

  const handleToggle = async (user: User) => {
    setTogglingId(user._id);
    try {
      await adminApi.toggleUserStatus(user._id, !user.isActive);
      fetchUsers();
    } finally {
      setTogglingId('');
    }
  };

  const handleRoleChange = async (user: User, newRole: UserRole) => {
    if (newRole === user.role) return;
    setUpdatingRoleId(user._id);
    try {
      await adminApi.updateUserRole(user._id, newRole);
      // Optimistic update — reflect the change immediately without a refetch
      setUsers(prev =>
        prev.map(u => (u._id === user._id ? { ...u, role: newRole } : u))
      );
    } finally {
      setUpdatingRoleId('');
    }
  };

  return (
    <div className="p-6">
      {/* Header + filter bar */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">{total} user{total !== 1 ? 's' : ''} found</p>
          )}
        </div>

        {/* Role filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="role-filter" className="text-sm text-gray-600 font-medium">
            Show:
          </label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={e => handleRoleFilterChange(e.target.value as RoleFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="all">All users</option>
            <option value="customer">Customers only</option>
            <option value="admin">Admins only</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Email', 'Role', 'Joined', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsSkeleton rows={5} columns={5} />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                    No users found
                    {roleFilter !== 'all' && (
                      <span> with role <strong>{roleFilter}</strong></span>
                    )}
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user._id} className="border-b hover:bg-gray-50">
                    {/* Email */}
                    <td className="px-4 py-3 text-gray-900">{user.email}</td>

                    {/* Role — inline dropdown */}
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        disabled={updatingRoleId === user._id}
                        onChange={e => handleRoleChange(user, e.target.value as UserRole)}
                        aria-label={`Change role for ${user.email}`}
                        className={`
                          text-xs px-2 py-1 rounded-full border font-medium capitalize cursor-pointer
                          focus:outline-none focus:ring-2 focus:ring-indigo-400
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700 border-purple-200'
                            : 'bg-gray-100 text-gray-700 border-gray-200'}
                        `}
                      >
                        <option value="customer">customer</option>
                        <option value="admin">admin</option>
                      </select>
                      {updatingRoleId === user._id && (
                        <span className="ml-2 text-xs text-gray-400">saving…</span>
                      )}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          user.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Activate / Deactivate */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(user)}
                        disabled={togglingId === user._id}
                        className={`text-xs font-medium hover:underline disabled:opacity-50 ${
                          user.isActive ? 'text-red-500' : 'text-green-600'
                        }`}
                      >
                        {togglingId === user._id
                          ? 'Saving…'
                          : user.isActive
                          ? 'Deactivate'
                          : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 p-4 border-t">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary px-3 py-1 text-sm"
            >
              ←
            </button>
            <span className="text-sm text-gray-600 flex items-center">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary px-3 py-1 text-sm"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
