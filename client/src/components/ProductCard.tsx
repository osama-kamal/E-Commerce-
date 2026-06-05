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
}

export default function ProductCard({ product, index = 0 }: Props) {
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

  // ── React Query optimistic cart mutation ───────────────────────────────────
  const addToCart = useAddToCart();

  const image = product.images?.[0] ?? null;
  const isOutOfStock = product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 3;
  const hasDiscount = product.discount > 0;
  const discountedPrice = hasDiscount ? product.price * (1 - product.discount / 100) : product.price;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { navigate('/login'); return; }
    addToCart.mutate(
      { productId: product._id, quantity: 1, productName: product.name },
      {
        onSuccess: () => {
          dispatch(addNotification({
            type: 'success',
            title: 'Added to Cart',
            message: `${product.name} has been added to your cart`,
            actionUrl: '/cart',
          }));
        },
      }
    );
  };

  const handleToggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { navigate('/login'); return; }
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
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: index * 0.05, ease: 'easeOut' }}
        whileHover={{ scale: 1.03 }}
        className="card overflow-hidden cursor-pointer shadow-sm hover:shadow-2xl transition-shadow duration-300 group"
      >
      <Link to={`/products/${product._id}`} className="block">
        <div className="relative aspect-square bg-gray-100 dark:bg-gray-800 overflow-hidden">
          {!imgLoaded && <div className="absolute inset-0 shimmer" />}
          {image ? (
            <img
              src={image}
              alt={product.name}
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
                <span className="text-lg font-bold text-red-600 dark:text-red-400">
                  ${discountedPrice.toFixed(2)}
                </span>
                <span className="text-sm text-gray-400 line-through">
                  ${product.price.toFixed(2)}
                </span>
              </div>
            ) : (
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                ${product.price.toFixed(2)}
              </span>
            )}
          </div>

          {/* Row 2 — Full-width action button */}
          <div className="mt-2">
            {isOutOfStock ? (
              <div className="w-full text-center text-xs font-medium text-red-500 py-1.5 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
                Out of Stock
              </div>
            ) : (
              <button
                onClick={handleAddToCart}
                disabled={!isAuthenticated || addToCart.isPending}
                className="btn-primary w-full text-sm py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addToCart.isPending ? 'Adding…' : 'Add to Cart'}
              </button>
            )}
          </div>

          {/* Row 3 — Compare checkbox, pinned at bottom with separator */}
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
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
