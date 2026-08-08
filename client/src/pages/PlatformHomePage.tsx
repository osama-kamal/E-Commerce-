/**
 * PlatformHomePage — what the platform's own domain serves at `/`.
 *
 * This route used to render a full storefront bound to one hardcoded store, so
 * the SaaS platform and one of its tenants were literally the same page. The
 * root is now the platform: what it is, what it costs, and how to start.
 *
 * Storefronts live on their own hosts (subdomain or custom domain) or at
 * /s/:slug. Nothing here is tenant-scoped, which is why it makes no API call
 * that needs a store — a deliberate property, since on this host there is no
 * current store to resolve.
 *
 * Type and colour follow the existing storefront language (Cormorant display
 * over Inter, bone ground, hairlines rather than shadows) so the platform reads
 * as the same product, not a separate site.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Globe, LineChart, Palette, ShieldCheck, Truck } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: Palette,
    title: 'Themes, not templates',
    body: 'Six storefront designs that change type, colour and elevation — never your catalogue, pricing or checkout.',
  },
  {
    icon: Truck,
    title: 'Shipping & tax that work',
    body: 'Delivery zones, free-shipping thresholds, and destination tax that handles both inclusive and exclusive pricing.',
  },
  {
    icon: Globe,
    title: 'Your own domain',
    body: 'Run the shop on a subdomain or point your own domain at it. Customers never see ours.',
  },
  {
    icon: LineChart,
    title: 'Analytics that reconcile',
    body: 'Revenue reported net of tax, so the dashboard agrees with your accounts rather than flattering them.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolated by construction',
    body: 'Every record is tenant-scoped and every request is checked against your account, not just your URL.',
  },
];

const PLAN_TEASERS = [
  { name: 'Free', price: '$0', note: '15 products · 50 orders/mo' },
  { name: 'Starter', price: '$29', note: '500 products · custom domain', highlight: true },
  { name: 'Pro', price: '$79', note: 'Unlimited · no platform branding' },
];

export default function PlatformHomePage() {
  return (
    <div className="bg-[#fafaf9] dark:bg-gray-950">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-24 text-center sm:pt-32">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-500"
        >
          Commerce infrastructure
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="font-display text-4xl leading-[1.1] tracking-tight text-gray-900 sm:text-6xl dark:text-white"
          style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}
        >
          Build a store worth
          <br className="hidden sm:block" /> visiting twice.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-gray-600 dark:text-gray-400"
        >
          Vendbase gives independent merchants a complete storefront — catalogue, checkout,
          shipping, tax and analytics — on their own domain. No credit card to start.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link
            to="/start"
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-7 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Start your store
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-7 py-3.5 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:text-white"
          >
            Sign in
          </Link>
        </motion.div>

        <p className="mt-5 text-xs text-gray-400">
          7-day trial of the paid features, then stay on Free for as long as you like.
        </p>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2
            className="mb-12 text-center text-2xl tracking-tight text-gray-900 dark:text-white"
            style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}
          >
            What you get
          </h2>

          <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="mb-3 h-5 w-5 text-amber-600 dark:text-amber-500" aria-hidden="true" />
                <h3 className="mb-1.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ────────────────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2
            className="mb-3 text-center text-2xl tracking-tight text-gray-900 dark:text-white"
            style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}
          >
            Simple pricing
          </h2>
          <p className="mb-10 text-center text-sm text-gray-500 dark:text-gray-400">
            Start free. Upgrade when the limits start to matter.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            {PLAN_TEASERS.map(plan => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-6 text-center ${
                  plan.highlight
                    ? 'border-gray-900 bg-white dark:border-white dark:bg-gray-900'
                    : 'border-gray-200 bg-white/60 dark:border-gray-800 dark:bg-gray-900/40'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{plan.name}</p>
                <p className="my-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {plan.price}
                  <span className="text-sm font-normal text-gray-400">/mo</span>
                </p>
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{plan.note}</p>
              </div>
            ))}
          </div>

          <ul className="mx-auto mt-10 max-w-md space-y-2">
            {['No credit card to start', 'Your data stays exportable', 'Cancel and stay on Free'].map(item => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-400">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2
            className="mb-4 text-3xl tracking-tight text-gray-900 dark:text-white"
            style={{ fontFamily: '"Cormorant Garamond", Georgia, serif' }}
          >
            Open your shop today
          </h2>
          <p className="mx-auto mb-8 max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Setup takes a few minutes. Add your first product, pick a theme, and share the link.
          </p>
          <Link
            to="/start"
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Get started free
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
