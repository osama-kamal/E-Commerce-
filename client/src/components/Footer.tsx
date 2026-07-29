/**
 * Footer — Vendbase platform main-site footer
 *
 * Rendered on all public-facing pages: /, /start, /login, /register,
 * /products/:id, /compare, etc.
 *
 * Contains:
 *  - Brand + about text
 *  - Platform nav links
 *  - Legal links (Terms of Service, Privacy Policy — no Refund Policy for COD)
 *  - Copyright line
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { newsletterApi } from '../api/newsletter';
import toast from 'react-hot-toast';

const YEAR = new Date().getFullYear();

// NOTE: no social icons here on purpose. Lucide v1 dropped brand marks, and more
// importantly the real Vendbase handles are unknown — linking "Vendbase on X" to
// x.com's homepage would be a fabricated profile. The support address below is
// the one contact route that actually exists in this codebase. Drop real profile
// URLs in and a social row can be added in a minute.
const SUPPORT_EMAIL = 'vendbase019@gmail.com';

export default function Footer() {
  // Same newsletter client the sidebar card uses — no new endpoint.
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      const res = await newsletterApi.subscribe(email);
      toast.success(res.data.message || 'Thanks for subscribing!');
      setEmail('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to subscribe');
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="bg-gray-950 text-gray-400 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        {/* Top grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-10">

          {/* Brand */}
          <div>
            <Link to="/" className="inline-flex items-center gap-2 mb-3">
              <span className="text-2xl font-extrabold text-white tracking-tight">Vendbase</span>
            </Link>
            <p className="text-sm leading-relaxed text-gray-400">
              Vendbase is a multi-tenant SaaS platform empowering vendors to build
              and manage their e-commerce storefronts effortlessly.
            </p>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Platform</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/admin" className="hover:text-white transition-colors">Dashboard</Link>
              </li>
              <li>
                <Link to="/admin/pricing" className="hover:text-white transition-colors">Plans &amp; Pricing</Link>
              </li>
              <li>
                <a
                  href="https://mail.google.com/mail/?view=cm&fs=1&to=vendbase019@gmail.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Contact Support
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-widest mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                {/* Placeholder — create /terms page when ready */}
                <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
              </li>
              <li>
                {/* Placeholder — create /privacy page when ready */}
                <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Newsletter strip.
            A premium storefront footer earns its height by doing something; this
            one only listed links. The field posts to the same /?search-free
            newsletter route the sidebar card already uses — no new API surface,
            it simply reuses the existing subscribe endpoint via the same client. */}
        <div className="mb-10 rounded-2xl border border-gray-800 bg-gray-900/60 p-6 sm:p-8">
          <div className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
            <div>
              <h4 className="text-lg font-semibold tracking-tight text-white">Stay in the loop</h4>
              <p className="mt-1 text-sm text-gray-400">
                New arrivals and offers, straight to your inbox.
              </p>
            </div>
            <form onSubmit={handleSubscribe} className="flex w-full max-w-md gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address"
                className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-amber-400/60"
              />
              <button
                type="submit"
                disabled={busy}
                aria-busy={busy}
                className={`btn btn-brand shrink-0 ${busy ? 'btn-loading' : ''}`}
              >
                {busy ? 'Joining…' : 'Subscribe'}
              </button>
            </form>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-gray-800 pt-6 text-xs sm:flex-row">
          <p>© {YEAR} Vendbase. All rights reserved.</p>

          <a
            href={`https://mail.google.com/mail/?view=cm&fs=1&to=${SUPPORT_EMAIL}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {SUPPORT_EMAIL}
          </a>

          <p className="text-gray-600">Built for modern e-commerce.</p>
        </div>
      </div>
    </footer>
  );
}
