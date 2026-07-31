import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, DollarSign, Flame, FolderTree, RotateCcw, Search,
  SlidersHorizontal, X,
} from 'lucide-react';
import { useAppSelector } from '../hooks/useAppDispatch';
import { newsletterApi } from '../api/newsletter';
import { categoriesApi } from '../api/categories';
import { Category, Product } from '../types';
import ProductCard from '../components/ProductCard';
import HeroCarousel from '../components/HeroCarousel';
import { ProductCardSkeleton } from '../components/Skeleton';
import { useDebounce } from '../hooks/useDebounce';
import { useProducts } from '../hooks/useProducts';
import toast from 'react-hot-toast';

/**
 * Home — luxury editorial.
 *
 * Rebuilt around the conventions of high-end retail rather than software:
 *
 *  · Serif display type. Inter alone reads as a product, however well it is set.
 *  · Bone ground, not white. Pure #fff plus cool grey reads clinical.
 *  · Hairlines, not shadows. Elevation is a UI-kit device; luxury separates with
 *    1px rules and negative space.
 *  · Portrait crops, fewer per row. Three large frames sell better than five small.
 *  · Chrome on demand. Filters live in a drawer; card controls appear on hover.
 *    Nothing is removed — see `.tile-actions` in index.css for how the controls
 *    stay in the DOM, in the tab order, and always visible on touch.
 *  · Restraint with colour. Gold is a rule and a label, not a fill.
 *
 * Every filter, query, handler and URL contract is carried over unchanged.
 */

// ── Layout primitives ─────────────────────────────────────────────────────────

function Section({ children, className = '', id }: {
  children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12 ${className}`}>
      {children}
    </section>
  );
}

/**
 * Editorial section mark: a hairline, a tracked label, a serif title.
 * Replaces the sans-bold headings that made every section look like a widget.
 */
function SectionMark({ label, title, note, action }: {
  label: string; title: string; note?: string; action?: React.ReactNode;
}) {
  return (
    <div className="rule pt-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="smallcaps text-stone-400 dark:text-stone-500">{label}</p>
          <h2 className="mt-4 font-display text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-stone-900 sm:text-5xl dark:text-ivory-50">
            {title}
          </h2>
          {note && (
            <p className="mt-4 max-w-md text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              {note}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

/** Horizontal editorial rail. */
function Rail({ products }: { products: Product[] }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-6 lg:gap-10">
        {products.map((p, i) => (
          <div key={p._id} className="w-[68vw] shrink-0 sm:w-[300px] lg:w-[340px]">
            <ProductCard product={p} index={i} variant="editorial" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Filter controls. One component, used by the single drawer at every breakpoint. */
function FilterPanel({
  categories, selectedCategory, onCategory,
  minPrice, setMinPrice, maxPrice, setMaxPrice,
  inStock, setInStock, onSale, toggleOnSale, setPage,
}: {
  categories: Category[];
  selectedCategory: string;
  onCategory: (id: string) => void;
  minPrice: string; setMinPrice: (v: string) => void;
  maxPrice: string; setMaxPrice: (v: string) => void;
  inStock: boolean; setInStock: (v: boolean) => void;
  onSale: boolean; toggleOnSale: () => void;
  setPage: (n: number) => void;
}) {
  const row = (active: boolean) =>
    `w-full py-2.5 text-left text-sm transition-colors ${
      active
        ? 'font-medium text-stone-900 dark:text-ivory-50'
        : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-ivory-50'
    }`;

  return (
    <div className="divide-y divide-ivory-200 dark:divide-stone-800">
      <div className="px-6 py-7">
        <p className="smallcaps mb-4 flex items-center gap-2 text-stone-400">
          <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
          Category
        </p>
        <ul>
          <li>
            <button onClick={() => onCategory('')} aria-current={!selectedCategory ? 'true' : undefined} className={row(!selectedCategory)}>
              All products
            </button>
          </li>
          {categories.map(cat => (
            <li key={cat._id}>
              <button
                onClick={() => onCategory(cat._id)}
                aria-current={selectedCategory === cat._id ? 'true' : undefined}
                style={cat.level > 0 ? { paddingLeft: `${cat.level * 0.85}rem` } : undefined}
                className={row(selectedCategory === cat._id)}
              >
                {cat.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-6 py-7">
        <p className="smallcaps mb-4 flex items-center gap-2 text-stone-400">
          <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
          Price
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number" placeholder="Min" aria-label="Minimum price" value={minPrice}
            onChange={e => { setMinPrice(e.target.value); setPage(1); }}
            className="w-full border-0 border-b border-ivory-300 bg-transparent pb-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 dark:border-stone-700 dark:text-ivory-50 dark:focus:border-ivory-200"
          />
          <span className="text-stone-300" aria-hidden="true">—</span>
          <input
            type="number" placeholder="Max" aria-label="Maximum price" value={maxPrice}
            onChange={e => { setMaxPrice(e.target.value); setPage(1); }}
            className="w-full border-0 border-b border-ivory-300 bg-transparent pb-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 dark:border-stone-700 dark:text-ivory-50 dark:focus:border-ivory-200"
          />
        </div>
      </div>

      <div className="px-6 py-7">
        <p className="smallcaps mb-4 flex items-center gap-2 text-stone-400">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Refine
        </p>
        <label className="group flex w-fit cursor-pointer items-center gap-3 py-1">
          <input
            type="checkbox" checked={inStock}
            onChange={e => { setInStock(e.target.checked); setPage(1); }}
            className="h-[18px] w-[18px] rounded-none border-stone-300 text-stone-900 focus:ring-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-ivory-50"
          />
          <span className="text-sm text-stone-600 transition-colors group-hover:text-stone-900 dark:text-stone-300 dark:group-hover:text-ivory-50">
            In stock only
          </span>
        </label>
        <button
          onClick={toggleOnSale}
          aria-pressed={onSale}
          className={`mt-5 flex w-full items-center justify-center gap-2 border py-3 text-[11px] font-medium uppercase tracking-[0.22em] transition-colors ${
            onSale
              ? 'border-stone-900 bg-stone-900 text-white dark:border-ivory-50 dark:bg-ivory-50 dark:text-stone-900'
              : 'border-ivory-300 text-stone-600 hover:border-stone-900 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-ivory-200 dark:hover:text-ivory-50'
          }`}
        >
          <Flame className="h-3.5 w-3.5" aria-hidden="true" />
          {onSale ? 'Hide offers' : 'Offers only'}
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStock, setInStock] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [sortBy, setSortBy] = useState('');
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [subscribing, setSubscribing] = useState(false);

  // Read URL params on mount and when they change
  useEffect(() => {
    const searchParam = searchParams.get('search') || '';
    const categoryParam = searchParams.get('category') || '';
    const minPriceParam = searchParams.get('minPrice') || '';
    const maxPriceParam = searchParams.get('maxPrice') || '';
    const inStockParam = searchParams.get('inStock') === 'true';
    const onSaleParam = searchParams.get('onSale') === 'true';
    const sortByParam = searchParams.get('sortBy') || '';

    if (searchParam !== searchInput) setSearchInput(searchParam);
    if (categoryParam !== selectedCategory) setSelectedCategory(categoryParam);
    if (minPriceParam !== minPrice) setMinPrice(minPriceParam);
    if (maxPriceParam !== maxPrice) setMaxPrice(maxPriceParam);
    if (inStockParam !== inStock) setInStock(inStockParam);
    if (onSaleParam !== onSale) setOnSale(onSaleParam);
    if (sortByParam !== sortBy) setSortBy(sortByParam);
    setPage(1);
  }, [searchParams]);

  // 300ms debounce — API only fires after the user stops typing
  const debouncedSearch = useDebounce(searchInput, 300);

  // Reset to page 1 whenever the debounced term changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  // ── React Query — replaces useState + useEffect + manual loading ──────────
  const { data: productPage, isLoading: loading, isPlaceholderData } = useProducts({
    page,
    limit: 12,
    search: debouncedSearch || undefined,
    category: selectedCategory || undefined,
    minPrice: minPrice ? Number(minPrice) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    inStock: inStock || undefined,
    onSale: onSale || undefined,
    sortBy: sortBy || undefined,
  });

  const products = productPage?.data ?? [];
  const total = productPage?.total ?? 0;
  const totalPages = productPage?.totalPages ?? 1;

  useEffect(() => {
    categoriesApi.list().then(res => setCategories(res.data.data));
  }, []);

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setPage(1);
  };

  const handleReset = () => {
    setSearchInput(''); setSelectedCategory('');
    setMinPrice(''); setMaxPrice(''); setInStock(false); setOnSale(false); setSortBy(''); setPage(1);
  };

  const handleNewsletterSubscribe = async () => {
    if (!newsletterEmail) {
      toast.error('Please enter your email');
      return;
    }

    setSubscribing(true);
    try {
      const res = await newsletterApi.subscribe(newsletterEmail);
      toast.success(res.data.message || 'Thanks for subscribing!');
      setNewsletterEmail('');
    } catch (err: any) {
      const message = err.response?.data?.message || 'Failed to subscribe';
      toast.error(message);
    } finally {
      setSubscribing(false);
    }
  };

  const { isAuthenticated } = useAppSelector(s => s.auth);

  // Same derivations as before — both read from the current page of results.
  const deals = useMemo(() => products.filter(p => p.discount > 0).slice(0, 8), [products]);
  const topRated = useMemo(
    () => products.filter(p => p.averageRating >= 4).sort((a, b) => b.averageRating - a.averageRating).slice(0, 8),
    [products]
  );

  const activeFilterCount =
    (selectedCategory ? 1 : 0) + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) +
    (inStock ? 1 : 0) + (onSale ? 1 : 0) + (searchInput ? 1 : 0);

  const toggleOnSale = () => { setOnSale(!onSale); setSelectedCategory(''); setPage(1); };

  const activeCategoryName =
    categories.find(c => c._id === selectedCategory)?.name ?? 'All products';

  return (
    <div className="min-h-screen bg-ivory-50 font-sans text-stone-900 dark:bg-stone-950 dark:text-ivory-50">
      <h1 className="sr-only">Shop all products</h1>

      {/* ── Hero, edge to edge ───────────────────────────────────────────────── */}
      <HeroCarousel
        fullBleed
        stats={[
          ...(total > 0 ? [{ value: total, label: 'Products' }] : []),
          ...(categories.length > 0 ? [{ value: categories.length, label: 'Categories' }] : []),
        ]}
      />

      {/* ── Statement ────────────────────────────────────────────────────────
          A held pause between the hero and the merchandise. Luxury sites earn
          attention with space before they ask for a click. Copy is descriptive
          only — no invented provenance or guarantees. */}
      <Section className="pt-20 lg:pt-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="smallcaps text-stone-400 dark:text-stone-500">The collection</p>
          <p className="mt-7 font-display text-3xl font-light leading-[1.25] tracking-[-0.01em] text-stone-800 sm:text-[2.75rem] dark:text-ivory-100">
            A considered selection across {categories.length || 'every'} categor
            {categories.length === 1 ? 'y' : 'ies'} — browse the full catalogue,
            or narrow it to exactly what you came for.
          </p>
        </div>
      </Section>

      {/* ── Categories as an index ───────────────────────────────────────────
          Set as a typographic index rather than chips or tiles. Large type on
          hairlines is how editorial retail presents a department list. */}
      {categories.length > 0 && (
        <Section className="pt-20 lg:pt-28">
          <SectionMark
            label="Browse"
            title="Departments"
            action={
              <button onClick={() => handleCategoryChange('')} className="smallcaps link-underline text-stone-500 dark:text-stone-400">
                View all
              </button>
            }
          />
          <ul className="mt-12 grid grid-cols-1 gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map(cat => {
              const active = selectedCategory === cat._id;
              return (
                <li key={cat._id} className="rule">
                  <button
                    onClick={() => handleCategoryChange(cat._id)}
                    aria-pressed={active}
                    className="group flex w-full items-baseline justify-between gap-4 py-6 text-left"
                  >
                    <span className={`font-display text-2xl transition-colors sm:text-3xl ${
                      active ? 'text-stone-900 dark:text-ivory-50' : 'text-stone-500 group-hover:text-stone-900 dark:text-stone-400 dark:group-hover:text-ivory-50'
                    }`}>
                      {cat.name}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 -translate-x-1 text-stone-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 dark:text-stone-600"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* ── Deals ────────────────────────────────────────────────────────────
          Same derivation as before (current page, discount > 0). */}
      {deals.length > 0 && (
        <Section className="pt-24 lg:pt-32">
          <SectionMark
            label="Reduced"
            title="Currently on offer"
            note="Discounted pieces from the current selection."
            action={
              <button onClick={toggleOnSale} className="smallcaps link-underline text-stone-500 dark:text-stone-400">
                {onSale ? 'Hide offers' : 'See all offers'}
              </button>
            }
          />
          <div className="mt-12"><Rail products={deals} /></div>
        </Section>
      )}

      {/* ── Catalogue ────────────────────────────────────────────────────────
          `data-products-section` is the hero CTA's scroll target — preserved. */}
      <Section className="pt-24 lg:pt-32" id="catalogue">
        <div data-products-section>
          <SectionMark label="Catalogue" title={activeCategoryName} />

          {/* Toolbar: a hairline strip, not a filled bar. Filters live in a
              drawer at every breakpoint — the permanent rail is a marketplace
              convention, and hiding it is most of what buys the whitespace. */}
          <div className="rule mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 py-5">
            <button
              onClick={() => setFiltersOpen(true)}
              className="smallcaps group flex items-center gap-2.5 text-stone-900 dark:text-ivory-50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Filter
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-stone-900 px-1.5 text-[10px] font-semibold text-white dark:bg-ivory-50 dark:text-stone-900">
                  {activeFilterCount}
                </span>
              )}
            </button>

            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search"
                aria-label="Filter products in catalogue"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-full border-0 border-b border-transparent bg-transparent py-1.5 pl-7 pr-7 text-sm outline-none transition-colors placeholder:text-stone-400 hover:border-ivory-300 focus:border-stone-900 dark:hover:border-stone-700 dark:focus:border-ivory-200"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-stone-400 transition-colors hover:text-stone-900 dark:hover:text-ivory-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <p className="smallcaps hidden tabular-nums text-stone-400 sm:block">
              {total} item{total !== 1 ? 's' : ''}
            </p>

            <div className="ml-auto flex items-center gap-6">
              {activeFilterCount > 0 && (
                <button onClick={handleReset} className="smallcaps link-underline text-stone-500 dark:text-stone-400">
                  Clear
                </button>
              )}
              <label htmlFor="sort" className="sr-only">Sort by</label>
              <select
                id="sort"
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                className="cursor-pointer border-0 bg-transparent py-1 pr-6 text-[11px] font-medium uppercase tracking-[0.22em] text-stone-900 outline-none focus:ring-0 dark:text-ivory-50"
              >
                <option value="">Sort</option>
                <option value="price_asc">Price ascending</option>
                <option value="price_desc">Price descending</option>
                <option value="rating">Highest rated</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>

          {/* Grid — three across at desktop. Fewer, larger frames. */}
          <div className="mt-14">
            {loading ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-14 lg:grid-cols-3 lg:gap-x-10">
                {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : products.length === 0 ? (
              <div className="rule flex flex-col items-center px-6 py-28 text-center">
                <Search className="mb-8 h-7 w-7 text-stone-300 dark:text-stone-600" strokeWidth={1} aria-hidden="true" />
                <h3 className="font-display text-3xl font-normal text-stone-900 dark:text-ivory-50">
                  Nothing matches
                </h3>
                <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  Try widening the price range, or clear the filters to see the full catalogue.
                </p>
                <button
                  onClick={handleReset}
                  className="smallcaps mt-9 border border-stone-900 px-8 py-3.5 text-stone-900 transition-colors hover:bg-stone-900 hover:text-white dark:border-ivory-200 dark:text-ivory-50 dark:hover:bg-ivory-50 dark:hover:text-stone-900"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className={`grid grid-cols-2 gap-x-6 gap-y-14 transition-opacity duration-200 lg:grid-cols-3 lg:gap-x-10 ${isPlaceholderData ? 'opacity-50' : 'opacity-100'}`}>
                {products.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} variant="editorial" />
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <nav className="rule mt-20 flex items-center justify-between pt-8" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="smallcaps flex items-center gap-2 text-stone-900 transition-opacity disabled:pointer-events-none disabled:opacity-30 dark:text-ivory-50"
                >
                  <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
                  Previous
                </button>
                <span className="smallcaps tabular-nums text-stone-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="smallcaps flex items-center gap-2 text-stone-900 transition-opacity disabled:pointer-events-none disabled:opacity-30 dark:text-ivory-50"
                >
                  Next
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </nav>
            )}
          </div>
        </div>
      </Section>

      {/* ── Top rated ────────────────────────────────────────────────────────── */}
      {topRated.length > 0 && (
        <Section className="pt-24 lg:pt-32">
          <SectionMark
            label="Acclaimed"
            title="Most admired"
            note="Rated four stars and above by verified buyers."
            action={
              <button onClick={() => { setSortBy('rating'); setPage(1); }} className="smallcaps link-underline text-stone-500 dark:text-stone-400">
                Sort by rating
              </button>
            }
          />
          <div className="mt-12"><Rail products={topRated} /></div>
        </Section>
      )}

      {/* ── Vendor CTA ───────────────────────────────────────────────────────
          Unauthenticated only — unchanged condition, links and copy. */}
      {!isAuthenticated && (
        <Section className="pt-24 lg:pt-32">
          <div className="bg-stone-900 px-8 py-20 text-center sm:px-16 lg:py-28">
            <p className="smallcaps text-amber-400/80">For entrepreneurs</p>
            <h2 className="mx-auto mt-7 max-w-2xl font-display text-4xl font-normal leading-[1.1] text-white sm:text-5xl">
              Launch your own online store — free
            </h2>
            <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-stone-400">
              Set up in minutes. No credit card required. Full 7-day free trial.
            </p>
            <div className="mt-11 flex flex-col items-center justify-center gap-6 sm:flex-row">
              <Link
                to="/start"
                className="smallcaps border border-white bg-white px-10 py-4 text-stone-900 transition-colors hover:bg-transparent hover:text-white"
              >
                Start free trial
              </Link>
              <Link to="/login" className="smallcaps link-underline text-stone-400 hover:text-white">
                Sign in
              </Link>
            </div>
          </div>
        </Section>
      )}

      {/* ── Newsletter ───────────────────────────────────────────────────────── */}
      <Section className="py-24 lg:py-36">
        <div className="rule mx-auto max-w-xl pt-14 text-center">
          <p className="smallcaps text-stone-400 dark:text-stone-500">Correspondence</p>
          <h2 className="mt-6 font-display text-4xl font-normal leading-[1.1] text-stone-900 sm:text-5xl dark:text-ivory-50">
            Never miss a drop
          </h2>
          <p className="mx-auto mt-5 max-w-sm text-sm leading-relaxed text-stone-500 dark:text-stone-400">
            Subscribe to get special offers and updates.
          </p>
          <form
            onSubmit={e => { e.preventDefault(); handleNewsletterSubscribe(); }}
            className="mx-auto mt-10 flex max-w-md items-end gap-4"
          >
            <input
              type="email"
              placeholder="you@example.com"
              aria-label="Email address for newsletter"
              value={newsletterEmail}
              onChange={(e) => setNewsletterEmail(e.target.value)}
              className="min-w-0 flex-1 border-0 border-b border-ivory-300 bg-transparent pb-3 text-center text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 sm:text-left dark:border-stone-700 dark:text-ivory-50 dark:focus:border-ivory-200"
            />
            <button
              type="submit"
              disabled={subscribing}
              aria-busy={subscribing}
              className="smallcaps shrink-0 border border-stone-900 px-7 py-3.5 text-stone-900 transition-colors hover:bg-stone-900 hover:text-white disabled:opacity-50 dark:border-ivory-200 dark:text-ivory-50 dark:hover:bg-ivory-50 dark:hover:text-stone-900"
            >
              {subscribing ? 'Sending' : 'Subscribe'}
            </button>
          </form>
        </div>
      </Section>

      {/* ── Filter drawer ────────────────────────────────────────────────────
          One drawer for every breakpoint — the mobile sheet and desktop rail
          used to be duplicated markup that had already drifted apart. */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filters">
          <div
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            onClick={() => setFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-ivory-50 shadow-float dark:bg-stone-950">
            <div className="flex items-center justify-between border-b border-ivory-200 px-6 py-5 dark:border-stone-800">
              <p className="smallcaps text-stone-900 dark:text-ivory-50">Filter</p>
              <button
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
                className="flex h-10 w-10 items-center justify-center text-stone-500 transition-colors hover:text-stone-900 dark:hover:text-ivory-50"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <FilterPanel
                categories={categories}
                selectedCategory={selectedCategory}
                onCategory={(id) => { handleCategoryChange(id); setFiltersOpen(false); }}
                minPrice={minPrice} setMinPrice={setMinPrice}
                maxPrice={maxPrice} setMaxPrice={setMaxPrice}
                inStock={inStock} setInStock={setInStock}
                onSale={onSale} toggleOnSale={toggleOnSale}
                setPage={setPage}
              />
            </div>

            <div className="flex items-center gap-4 border-t border-ivory-200 p-6 dark:border-stone-800">
              <button
                onClick={handleReset}
                className="smallcaps flex items-center gap-2 text-stone-500 transition-colors hover:text-stone-900 dark:hover:text-ivory-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
              <button
                onClick={() => setFiltersOpen(false)}
                className="smallcaps ml-auto border border-stone-900 px-8 py-3.5 text-stone-900 transition-colors hover:bg-stone-900 hover:text-white dark:border-ivory-200 dark:text-ivory-50 dark:hover:bg-ivory-50 dark:hover:text-stone-900"
              >
                Show {total}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
