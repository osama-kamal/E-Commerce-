/**
 * StorefrontHomePage  (/s/:slug)
 *
 * Public product catalog for a specific tenant store. Uses the storefront-scoped
 * Axios instance from StorefrontContext so all API calls carry X-Store-Slug.
 */

import { useEffect, useState } from 'react';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useDebounce } from '../../hooks/useDebounce';
import ProductCard from '../../components/ProductCard';
import { ProductCardSkeleton } from '../../components/Skeleton';
import { Category, Product, PaginatedResponse } from '../../types';

export default function StorefrontHomePage() {
  const { store, sfApi, slug } = useStorefront();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStock, setInStock] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [sortBy, setSortBy] = useState('');

  // Track whether the user has applied any active filter
  const hasActiveFilters = !!(searchInput || selectedCategory || minPrice || maxPrice || inStock || onSale);

  const debouncedSearch = useDebounce(searchInput, 300);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

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

    const params: Record<string, string | number | boolean> = { page, limit: 12 };
    if (debouncedSearch) params.search = debouncedSearch;
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
  }, [sfApi, page, debouncedSearch, selectedCategory, minPrice, maxPrice, inStock, sortBy]);

  const handleReset = () => {
    setSearchInput(''); setSelectedCategory('');
    setMinPrice(''); setMaxPrice(''); setInStock(false); setOnSale(false); setSortBy(''); setPage(1);
  };

  // ── Empty state copy — distinguishes "store is empty" from "no filter match" ─
  const EmptyState = () => {
    if (fetchError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center card">
          <p className="text-5xl mb-4">⚠️</p>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Could not load products
          </h3>
          <p className="text-sm text-gray-400 mb-2">{fetchError}</p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mb-6 font-mono">
            Store slug: {slug}
          </p>
          <button onClick={() => { setPage(1); setFetchError(null); }} className="btn-primary px-6">
            Retry
          </button>
        </div>
      );
    }

    if (hasActiveFilters) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center card">
          <p className="text-5xl mb-4">🔍</p>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">
            No products match your filters
          </h3>
          <p className="text-sm text-gray-400 mb-6">
            Try adjusting or clearing your search and filters.
          </p>
          <button onClick={handleReset} className="btn-primary px-6">Clear Filters</button>
        </div>
      );
    }

    // Store exists but has no products at all
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center card">
        <p className="text-6xl mb-4">🏪</p>
        <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
          {store.name} is setting up
        </h3>
        <p className="text-sm text-gray-400 max-w-sm">
          This store hasn't listed any products yet. Check back soon!
        </p>
      </div>
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Store header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{store.name}</h1>
        {store.settings?.contactEmail && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{store.settings.contactEmail}</p>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-8">
        <div className="relative flex-1 max-w-2xl mx-auto">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search products…"
            className="input pl-9 w-full"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Clear search"
            >×</button>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar filters — only show if there are categories or products */}
        {(categories.length > 0 || total > 0) && (
          <aside className="w-56 shrink-0 hidden lg:block">
            <div className="sticky top-20 space-y-4">
              {/* Categories */}
              {categories.length > 0 && (
                <div className="card p-4">
                  <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <span>📂</span> Categories
                  </h3>
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    <li>
                      <button
                        onClick={() => { setSelectedCategory(''); setPage(1); }}
                        className={`text-sm w-full text-left px-3 py-2 rounded-lg transition-all ${
                          !selectedCategory ? 'bg-primary-500 text-white font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >All Products</button>
                    </li>
                    {categories.map(cat => (
                      <li key={cat._id}>
                        <button
                          onClick={() => { setSelectedCategory(cat._id); setPage(1); }}
                          className={`text-sm w-full text-left px-3 py-2 rounded-lg transition-all ${
                            selectedCategory === cat._id ? 'bg-primary-500 text-white font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {cat.level > 0 && <span className="mr-1 text-gray-400">└</span>}
                          {cat.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Price range */}
              <div className="card p-4">
                <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <span>💰</span> Price
                </h3>
                <div className="flex gap-2">
                  <input type="number" placeholder="Min" className="input text-sm" value={minPrice}
                    onChange={e => { setMinPrice(e.target.value); setPage(1); }} />
                  <input type="number" placeholder="Max" className="input text-sm" value={maxPrice}
                    onChange={e => { setMaxPrice(e.target.value); setPage(1); }} />
                </div>
              </div>

              {/* Filters */}
              <div className="card p-4">
                <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <span>⚙️</span> Filters
                </h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={inStock} className="rounded text-primary-600"
                      onChange={e => { setInStock(e.target.checked); setPage(1); }} />
                    <span className="text-sm text-gray-700 dark:text-gray-300">In stock only</span>
                  </label>
                  <button
                    onClick={() => { setOnSale(!onSale); setPage(1); }}
                    className={`w-full text-sm px-4 py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                      onSale
                        ? 'bg-red-500 text-white'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                    }`}
                  >
                    <span>🔥</span>
                    <span>{onSale ? 'Hide Offers' : 'Show Offers'}</span>
                  </button>
                </div>
              </div>

              {hasActiveFilters && (
                <button onClick={handleReset} className="btn-secondary w-full text-sm">
                  🔄 Reset Filters
                </button>
              )}
            </div>
          </aside>
        )}

        {/* Product grid */}
        <div className="flex-1 min-w-0">
          {/* Sort bar — only show when there are products */}
          {!loading && total > 0 && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                {total} product{total !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor="sf-sort" className="text-sm text-gray-600 dark:text-gray-400">Sort:</label>
                <select
                  id="sf-sort"
                  value={sortBy}
                  onChange={e => { setSortBy(e.target.value); setPage(1); }}
                  className="input text-sm py-1.5 px-3 w-auto"
                >
                  <option value="">Default</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="rating">Highest Rated</option>
                  <option value="newest">Newest First</option>
                </select>
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : products.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-4 disabled:opacity-50">←</button>
              <span className="flex items-center text-sm text-gray-600 dark:text-gray-400 font-medium px-4">
                Page {page} of {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-4 disabled:opacity-50">→</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
