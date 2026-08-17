import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AxiosInstance } from 'axios';
import {
  ArrowRight,
  Clock,
  Flame,
  LifeBuoy,
  Loader2,
  Mail,
  Phone,
  Star,
  TrendingUp,
} from 'lucide-react';
import StarRating from './StarRating';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';
import { formatCurrency } from '../utils/format';
import type { Product, PaginatedResponse, StoreSettings } from '../types';

/**
 * Right-hand widgets rail for the storefront catalogue.
 *
 * ── What earns a slot ─────────────────────────────────────────────────────────
 * Recently Viewed is personalisation, and it comes first because it is the only
 * thing on the page that is about THIS shopper — a returning visitor gets their
 * own trail back before any merchandising. Hot Deals, Trending and Top Rated are
 * merchandising: they surface stock the shopper would otherwise have to filter
 * for, and each links INTO the filtered catalogue rather than being decorative.
 * Help and Newsletter close the rail — the footer carries the same contact
 * details, but it sits below a catalogue that can run several thousand pixels,
 * and a shopper who needs to ask a question mid-scroll should not have to hunt
 * for it.
 *
 * ── Data ──────────────────────────────────────────────────────────────────────
 * Every product widget fetches through the caller's tenant-scoped axios
 * instance, so they carry `X-Store-Slug` like everything else on the storefront
 * and can never read another merchant's catalogue. They are deliberately
 * independent of the grid's own query: the rail shows the store's best
 * regardless of what the shopper has filtered to, which is the point of a rail.
 *
 * A widget that returns nothing renders nothing. A store with no discounts
 * should not display an empty "Hot Deals" box — that reads as broken, and the
 * rail collapses gracefully to whatever the store actually has.
 *
 * ── Why the rail de-duplicates itself ─────────────────────────────────────────
 * "Trending" (most-reviewed) and "Top rated" (highest-rated) are different
 * questions that return overlapping answers on a small catalogue — a 28-product
 * store would show the same four items twice, which makes the rail look padded
 * rather than curated. Trending therefore renders only what the widgets above it
 * did not already show, and disappears when that leaves nothing.
 */

function WidgetCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Flame;
  action?: { label: string; to: string };
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-5">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
          <Icon className="w-4 h-4 text-gray-400" aria-hidden="true" />
          {title}
        </h3>
        {action && (
          <Link
            to={action.to}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900
                       dark:hover:text-white transition-colors shrink-0"
          >
            {action.label}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** Skeleton rows sized to the real content, so the rail does not jump on load. */
function RowSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-14 h-14 rounded-lg bg-gray-100 dark:bg-gray-800 shrink-0 animate-pulse" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The shape a rail row actually needs.
 *
 * Narrower than `Product` on purpose: the recently-viewed list is a stored
 * snapshot with no rating fields, and widening it to a full Product would mean
 * persisting — and validating — half a dozen values this row never draws.
 * `Product` is structurally assignable to it, so the fetched widgets pass
 * through unchanged.
 */
type RowProduct = {
  _id: string;
  name: string;
  price: number;
  discount: number;
  images?: string[];
  averageRating?: number;
  reviewCount?: number;
};

/** One product row: thumbnail, name, and either a price or a rating. */
function ProductRow({
  product,
  to,
  currency,
  showRating,
}: {
  product: RowProduct;
  to: string;
  currency: string;
  showRating?: boolean;
}) {
  const discounted = product.discount > 0;
  const effective = discounted
    ? Math.round(product.price * (1 - product.discount / 100) * 100) / 100
    : product.price;

  return (
    <li>
      <Link to={to} className="group flex gap-3 items-center">
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0">
          {product.images?.[0] ? (
            <img
              src={product.images[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:opacity-70 transition-opacity">
            {product.name}
          </p>

          {showRating ? (
            <div className="mt-1 flex items-center gap-1.5">
              <StarRating rating={product.averageRating ?? 0} size="sm" />
              <span className="text-xs text-gray-400 tabular-nums">({product.reviewCount ?? 0})</span>
            </div>
          ) : (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                {formatCurrency(effective, currency)}
              </span>
              {discounted && (
                <span className="text-xs text-gray-400 line-through tabular-nums">
                  {formatCurrency(product.price, currency)}
                </span>
              )}
            </div>
          )}
        </div>

        {discounted && !showRating && (
          <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600
                           dark:bg-rose-950/40 dark:text-rose-400">
            −{product.discount}%
          </span>
        )}
      </Link>
    </li>
  );
}

// ── Newsletter ────────────────────────────────────────────────────────────────

function NewsletterWidget({ sfApi, storeName }: { sfApi: AxiosInstance; storeName: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || state === 'sending') return;

    setState('sending');
    try {
      // Through the tenant-scoped instance, so the subscriber is attached to
      // THIS store rather than whichever tenant the global axios last resolved.
      await sfApi.post('/newsletter/subscribe', { email: email.trim() });
      setState('done');
      setEmail('');
    } catch {
      // The interceptor surfaces the server's message; this only restores the
      // form so the shopper can correct the address and retry.
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <section className="surface p-5 text-center">
        <span className="w-10 h-10 rounded-full bg-gray-900 dark:bg-white grid place-items-center mx-auto mb-3">
          <Mail className="w-4 h-4 text-white dark:text-gray-900" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">You're subscribed</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          We'll email you when {storeName} has something new.
        </p>
      </section>
    );
  }

  return (
    <section className="surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
        <Mail className="w-4 h-4 text-gray-400" aria-hidden="true" />
        Stay in the loop
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        New arrivals and offers from {storeName}. No spam.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-2">
        <label htmlFor="sf-newsletter" className="sr-only">Email address</label>
        <input
          id="sf-newsletter"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="input text-sm"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2
                     text-sm font-medium text-white transition-colors hover:bg-gray-800
                     disabled:opacity-60 disabled:pointer-events-none
                     dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {state === 'sending' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {state === 'sending' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </form>
    </section>
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────

/**
 * The merchant's own contact details, mid-catalogue.
 *
 * Renders nothing at all when a store has filled in none of them — an empty
 * "need help?" box is worse than no box, because it promises a channel that
 * does not exist.
 */
function HelpWidget({ settings }: { settings?: StoreSettings }) {
  const socials = [
    ['Instagram', settings?.instagram],
    ['Facebook', settings?.facebook],
    ['Twitter', settings?.twitter],
    ['TikTok', settings?.tiktok],
    ['YouTube', settings?.youtube],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  const email = settings?.contactEmail;
  const phone = settings?.contactPhone;

  if (!email && !phone && socials.length === 0) return null;

  const line =
    'flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors ' +
    'dark:text-gray-400 dark:hover:text-white break-all';

  return (
    <section className="surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
        <LifeBuoy className="w-4 h-4 text-gray-400" aria-hidden="true" />
        Need a hand?
      </h3>

      <div className="mt-3 space-y-2">
        {email && (
          <a href={`mailto:${email}`} className={line}>
            <Mail className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            {email}
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} className={line}>
            <Phone className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            {phone}
          </a>
        )}
      </div>

      {/* Named links rather than brand glyphs — lucide dropped those, and the
          footer already made this call. Consistency beats inventing icons. */}
      {socials.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 pt-4 border-t border-gray-100 dark:border-gray-800">
          {socials.map(([label, href]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors dark:hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Rail ──────────────────────────────────────────────────────────────────────

export default function StorefrontWidgets({
  sfApi,
  slug,
  storeName,
  currency,
  settings,
}: {
  sfApi: AxiosInstance;
  slug: string;
  storeName: string;
  currency: string;
  settings?: StoreSettings;
}) {
  const base = `/s/${slug}`;
  const [deals, setDeals] = useState<Product[] | null>(null);
  const [topRated, setTopRated] = useState<Product[] | null>(null);
  const [trending, setTrending] = useState<Product[] | null>(null);

  // Costs no request: read straight out of this storefront's own localStorage.
  const recent = useRecentlyViewed(slug);

  useEffect(() => {
    let cancelled = false;

    // One request per widget, each capped small. The rail must never be the
    // reason the catalogue feels slow, and none of these lists is paginated.
    sfApi
      .get<{ data: PaginatedResponse<Product> }>('/products', { params: { onSale: true, limit: 3 } })
      .then(res => { if (!cancelled) setDeals(res.data.data.data); })
      .catch(() => { if (!cancelled) setDeals([]); });

    sfApi
      .get<{ data: PaginatedResponse<Product> }>('/products', { params: { sortBy: 'rating', limit: 4 } })
      .then(res => { if (!cancelled) setTopRated(res.data.data.data); })
      .catch(() => { if (!cancelled) setTopRated([]); });

    // Over-fetched deliberately. Trending is filtered against everything the
    // widgets above already rendered, so asking for exactly four would leave the
    // widget empty whenever the two lists overlap — which, on a small catalogue,
    // is most of the time.
    sfApi
      .get<{ data: { products: Product[] } }>('/recommendations/trending', { params: { limit: 10 } })
      .then(res => { if (!cancelled) setTrending(res.data.data.products); })
      .catch(() => { if (!cancelled) setTrending([]); });

    return () => { cancelled = true; };
  }, [sfApi]);

  /**
   * Trending minus whatever is already on screen.
   *
   * Held back until BOTH lists above have resolved: rendering against a partial
   * exclusion set would show a product for a moment and then yank it away as the
   * other request lands.
   */
  const railReady = deals !== null && topRated !== null && trending !== null;
  const alreadyShown = new Set([...(deals ?? []), ...(topRated ?? [])].map(p => p._id));
  const freshTrending = railReady
    ? trending!.filter(p => !alreadyShown.has(p._id)).slice(0, 4)
    : [];

  return (
    <div className="space-y-6">
      {/* ── Recently viewed ───────────────────────────────────────────────────
          First, and above the merchandising, because it is the only block on
          the page that belongs to this shopper. Absent for a first-time
          visitor, which is exactly right — there is nothing to remember yet. */}
      {recent.length > 0 && (
        <WidgetCard title="Recently viewed" icon={Clock}>
          <ul className="space-y-4">
            {recent.slice(0, 4).map(p => (
              <ProductRow
                key={p._id}
                product={p}
                currency={currency}
                to={`${base}/products/${p._id}`}
              />
            ))}
          </ul>
        </WidgetCard>
      )}

      {/* Hot deals — hidden entirely when the store has no discounts. */}
      {(deals === null || deals.length > 0) && (
        <WidgetCard title="Hot deals" icon={Flame} action={{ label: 'All offers', to: `${base}?sale=true` }}>
          {deals === null ? (
            <RowSkeleton rows={3} />
          ) : (
            <ul className="space-y-4">
              {deals.map(p => (
                <ProductRow
                  key={p._id}
                  product={p}
                  currency={currency}
                  to={`${base}/products/${p._id}`}
                />
              ))}
            </ul>
          )}
        </WidgetCard>
      )}

      {(topRated === null || topRated.length > 0) && (
        <WidgetCard title="Top rated" icon={Star} action={{ label: 'See all', to: `${base}?sort=rating` }}>
          {topRated === null ? (
            <RowSkeleton rows={4} />
          ) : (
            <ul className="space-y-4">
              {topRated.map(p => (
                <ProductRow
                  key={p._id}
                  product={p}
                  currency={currency}
                  showRating
                  to={`${base}/products/${p._id}`}
                />
              ))}
            </ul>
          )}
        </WidgetCard>
      )}

      {/* Trending — what the store's shoppers are actually reviewing, which is a
          different question from "highest rated" and is ranked by review volume
          rather than score. Shows only what the lists above did not. */}
      {freshTrending.length > 0 && (
        <WidgetCard title="Trending now" icon={TrendingUp}>
          <ul className="space-y-4">
            {freshTrending.map(p => (
              <ProductRow
                key={p._id}
                product={p}
                currency={currency}
                showRating
                to={`${base}/products/${p._id}`}
              />
            ))}
          </ul>
        </WidgetCard>
      )}

      <HelpWidget settings={settings} />

      <NewsletterWidget sfApi={sfApi} storeName={storeName} />
    </div>
  );
}
