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

import { Link } from 'react-router-dom';

const YEAR = new Date().getFullYear();

export default function Footer() {
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

        {/* Bottom bar */}
        <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <p>© {YEAR} Vendbase. All rights reserved.</p>
          <p className="text-gray-600">
            Built for modern e-commerce.
          </p>
        </div>
      </div>
    </footer>
  );
}
