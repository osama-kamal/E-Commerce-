import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppSelector } from '../hooks/useAppDispatch';
import { newsletterApi } from '../api/newsletter';
import { categoriesApi } from '../api/categories';
import { Category } from '../types';
import ProductCard from '../components/ProductCard';
import HeroCarousel from '../components/HeroCarousel';
import { ProductCardSkeleton } from '../components/Skeleton';
import { useDebounce } from '../hooks/useDebounce';
import { useProducts } from '../hooks/useProducts';
import toast from 'react-hot-toast';

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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

  return (
    <div className="bg-amber-50/20 dark:bg-gray-900 min-h-screen">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Carousel */}
        <div className="mb-8">
          <HeroCarousel />
        </div>

        {/* Vendor CTA banner — shown only to unauthenticated visitors */}
        {!isAuthenticated && (
          <div className="mb-8 rounded-2xl overflow-hidden bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-px shadow-xl">
            <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="text-xs font-semibold text-indigo-200 uppercase tracking-widest mb-1">For Entrepreneurs</p>
                <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                  Launch your own online store — free
                </h2>
                <p className="text-sm text-indigo-200 mt-1">
                  Set up in minutes. No credit card required. Full 7-day free trial.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Link
                  to="/start"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-indigo-700 font-bold text-sm hover:bg-indigo-50 transition-colors shadow-lg hover:shadow-xl hover:-translate-y-0.5 transform"
                >
                  <span>🚀</span>
                  Start Free Trial
                </Link>
                <Link
                  to="/login"
                  className="text-sm text-indigo-200 hover:text-white font-medium transition-colors"
                >
                  Sign in →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Live search bar */}
        <div className="flex gap-2 mb-8">
          <div className="relative flex-1 max-w-2xl mx-auto">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search by name, description, or category…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-400 transition-shadow"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-6" data-products-section>
          {/* Mobile Filters Button */}
          <button
            onClick={() => setShowMobileFilters(true)}
            className="lg:hidden fixed bottom-20 right-4 z-40 bg-primary-600 text-white p-4 rounded-full shadow-2xl hover:bg-primary-700 transition-all"
            aria-label="Open filters"
          >
            <span className="text-2xl">⚙️</span>
          </button>

          {/* Mobile Filters Modal */}
          {showMobileFilters && (
            <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setShowMobileFilters(false)}>
              <div
                className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-800 rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Filters</h2>
                  <button
                    onClick={() => setShowMobileFilters(false)}
                    className="text-gray-400 hover:text-gray-600 text-2xl"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Categories */}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">📂 Categories</h3>
                    <div className="space-y-1">
                      <button
                        onClick={() => { handleCategoryChange(''); setShowMobileFilters(false); }}
                        className={`text-sm w-full text-left px-3 py-2 rounded-lg ${
                          !selectedCategory ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        All Products
                      </button>
                      {categories.map(cat => (
                        <button
                          key={cat._id}
                          onClick={() => { handleCategoryChange(cat._id); setShowMobileFilters(false); }}
                          className={`text-sm w-full text-left px-3 py-2 rounded-lg ${
                            selectedCategory === cat._id ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {cat.level > 0 && <span className="mr-1">└</span>}
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Price Range */}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">💰 Price Range</h3>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Min"
                        className="input text-sm"
                        value={minPrice}
                        onChange={e => { setMinPrice(e.target.value); setPage(1); }}
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        className="input text-sm"
                        value={maxPrice}
                        onChange={e => { setMaxPrice(e.target.value); setPage(1); }}
                      />
                    </div>
                  </div>

                  {/* Filters */}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">⚙️ Filters</h3>
                    <label className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        checked={inStock}
                        onChange={e => { setInStock(e.target.checked); setPage(1); }}
                        className="rounded"
                      />
                      <span className="text-sm">In stock only</span>
                    </label>
                    <button
                      onClick={() => { setOnSale(!onSale); setSelectedCategory(''); setPage(1); }}
                      className={`w-full text-sm px-4 py-2.5 rounded-lg font-semibold ${
                        onSale ? 'bg-red-500 text-white' : 'bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200'
                      }`}
                    >
                      🔥 {onSale ? 'Hide Offers' : 'Show Offers'}
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-4 border-t">
                    <button onClick={handleReset} className="btn-secondary flex-1">
                      Reset
                    </button>
                    <button onClick={() => setShowMobileFilters(false)} className="btn-primary flex-1">
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* LEFT SIDEBAR - Filters */}
          <aside className="w-64 shrink-0 hidden lg:block">
            <div className="sticky top-20 space-y-4">
              {/* Categories Card */}
              <div className="card p-4 backdrop-blur-md bg-amber-50/50 dark:bg-gray-800/90 border border-amber-100 dark:border-gray-700 shadow-lg">
                <h3 className="font-bold text-amber-800 dark:text-amber-400 mb-3 flex items-center gap-2">
                  <span className="text-amber-600">📂</span> Categories
                </h3>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  <li>
                    <button
                      onClick={() => handleCategoryChange('')}
                      className={`text-sm w-full text-left px-3 py-2 rounded-lg transition-all ${
                        !selectedCategory
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-white font-medium shadow-sm shadow-amber-200'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-amber-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      All Products
                    </button>
                  </li>
                  {categories.map(cat => (
                    <li key={cat._id}>
                      <button
                        onClick={() => handleCategoryChange(cat._id)}
                        className={`text-sm w-full text-left px-3 py-2 rounded-lg transition-all ${
                          selectedCategory === cat._id
                            ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-white font-medium shadow-sm shadow-amber-200'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-amber-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {cat.level > 0 && <span className="mr-1 text-gray-400">└</span>}
                        {cat.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Price Range Card */}
              <div className="card p-4 backdrop-blur-md bg-amber-50/50 dark:bg-gray-800/90 border border-amber-100 dark:border-gray-700 shadow-lg">
                <h3 className="font-bold text-amber-800 dark:text-amber-400 mb-3 flex items-center gap-2">
                  <span className="text-amber-600">💰</span> Price Range
                </h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    className="input text-sm"
                    value={minPrice}
                    onChange={e => { setMinPrice(e.target.value); setPage(1); }}
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    className="input text-sm"
                    value={maxPrice}
                    onChange={e => { setMaxPrice(e.target.value); setPage(1); }}
                  />
                </div>
              </div>

              {/* Filters Card */}
              <div className="card p-4 backdrop-blur-md bg-amber-50/50 dark:bg-gray-800/90 border border-amber-100 dark:border-gray-700 shadow-lg">
                <h3 className="font-bold text-amber-800 dark:text-amber-400 mb-3 flex items-center gap-2">
                  <span className="text-amber-600">⚙️</span> Filters
                </h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={inStock}
                      onChange={e => { setInStock(e.target.checked); setPage(1); }}
                      className="rounded text-primary-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-primary-600">
                      In stock only
                    </span>
                  </label>

                  <button
                    onClick={() => {
                      setOnSale(!onSale);
                      setSelectedCategory('');
                      setPage(1);
                    }}
                    className={`w-full text-sm px-4 py-2.5 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                      onSale
                        ? 'bg-red-500 text-white shadow-lg hover:bg-red-600'
                        : 'bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:from-red-100 hover:to-orange-100'
                    }`}
                  >
                    <span className="text-lg">🔥</span>
                    <span>{onSale ? 'Hide Offers' : 'Show Offers'}</span>
                  </button>
                </div>
              </div>

              {/* Reset Button */}
              <button
                onClick={handleReset}
                className="btn-secondary w-full text-sm shadow-md hover:shadow-lg transition-shadow"
              >
                🔄 Reset All Filters
              </button>
            </div>
          </aside>

          {/* MAIN CONTENT - Product grid */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                {total} product{total !== 1 ? 's' : ''} found
              </p>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-sm text-gray-600 dark:text-gray-400">
                  Sort by:
                </label>
                <select
                  id="sort"
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
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

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center card">
                <p className="text-5xl mb-4">🔍</p>
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  No products found
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  Try adjusting your filters or search term.
                </p>
                <button onClick={handleReset} className="btn-primary px-6">
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-opacity duration-200 ${isPlaceholderData ? 'opacity-60' : 'opacity-100'}`}>
                {products.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary px-4 disabled:opacity-50"
                >
                  ←
                </button>
                <span className="flex items-center text-sm text-gray-600 dark:text-gray-400 font-medium px-4">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn-secondary px-4 disabled:opacity-50"
                >
                  →
                </button>
              </div>
            )}
          </div>

          {/* RIGHT SIDEBAR - Hot Deals & Top Rated */}
          <aside className="w-72 shrink-0 hidden xl:block">
            <div className="sticky top-20 space-y-4">
              {/* Hot Deals Card */}
              <div className="card p-4 backdrop-blur-md bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border border-red-200 dark:border-red-800 shadow-lg">
                <h3 className="font-bold text-red-600 dark:text-red-400 mb-3 flex items-center gap-2">
                  <span className="text-xl">🔥</span> Hot Deals
                </h3>
                <div className="space-y-3">
                  {products
                    .filter(p => p.discount > 0)
                    .slice(0, 3)
                    .map(product => (
                      <a
                        key={product._id}
                        href={`/products/${product._id}`}
                        rel="noreferrer"
                        className="flex gap-3 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50 transition-all group"
                      >
                        <img
                          src={product.images[0]}
                          alt={`${product.name} product image`}
                          loading="lazy"
                          decoding="async"
                          width="64"
                          height="64"
                          className="w-16 h-16 object-cover rounded-lg shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-primary-600">
                            {product.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm font-bold text-red-600 dark:text-red-400">
                              ${(product.price * (1 - product.discount / 100)).toFixed(2)}
                            </span>
                            <span className="text-xs text-gray-400 line-through">
                              ${product.price.toFixed(2)}
                            </span>
                          </div>
                          <span className="inline-block text-xs bg-red-500 text-white px-2 py-0.5 rounded-full mt-1">
                            -{product.discount}% OFF
                          </span>
                        </div>
                      </a>
                    ))}
                  {products.filter(p => p.discount > 0).length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No deals available</p>
                  )}
                </div>
              </div>

              {/* Top Rated Card */}
              <div className="card p-4 backdrop-blur-md bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-yellow-900/20 dark:to-amber-900/20 border border-amber-100 dark:border-yellow-800 shadow-lg">
                <h3 className="font-bold text-amber-700 dark:text-amber-400 mb-3 flex items-center gap-2">
                  <span className="text-xl text-amber-600">⭐</span> Top Rated
                </h3>
                <div className="space-y-3">
                  {products
                    .filter(p => p.averageRating >= 4)
                    .sort((a, b) => b.averageRating - a.averageRating)
                    .slice(0, 3)
                    .map(product => (
                      <a
                        key={product._id}
                        href={`/products/${product._id}`}
                        rel="noreferrer"
                        className="flex gap-3 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50 transition-all group"
                      >
                        <img
                          src={product.images[0]}
                          alt={`${product.name} product image`}
                          loading="lazy"
                          decoding="async"
                          width="64"
                          height="64"
                          className="w-16 h-16 object-cover rounded-lg shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-primary-600">
                            {product.name}
                          </h4>
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-yellow-500">⭐</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">
                              {product.averageRating.toFixed(1)}
                            </span>
                            <span className="text-xs text-gray-400">
                              ({product.reviewCount})
                            </span>
                          </div>
                          <span className="text-sm font-bold text-gray-900 dark:text-white mt-1 block">
                            ${product.price.toFixed(2)}
                          </span>
                        </div>
                      </a>
                    ))}
                  {products.filter(p => p.averageRating >= 4).length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No top rated products</p>
                  )}
                </div>
              </div>

              {/* Newsletter Card */}
              <div className="card p-4 backdrop-blur-md bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border border-amber-100 dark:border-amber-800 shadow-lg">
                <h3 className="font-bold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-2">
                  <span className="text-xl text-amber-600">📧</span> Newsletter
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  Subscribe to get special offers and updates!
                </p>
                <input
                  type="email"
                  placeholder="Your email"
                  className="input text-sm mb-2 w-full"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                />
                <button
                  onClick={handleNewsletterSubscribe}
                  disabled={subscribing}
                  className="w-full text-sm py-2 px-4 rounded-lg font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 shadow-sm shadow-amber-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {subscribing ? 'Subscribing...' : 'Subscribe'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
