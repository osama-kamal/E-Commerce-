import { useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/auth';
import { storeSlugFromRedirect, withRedirect } from '../utils/storeRedirect';

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // The reset is issued for ONE store's account (an address may hold several).
  // The store rides in ?redirect=/s/:slug from the storefront; without it the
  // server cannot resolve which account to reset. See utils/storeRedirect.
  const redirect = searchParams.get('redirect') ?? '';
  const storeSlug = storeSlugFromRedirect(redirect);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email, storeSlug ?? undefined);
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset password</h1>
        {sent ? (
          <p className="text-green-700 bg-green-50 p-4 rounded-lg text-sm">
            If that email is registered, a reset link has been sent. Check your inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="forgot-email"
                type="email"
                className="input"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="mt-4 text-sm text-center">
          <Link to={withRedirect('/login', redirect)} className="text-primary-600 hover:underline">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
