import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, Package, X } from 'lucide-react';
import { wishlistApi } from '../api/wishlist';
import { cartApi } from '../api/cart';
import { setCart } from '../store/cartSlice';
import { removeFromWishlist } from '../store/wishlistSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import toast from 'react-hot-toast';
import StarRating from '../components/StarRating';

export default function WishlistPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector(s => s.wishlist.items);
  const [movingId, setMovingId] = useState('');
  const [removingId, setRemovingId] = useState('');

  const handleRemove = async (productId: string) => {
    setRemovingId(productId);
    try {
      await wishlistApi.remove(productId);
      dispatch(removeFromWishlist(productId));
      toast('Removed from wishlist');
    } finally {
      setRemovingId('');
    }
  };

  const handleMoveToCart = async (productId: string) => {
    setMovingId(productId);
    try {
      await wishlistApi.moveToCart(productId);
      dispatch(removeFromWishlist(productId));
      const cartRes = await cartApi.get();
      dispatch(setCart(cartRes.data.data));
      toast.success('Moved to cart!');
    } finally {
      setMovingId('');
    }
  };

  if (items.length === 0) return (
    <div className="max-w-3xl mx-auto px-4 py-24 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
        <Heart className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Your wishlist is empty</h2>
      <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        Tap the heart on any product to save it here for later.
      </p>
      <button onClick={() => navigate('/')} className="btn btn-brand btn-lg">Browse Products</button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Wishlist <span className="text-base font-normal text-gray-400">({items.length} item{items.length !== 1 ? 's' : ''})</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((p, i) => (
          <motion.div
            key={p._id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3, delay: i * 0.04 }}
            className="card overflow-hidden"
          >
            <Link to={`/products/${p._id}`} className="block">
              <div className="aspect-square bg-gray-100 dark:bg-gray-800 overflow-hidden">
                {p.images[0] ? (
                  <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600"><Package className="h-8 w-8" strokeWidth={1.25} aria-hidden="true" /></div>
                )}
              </div>
            </Link>

            <div className="p-3">
              <Link to={`/products/${p._id}`} className="font-medium text-gray-900 dark:text-white hover:text-primary-600 block truncate text-sm">
                {p.name}
              </Link>
              <div className="flex items-center gap-1 mt-0.5">
                <StarRating rating={p.averageRating} size="sm" />
              </div>
              <p className="text-base font-bold text-gray-900 dark:text-white mt-1">${p.price.toFixed(2)}</p>

              <div className="flex gap-1.5 mt-3">
                <button
                  onClick={() => handleMoveToCart(p._id)}
                  disabled={movingId === p._id || p.stock === 0}
                  className="btn-primary flex-1 text-xs py-1.5"
                >
                  {movingId === p._id ? '…' : p.stock === 0 ? 'Out of Stock' : 'Move to Cart'}
                </button>
                <button
                  onClick={() => handleRemove(p._id)}
                  disabled={removingId === p._id}
                  className="btn btn-secondary px-2.5"
                  aria-label="Remove from wishlist"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
