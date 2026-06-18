import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Product } from '../types';
import StarRating from './StarRating';
import QuickViewModal from './QuickViewModal';
import { wishlistApi } from '../api/wishlist';
import { addToWishlist, removeFromWishlist } from '../store/wishlistSlice';
import { addToComparison, removeFromComparison } from '../store/comparisonSlice';
import { addNotification } from '../store/notificationSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { useAddToCart } from '../hooks/useCart';
import toast from 'react-hot-toast';

interface Props {
  product: Product;
  index?: number;
  detailPath?: string;   // override the default /products/:id link (e.g. for storefront routes)
  loginRedirect?: string; // override the /login redirect (e.g. /s/slug for storefront)
}

export default function ProductCard({ product, index = 0, detailPath, loginRedirect }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isInWishlist = useAppSelector((s) =>
    s.wishlist.items.some(i => i._id === product._id)
  );
  const isInComparison = useAppSelector((s) =>
    s.comparison.products.some(p => p._id === product._id)
  );
  const comparisonCount = useAppSelector((s) => s.comparison.products.length);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [qty, setQty] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  // ── React Query optimistic cart mutation ───────────────────────────────────
  const addToCart = useAddToCart();

  const image = product.images?.[0] ?? null;
  const isOutOfStock = product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 3;
  const hasDiscount = product.discount > 0;
  const discountedPrice = hasDiscount ? product.price * (1 - product.discount / 100) : product.price;
  const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;
  const needsSize = hasSizes && !selectedSize; // true when size required but not chosen

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate(loginRedirect ? `/login?redirect=${encodeURIComponent(loginRedirect)}` : '/login');
      return;
    }
    if (needsSize) return; // guard: size required but not selected
    if (isAdding) return; // synchronous guard — blocks any click that arrives before re-render
    setIsAdding(true);
    try {
      const addedQty = qty; // capture before reset
      await addToCart.mutateAsync({
        productId: product._id,
        quantity: addedQty,
        productName: product.name,
        selectedSize: selectedSize ?? undefined,
      });
      setQty(1);
      dispatch(addNotification({
        type: 'success',
        title: 'Added to Cart',
        message: `${addedQty > 1 ? `${addedQty}× ` : ''}${product.name}${selectedSize ? ` (${selectedSize})` : ''} added to your cart`,
        actionUrl: '/cart',
      }));
    } catch {
      // error toast is already shown by the axios interceptor
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate(loginRedirect ? `/login?redirect=${encodeURIComponent(loginRedirect)}` : '/login');
      return;
    }
    setWishlistLoading(true);
    try {
      if (isInWishlist) {
        await wishlistApi.remove(product._id);
        dispatch(removeFromWishlist(product._id));
        toast('Removed from wishlist', { icon: '💔' });
      } else {
        await wishlistApi.add(product._id);
        dispatch(addToWishlist({
          _id: product._id,
          name: product.name,
          price: product.price,
          images: product.images,
          stock: product.stock,
          averageRating: product.averageRating,
        }));
        toast.success('Added to wishlist!');
        dispatch(addNotification({
          type: 'info',
          title: 'Added to Wishlist',
          message: `${product.name} has been added to your wishlist`,
          actionUrl: '/wishlist',
        }));
      }
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleToggleComparison = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isInComparison) {
      dispatch(removeFromComparison(product._id));
      toast('Removed from comparison', { icon: '📊' });
    } else {
      if (comparisonCount >= 4) {
        toast.error('Maximum 4 products can be compared');
        e.target.checked = false;
        return;
      }
      dispatch(addToComparison(product));
      toast.success('Added to comparison!');
    }
  };

  return (
    <>
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.15 }}
        className="card rounded-2xl overflow-hidden cursor-pointer shadow-sm hover:shadow-md hover:shadow-amber-100 hover:bg-amber-50/30 border border-amber-100 transition-all duration-300 group"
      >
      <Link to={detailPath ?? `/products/${product._id}`} className="block">
        <div className="relative aspect-square bg-gray-100 dark:bg-gray-800 overflow-hidden">
          {!imgLoaded && <div className="absolute inset-0 shimmer" />}
          {image ? (
            <img
              src={image}
              alt={product.name}
              loading="lazy"
              decoding="async"
              width="400"
              height="400"
              onLoad={() => setImgLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-4xl">📦</div>
          )}

          {/* Stock badges */}
          {isOutOfStock && (
            <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
              Out of Stock
            </span>
          )}
          {!isOutOfStock && hasDiscount && (
            <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-lg">
              -{product.discount}% OFF
            </span>
          )}
          {!isOutOfStock && !hasDiscount && isLowStock && (
            <span className="absolute top-2 left-2 bg-orange-400 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
              Only {product.stock} left
            </span>
          )}

          {/* Heart button */}
          <button
            onClick={handleToggleWishlist}
            disabled={wishlistLoading}
            className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-base shadow transition-all ${
              isInWishlist
                ? 'bg-red-500 text-white'
                : 'bg-white/80 dark:bg-gray-800/80 text-gray-400 hover:text-red-500'
            }`}
            aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            {isInWishlist ? '♥' : '♡'}
          </button>

          {/* Quick View button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              setShowQuickView(true);
            }}
            className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 shadow transition-all opacity-0 group-hover:opacity-100"
            aria-label="Quick view"
          >
            👁️
          </button>
        </div>

        <div className="p-4">
          <h3 className="font-medium text-gray-900 dark:text-white truncate">{product.name}</h3>
          <div className="flex items-center gap-1 mt-1">
            <StarRating rating={product.averageRating} size="sm" />
            <span className="text-xs text-gray-500">({product.reviewCount})</span>
          </div>
          {/* Row 1 — Price only, full width, never competes for space */}
          <div className="mt-3">
            {hasDiscount ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                  ${discountedPrice.toFixed(2)}
                </span>
                <span className="text-sm text-gray-400 line-through">
                  ${product.price.toFixed(2)}
                </span>
              </div>
            ) : (
              <span className="text-lg font-semibold text-amber-900 dark:text-amber-300">
                ${product.price.toFixed(2)}
              </span>
            )}
          </div>

          {/* Size selector — only shown when product has variants */}
          {hasSizes && !isOutOfStock && (
            <div className="mt-2">
              {/* flex-nowrap + overflow-hidden keeps all buttons on one line regardless of count */}
              <div className="flex flex-nowrap gap-1 overflow-hidden">
                {product.sizes.map(size => (
                  <button
                    key={size}
                    onClick={(e) => { e.preventDefault(); setSelectedSize(s => s === size ? null : size); }}
                    className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                      selectedSize === size
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-amber-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-amber-400'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {needsSize && (
                <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">⚠ pick one</p>
              )}
            </div>
          )}

          {/* Action footer — identical vertical stack for ALL cards */}
          <div className="mt-2">
            {isOutOfStock ? (
              <div className="w-full text-center text-xs font-medium text-red-500 py-1.5 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
                Out of Stock
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Row 1 — Quantity selector centred on its own line */}
                <div className="flex items-center justify-center border border-amber-200 dark:border-gray-600 rounded-lg">
                  <button
                    onClick={(e) => { e.preventDefault(); setQty(q => Math.max(1, q - 1)); }}
                    disabled={qty <= 1}
                    aria-label="Decrease quantity"
                    className="px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-gray-800 rounded-l-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={product.stock}
                    value={qty}
                    onClick={(e) => e.preventDefault()}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) setQty(Math.min(product.stock, Math.max(1, v)));
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isNaN(v) || v < 1) setQty(1);
                    }}
                    className="w-12 py-1.5 text-sm font-semibold text-gray-900 dark:text-white text-center bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="Quantity"
                  />
                  <button
                    onClick={(e) => { e.preventDefault(); setQty(q => Math.min(product.stock, q + 1)); }}
                    disabled={qty >= product.stock}
                    aria-label="Increase quantity"
                    className="px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-gray-800 rounded-r-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>

                {/* Row 2 — Full-width Add to Cart button */}
                <button
                  onClick={handleAddToCart}
                  disabled={!isAuthenticated || isAdding || needsSize}
                  aria-disabled={needsSize}
                  title={isAdding ? 'Adding…' : needsSize ? 'Select a size first' : 'Add to Cart'}
                  className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-white shadow-sm transition-all disabled:cursor-not-allowed ${
                    needsSize
                      ? 'bg-gray-400 dark:bg-gray-600 shadow-none opacity-70'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 shadow-amber-200 disabled:opacity-50'
                  }`}
                >
                  {isAdding ? (
                    <>
                      <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-sm">Adding…</span>
                    </>
                  ) : needsSize ? (
                    <>
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      <span className="text-sm">Select a size</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M10 19a1 1 0 100 2 1 1 0 000-2zm7 0a1 1 0 100 2 1 1 0 000-2z" />
                      </svg>
                      <span className="text-sm">Add to Cart</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Row 3 — Compare checkbox, pinned at bottom with separator */}
          <div className="mt-3 pt-3 border-t border-amber-100 dark:border-gray-700">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={isInComparison}
                onChange={handleToggleComparison}
                className="w-4 h-4 shrink-0 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                Compare
              </span>
            </label>
          </div>
        </div>
      </Link>
    </motion.div>

      <QuickViewModal
        product={product}
        isOpen={showQuickView}
        onClose={() => setShowQuickView(false)}
      />
    </>
  );
}
