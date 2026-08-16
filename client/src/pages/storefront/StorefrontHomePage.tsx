/**
 * StorefrontHomePage  (/s/:slug)
 *
 * Public product catalog for a specific tenant store. Uses the storefront-scoped
 * Axios instance from StorefrontContext so all API calls carry X-Store-Slug.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flame,
  PackageOpen,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useDebounce } from '../../hooks/useDebounce';
import ProductCard from '../../components/ProductCard';
import HeroCarousel, { HeroSlide } from '../../components/HeroCarousel';
import StorefrontWidgets from '../../components/StorefrontWidgets';
import { ProductCardSkeleton } from '../../components/Skeleton';
import { Category, Product, PaginatedResponse } from '../../types';

/**
 * Hero slides for a storefront.
 *
 * Every CTA is a real destination in this store's own catalogue, built on the
 * same query-string filters the sidebar and footer use — so a hero click, a
 * footer click and a sidebar click all land in the same place through the same
 * code path. A promotional banner that goes nowhere is worse than no banner.
 *
 * Imagery is deliberately generic retail photography rather than the store's own
 * products: product shots are merchant-uploaded at unpredictable aspect ratios
 * and would crop badly at hero scale. A merchant-managed banner library is the
 * obvious next step; this needs no schema change to ship.
 */
function storefrontSlides(base: string): HeroSlide[] {
  return [
    {
      id: 'new',
      eyebrow: 'Just In',
      title: 'New arrivals, freshly stocked',
      image: 'https://images.unsplash.com/photo-1595665593673-bf1ad72905c0?q=80&w=1328&auto=format&fit=crop&fm=webp',
      alt: 'A bright, well-stocked retail store interior',
      cta: 'Shop new arrivals',
      href: `${base}?sort=newest`,
    },
    {
      id: 'sale',
      eyebrow: 'Limited Time',
      title: 'Deals worth coming back for',
      image: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?q=80&w=1074&auto=format&fit=crop&fm=webp',
      alt: 'Colourful shopping bags and sale tags',
      cta: 'See all offers',
      href: `${base}?sale=true`,
    },
    {
      id: 'rated',
      eyebrow: 'Customer Favourites',
      title: 'The pieces people keep rating five stars',
      image: 'https://images.unsplash.com/photo-1705675451868-014a161e591b?q=80&w=735&auto=format&fit=crop&fm=webp',
      alt: 'Clothing displayed neatly on hangers',
      cta: 'Browse top rated',
      href: `${base}?sort=rating`,
    },
  ];
}

/**
 * One sidebar group.
 *
 * The filter rail used to be three separate `.card` boxes, each with its own
 * border, radius and shadow, stacked with gaps — three competing containers for
 * what is one control surface. This renders a labelled group inside a single
 * panel instead, which is how Shopify, Stripe and every catalogue UI that reads
 * "calm" structures a filter rail.
 */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
        {label}
      </h3>
      {children}
    </div>
  );
}

/**
 * A removable summary of one active filter.
 *
 * The rail already had a Reset link, but Reset is all-or-nothing: a shopper who
 * has narrowed to "Furniture, in stock, under 500" and wants to widen just the
 * price had to clear everything and rebuild the other two. Chips also make the
 * active state legible at a glance — with the category list scrolled and the
 * price fields below the fold, there was no single place that said what was on.
 */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      aria-label={`Remove filter: ${label}`}
      className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-gray-200 bg-gray-50
                 py-1 pl-2.5 pr-1.5 text-xs font-medium text-gray-700 transition-colors
                 hover:border-gray-300 hover:bg-gray-100
                 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300
                 dark:hover:border-gray-600 dark:hover:bg-gray-700"
    >
      <span className="truncate">{label}</span>
      <X className="w-3 h-3 shrink-0 text-gray-400" aria-hidden="true" />
    </button>
  );
}

/**
 * Quick price bands.
 *
 * Two numeric inputs are precise and slow — they need a keyboard, two fields and
 * a guess at the catalogue's range. Bands cover the common intent in one click
 * and write to the same `min`/`max` params, so they are interchangeable with
 * typing rather than a parallel mechanism.
 *
 * The thresholds are fixed rather than derived from the catalogue, and they are
 * rendered without a currency symbol to match the Min/Max inputs above them.
 * Bands computed from the store's real price distribution would be better, and
 * need a facet aggregation the products endpoint does not expose yet.
 */
const PRICE_BANDS: Array<{ label: string; min: string; max: string }> = [
  { label: 'Under 100', min: '', max: '100' },
  { label: '100 – 500', min: '100', max: '500' },
  { label: '500 – 1000', min: '500', max: '1000' },
  { label: '1000 +', min: '1000', max: '' },
];

/**
 * Catalogue grid tracks.
 *
 * Declared once because the skeleton and the real grid must step at exactly the
 * same widths — two copies of this string is how they drift.
 *
 * ── Tracks follow the CENTRE column, not the viewport ─────────────────────────
 * The two rails appear at different breakpoints and take a fixed 224px + 288px
 * out of the row, so the space the grid actually gets does not grow
 * monotonically with the window. Every step below is chosen to hold a card
 * between roughly 270 and 400px wide:
 *
 *   lg  (1024–1279)  filters only              ~967px → 3 cols, ~309px cards
 *   xl  (1280–1535)  filters only         ~960–1215px → 4 cols, ~225–289px
 *   2xl (1536–1799)  filters + widgets     ~896–1160px → 3 cols, ~285–373px
 *   1800–2239        filters + widgets    ~1160–1599px → 4 cols, ~275–385px
 *   2240–2699        filters + widgets    ~1600–2059px → 5 cols, ~308–396px
 *   2700+            filters + widgets         ~2060px → 6 cols, ~327px+
 *
 * The step back to 3 at 2xl is the one that looks wrong and is not: that is
 * where the widgets rail appears and takes ~320px out of the centre, so a fourth
 * column there would drop each card below the width its price, rating and size
 * selector need. It also keeps the card size almost unchanged across that
 * boundary — 289px at 1535 against 285px at 1536 — so the rail slides in without
 * the grid visibly reflowing underneath it.
 *
 * The three widest steps use arbitrary `min-[…]` variants because Tailwind's
 * default screens stop at 2xl (1536px), and the storefront no longer caps its
 * container — see `.storefront-shell` in index.css. Without them a 2560px
 * monitor rendered three ~600px cards.
 */
const GRID_CLASS =
  'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-3 ' +
  'min-[1800px]:grid-cols-4 min-[2240px]:grid-cols-5 min-[2700px]:grid-cols-6 gap-x-5 gap-y-7';

/** Human labels for the `sort` param, shared by the chip and the select. */
const SORT_LABELS: Record<string, string> = {
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Highest rated',
  newest: 'Newest',
};

export default function StorefrontHomePage() {
  const { store, sfApi, slug } = useStorefront();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Bumped by the error-state Retry. The fetch effect keys on the URL params,
  // and a load that failed on the default view (no page/filter set) leaves
  // nothing for Retry to change — clearing the error alone would never refetch.
  // This gives the effect a dep that always changes on a retry.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);

  /**
   * ── Filters live in the URL, not in component state ─────────────────────────
   *
   * They were `useState`, which made the catalogue unaddressable: every filtered
   * view had the same URL, so nothing could link INTO a filtered state. That is
   * why the footer's "New Arrivals" and "Deals & Offers" were `<Link to=".">` —
   * there was no URL to point them at, so they pointed at nothing.
   *
   * With the query string as the source of truth, `?sort=newest` and
   * `?sale=true` are real destinations: a filtered grid can be shared and
   * bookmarked, and a reload keeps the view instead of dumping the shopper back
   * to page 1 unfiltered.
   *
   * History behaviour is deliberately split. Sidebar edits use `replace`, so
   * dragging a price field does not bury the previous page under twenty entries.
   * Footer and nav links are ordinary `<Link>`s and therefore PUSH, so Back
   * returns from "Deals & Offers" to whatever the shopper was looking at — which
   * is the case where Back actually means something.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedCategory = searchParams.get('category') ?? '';
  const minPrice = searchParams.get('min') ?? '';
  const maxPrice = searchParams.get('max') ?? '';
  const inStock = searchParams.get('stock') === 'true';
  const onSale = searchParams.get('sale') === 'true';
  const sortBy = searchParams.get('sort') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const urlQuery = searchParams.get('q') ?? '';

  /**
   * Merges a patch into the query string.
   *
   * Empty/false values delete their key so the URL stays readable — `/s/acme`
   * rather than `/s/acme?category=&min=&sale=false`. Any change resets to page 1
   * unless the patch sets a page itself; landing on page 4 of a result set that
   * now has one page is a dead end.
   */
  const updateParams = (patch: Record<string, string | number | boolean | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (!('page' in patch)) next.delete('page');
      for (const [key, value] of Object.entries(patch)) {
        // Delete on the three "unset" signals only. A numeric 0 is a real value,
        // not an absence — treating it as one would silently drop any future
        // `{ min: 0 }` the way falsy-zero checks always lose zeros.
        if (value === null || value === '' || value === false) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace: true });
  };

  // The text input keeps local state so typing stays responsive, then settles
  // into the URL once the shopper pauses. Seeded from the URL so a shared
  // `?q=…` link shows its own term in the box.
  const [searchInput, setSearchInput] = useState(urlQuery);
  const debouncedSearch = useDebounce(searchInput, 300);

  // Push the settled term into the URL. Guarded on a real change, or this would
  // rewrite the URL on every render and fight the effect below.
  useEffect(() => {
    if (debouncedSearch !== urlQuery) updateParams({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // …and pull it back when the URL changes from the outside — a footer link, a
  // Back navigation — so the box never disagrees with the results.
  useEffect(() => {
    setSearchInput(prev => (prev === urlQuery ? prev : urlQuery));
  }, [urlQuery]);

  // The price fields follow the same local-state-then-debounce shape as the
  // search box, and for the same reason: writing to the URL on every keystroke
  // fired a full products refetch per character. Local state keeps typing
  // responsive; the settled value is what reaches the URL 300ms later.
  const [minInput, setMinInput] = useState(minPrice);
  const [maxInput, setMaxInput] = useState(maxPrice);
  const debouncedMin = useDebounce(minInput, 300);
  const debouncedMax = useDebounce(maxInput, 300);

  useEffect(() => {
    if (debouncedMin !== minPrice || debouncedMax !== maxPrice) {
      updateParams({ min: debouncedMin, max: debouncedMax });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMin, debouncedMax]);

  // Pull committed values back into the fields when the URL changes elsewhere —
  // a price band, a chip's clear, Reset, or Back — so the inputs never disagree
  // with the active filter.
  useEffect(() => {
    setMinInput(prev => (prev === minPrice ? prev : minPrice));
  }, [minPrice]);
  useEffect(() => {
    setMaxInput(prev => (prev === maxPrice ? prev : maxPrice));
  }, [maxPrice]);

  // Narrowing the results (search + filters) versus merely reordering them.
  // Only narrowing hides the hero: a shopper who picks "Newest" has not told
  // you what they want, so the promotional banner still earns its place, but a
  // sort IS still an active state for the chips and Reset below.
  const isNarrowing = !!(urlQuery || selectedCategory || minPrice || maxPrice || inStock || onSale);
  const hasActiveFilters = isNarrowing || !!sortBy;

  /**
   * One chip per active filter, each clearing only its own key.
   *
   * Built here rather than in a child because every entry needs `updateParams`
   * and the category list to resolve an id into a name.
   */
  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [];

  if (urlQuery) {
    activeChips.push({
      key: 'q',
      label: `“${urlQuery}”`,
      // Clears the input as well as the URL. Clearing only the URL would let the
      // debounced effect below push the stale term straight back 300ms later.
      clear: () => { setSearchInput(''); updateParams({ q: null }); },
    });
  }
  if (selectedCategory) {
    activeChips.push({
      key: 'category',
      label: categories.find(c => c._id === selectedCategory)?.name ?? 'Category',
      clear: () => updateParams({ category: null }),
    });
  }
  if (minPrice || maxPrice) {
    activeChips.push({
      key: 'price',
      label: minPrice && maxPrice ? `${minPrice} – ${maxPrice}` : minPrice ? `From ${minPrice}` : `Up to ${maxPrice}`,
      clear: () => updateParams({ min: null, max: null }),
    });
  }
  if (inStock) {
    activeChips.push({ key: 'stock', label: 'In stock', clear: () => updateParams({ stock: null }) });
  }
  if (onSale) {
    activeChips.push({ key: 'sale', label: 'On sale', clear: () => updateParams({ sale: null }) });
  }
  if (sortBy) {
    activeChips.push({
      key: 'sort',
      label: SORT_LABELS[sortBy] ?? sortBy,
      clear: () => updateParams({ sort: null }),
    });
  }

  // Fetch categories once
  useEffect(() => {
    sfApi.get<{ data: Category[] }>('/categories')
      .then(res => setCategories(res.data.data))
      .catch(() => {}); // non-fatal — filters just won't show
  }, [sfApi]);

  // Fetch products whenever filters or page change
  useEffect(() => {
    setLoading(true);
    setFetchError(null);

    /**
     * 20 per page, chosen against the grid rather than picked round.
     *
     * The page size has to divide by the track counts the catalogue actually
     * renders, or the last row comes up short and reads as a hole in the grid.
     * 20 divides cleanly by 1, 2, 4 and 5 — which covers every step from mobile
     * up to the 2240px break — and leaves a 2-card remainder only at 3 and 6.
     * The old 12 was clean at 3 but left 5 columns showing 5 + 5 + 2.
     *
     * Server-capped at 100, so this is well inside what /products will serve.
     */
    const params: Record<string, string | number | boolean> = { page, limit: 20 };
    if (urlQuery) params.search = urlQuery;
    if (selectedCategory) params.category = selectedCategory;
    if (minPrice) params.minPrice = Number(minPrice);
    if (maxPrice) params.maxPrice = Number(maxPrice);
    if (inStock) params.inStock = true;
    if (onSale) params.onSale = true;
    if (sortBy) params.sortBy = sortBy;

    sfApi.get<{ data: PaginatedResponse<Product> }>('/products', { params })
      .then(res => {
        const d = res.data.data;
        setProducts(d.data);
        setTotal(d.total);
        setTotalPages(d.totalPages);
      })
      .catch(err => {
        const msg: string = err?.response?.data?.message ?? err?.message ?? 'Failed to load products';
        setFetchError(msg);
        setProducts([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // Every value here is now read from the query string, so a footer link that
    // changes the URL refetches exactly as a sidebar click does — one code path
    // for both. `onSale` in particular used to be sent in `params` while missing
    // from this list, so the offers filter never refetched at all.
  }, [sfApi, page, urlQuery, selectedCategory, minPrice, maxPrice, inStock, onSale, sortBy, reloadNonce]);

  const handleReset = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // ── Empty state copy — distinguishes "store is empty" from "no filter match" ─
  //
  // Rendered on the page ground rather than inside a `.card`. An empty result is
  // an absence; boxing it in an elevated panel gives nothing the visual weight
  // of something.
  const EmptyState = () => {
    const Frame = ({ icon: Icon, title, children }: {
      icon: typeof Search; title: string; children: React.ReactNode;
    }) => (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 grid place-items-center mb-5">
          <Icon className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </span>
        <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-1.5">
          {title}
        </h3>
        {children}
      </div>
    );

    if (fetchError) {
      return (
        <Frame icon={AlertTriangle} title="Could not load products">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{fetchError}</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mb-6 font-mono">Store: {slug}</p>
          <button onClick={() => setReloadNonce(n => n + 1)} className="btn-primary px-5">
            Retry
          </button>
        </Frame>
      );
    }

    if (hasActiveFilters) {
      return (
        <Frame icon={Search} title="No products match your filters">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
            Try adjusting or clearing your search and filters.
          </p>
          <button onClick={handleReset} className="btn-secondary px-5">Clear filters</button>
        </Frame>
      );
    }

    // Store exists but has no products at all
    return (
      <Frame icon={PackageOpen} title={`${store.name} is setting up`}>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          This store hasn't listed any products yet. Check back soon.
        </p>
      </Frame>
    );
  };

  const categoryButton = (active: boolean) =>
    `w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
      active
        ? 'bg-gray-900 text-white font-medium dark:bg-white dark:text-gray-900'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
    }`;

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────────
          Full-bleed and OUTSIDE the padded container below, so the photography
          runs edge to edge directly under the nav rather than sitting in a
          gutter. `compact` because a catalogue page's job is the grid — a
          full-height hero here pushes every product below the fold.

          Hidden once the shopper is narrowing (searching or filtering): at that
          point they have told you what they want, and a promotional banner
          between them and their results is an obstacle. Reordering (sort) does
          NOT hide it — see isNarrowing. It returns when filters are cleared. */}
      {!isNarrowing && (
        <HeroCarousel
          fullBleed
          height="compact"
          accent="neutral"
          shellClass="storefront-shell"
          slides={storefrontSlides(`/s/${slug}`)}
        />
      )}

      <div className="storefront-shell py-10">
      {/* ── Masthead ────────────────────────────────────────────────────────────
          Store name, a one-line summary, and the search on the same row at
          desktop width. The old header stacked a bare h1 over a raw contact
          email — an address is footer material, not a page subtitle. */}
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-gray-900 dark:text-white">
            {store.name}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            {total > 0
              ? `${total} product${total !== 1 ? 's' : ''} available`
              : 'Browse the collection'}
          </p>
        </div>

        <div className="relative w-full lg:w-80 shrink-0">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search products"
            aria-label="Search products"
            className="input pl-9 pr-9"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-md
                         text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors
                         dark:hover:text-white dark:hover:bg-gray-800"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {/* ── Three columns ────────────────────────────────────────────────────
          Filters · catalogue · widgets.

          Both rails are fixed-width and the grid takes the remainder, so the
          centre column absorbs every pixel the viewport gives rather than the
          page growing an empty gutter. They drop out at different breakpoints
          on purpose: filters are load-bearing for finding a product and survive
          to `lg`, while the widgets rail is merchandising and only appears at
          `2xl`, where there is genuinely width to spare. Below that the centre
          column widens instead of the page carrying two half-empty sidebars. */}
      {/* `items-start` is load-bearing.
          Flex stretches children by default, so each rail's BOX grew to the
          height of the tallest column — the 2,439px grid — leaving ~1,980px of
          stretched, empty aside beside the lower rows. Aligning to the start
          lets each rail be exactly as tall as its content. */}
      <div className="flex items-start gap-6 xl:gap-8">
        {/* ── Filter rail ──────────────────────────────────────────────────────
            One panel, grouped and hairline-divided, instead of three stacked
            cards. Wider (256px) so category names stop wrapping. */}
        {(categories.length > 0 || total > 0) && (
          <aside className="w-56 shrink-0 hidden lg:block">
            {/* A sticky box taller than the viewport pins its top and puts its
                own bottom permanently out of reach — no amount of page scrolling
                brings it back. Capping the height and letting the rail scroll
                internally is what keeps the last filter reachable on a short
                laptop screen; below that height no scrollbar appears at all.
                The negative margin lets card shadows bleed into the column gap
                instead of being clipped by the scroll container. */}
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto -mx-2 px-2 [scrollbar-width:thin]">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">Filters</h2>
                {hasActiveFilters && (
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500
                               hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    Reset
                  </button>
                )}
              </div>

              {activeChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-3">
                  {activeChips.map(chip => (
                    <FilterChip key={chip.key} label={chip.label} onRemove={chip.clear} />
                  ))}
                </div>
              )}

              {categories.length > 0 && (
                <FilterGroup label="Category">
                  <ul className="space-y-0.5 max-h-72 overflow-y-auto -mx-1 px-1">
                    <li>
                      <button
                        onClick={() => updateParams({ category: null })}
                        className={categoryButton(!selectedCategory)}
                      >
                        All products
                      </button>
                    </li>
                    {categories.map(cat => (
                      <li key={cat._id}>
                        <button
                          onClick={() => updateParams({ category: cat._id })}
                          className={categoryButton(selectedCategory === cat._id)}
                        >
                          {/* Indent nested categories instead of drawing a `└`
                              character, which sat on the text baseline and made
                              the list look broken rather than hierarchical. */}
                          <span style={{ paddingLeft: cat.level > 0 ? `${cat.level * 12}px` : undefined }}>
                            {cat.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </FilterGroup>
              )}

              <FilterGroup label="Price">
                <div className="flex items-center gap-2">
                  <input
                    type="number" inputMode="numeric" placeholder="Min" aria-label="Minimum price"
                    className="input text-sm" value={minInput}
                    onChange={e => setMinInput(e.target.value)}
                  />
                  <span className="text-gray-300 dark:text-gray-600">–</span>
                  <input
                    type="number" inputMode="numeric" placeholder="Max" aria-label="Maximum price"
                    className="input text-sm" value={maxInput}
                    onChange={e => setMaxInput(e.target.value)}
                  />
                </div>

                {/* Clicking the active band clears it, so a band behaves like a
                    toggle rather than a one-way trip that needs Reset to undo. */}
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {PRICE_BANDS.map(band => {
                    const active = minPrice === band.min && maxPrice === band.max;
                    return (
                      <button
                        key={band.label}
                        onClick={() => updateParams(
                          active ? { min: null, max: null } : { min: band.min, max: band.max }
                        )}
                        aria-pressed={active}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                        }`}
                      >
                        {band.label}
                      </button>
                    );
                  })}
                </div>
              </FilterGroup>

              <FilterGroup label="Availability">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox" checked={inStock}
                    className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900
                               dark:border-gray-600 dark:bg-gray-800"
                    onChange={e => updateParams({ stock: e.target.checked })}
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">In stock only</span>
                </label>

                {/* The single place a colour accent earns its keep: a discount
                    filter is the one control shoppers hunt for. Everything else
                    on this rail is deliberately neutral so this reads. */}
                <button
                  onClick={() => updateParams({ sale: !onSale })}
                  aria-pressed={onSale}
                  className={`mt-3 w-full inline-flex items-center justify-center gap-2 text-sm font-medium
                              px-3 py-2 rounded-lg border transition-colors ${
                    onSale
                      ? 'bg-rose-600 border-rose-600 text-white hover:bg-rose-700'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" aria-hidden="true" />
                  {onSale ? 'Showing offers' : 'On sale'}
                </button>
              </FilterGroup>
            </div>
          </aside>
        )}

        {/* ── Results ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!loading && total > 0 && (
            <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-gray-200 dark:border-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing <span className="font-medium text-gray-900 dark:text-white">{products.length}</span> of {total}
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor="sf-sort" className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
                  Sort
                </label>
                <select
                  id="sf-sort"
                  value={sortBy}
                  onChange={e => updateParams({ sort: e.target.value })}
                  className="input text-sm py-1.5 pl-3 pr-8 w-auto"
                >
                  <option value="">Featured</option>
                  {/* Driven by SORT_LABELS so the option and its filter chip can
                      never drift apart. */}
                  {Object.entries(SORT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Roomier gutters and a 1-col mobile break. Two columns at 375px gave
              each card ~160px, which is below the width the price, rating and
              size selector need to sit without wrapping. Track counts and the
              reasoning behind them live on GRID_CLASS. */}
          {loading ? (
            // Ten, not four: this stands in for a 20-product page, and it fills
            // exactly two rows at both four and five columns — the widths where
            // most of this catalogue is actually viewed. A single short row
            // reads as "that's all there is" while 20 are still loading.
            <div className={GRID_CLASS}>
              {Array.from({ length: 10 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : products.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={GRID_CLASS}>
              {products.map((p, i) => (
                <ProductCard
                  key={p._id}
                  product={p}
                  index={i}
                  detailPath={`/s/${slug}/products/${p._id}`}
                  loginRedirect={`/s/${slug}`}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav
              className="flex items-center justify-center gap-1 mt-14"
              aria-label="Pagination"
            >
              <button
                onClick={() => updateParams({ page: Math.max(1, page - 1) })}
                disabled={page === 1}
                aria-label="Previous page"
                className="w-9 h-9 grid place-items-center rounded-lg border border-gray-200 text-gray-600
                           hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 disabled:pointer-events-none
                           transition-colors dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="px-4 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                Page <span className="font-medium text-gray-900 dark:text-white">{page}</span> of {totalPages}
              </span>
              <button
                onClick={() => updateParams({ page: Math.min(totalPages, page + 1) })}
                disabled={page === totalPages}
                aria-label="Next page"
                className="w-9 h-9 grid place-items-center rounded-lg border border-gray-200 text-gray-600
                           hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 disabled:pointer-events-none
                           transition-colors dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>

        {/* ── Widgets rail ───────────────────────────────────────────────────
            Sticky, so it stays useful while the shopper scrolls a long grid.
            `2xl` and up only — see the note on the flex row above. */}
        <aside className="w-72 shrink-0 hidden 2xl:block">
          {/* Same height cap as the filter rail — this one now carries up to six
              cards, which comfortably exceeds a laptop viewport. */}
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto -mx-2 px-2 [scrollbar-width:thin]">
            <StorefrontWidgets
              sfApi={sfApi}
              slug={slug}
              storeName={store.name}
              currency={store.currency ?? 'USD'}
              settings={store.settings}
            />
          </div>
        </aside>
      </div>
      </div>
    </>
  );
}
