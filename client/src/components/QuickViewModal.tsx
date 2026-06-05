import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Product } from '../types';
import StarRating from './StarRating';
import { cartApi } from '../api/cart';
import { wishlistApi } from '../api/wishlist';
import { setCart } from '../store/cartSlice';
import { addToWishlist, removeFromWishlist } from '../store/wishlistSlice';
import { addNotification } from '../store/notificationSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import toast from 'react-hot-toast';

interface Props {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickViewModal({ product, isOpen, onClose }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isInWishlist = useAppSelector((s) =>
    s.wishlist.items.some(i => i._id === product._id)
  );

  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const hasDiscount = product.discount > 0;
  const discountedPrice = hasDiscount ? product.price * (1 - product.discount / 100) : product.price;
  const isOutOfStock = product.stock === 0;

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setAdding(true);
    try {
      const res = await cartApi.addItem(product._id, quantity);
      dispatch(setCart(res.data.data));
      toast.success(`Added ${quantity} item(s) to cart!`);
      dispatch(addNotification({
        type: 'success',
        title: 'Added to Cart',
        message: `${quantity}x ${product.name} added to your cart`,
        actionUrl: '/cart',
      }));
      onClose();
    } finally {
      setAdding(false);
    }
  };

  const handleToggleWishlist = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
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
    } catch (error) {
      toast.error('Something went wrong');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 text-xl"
            aria-label="Close"
          >
            ×
          </button>

          <div className="grid md:grid-cols-2 gap-8 p-8">
            {/* Left: Images */}
            <div>
              <div className="relative aspect-square bg-gray-100 dark:bg-gray-700 rounded-xl overflow-hidden mb-4">
                <img
                  src={product.images[selectedImage]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
                {hasDiscount && (
                  <span className="absolute top-4 left-4 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full">
                    -{product.discount}% OFF
                  </span>
                )}
              </div>

              {/* Thumbnails */}
              {product.images.length > 1 && (
                <div className="flex gap-2">
                  {product.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImage(idx)}
                      className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                        selectedImage === idx
                          ? 'border-primary-500'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Details */}
            <div className="flex flex-col">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {product.name}
              </h2>

              <div className="flex items-center gap-2 mb-4">
                <StarRating rating={product.averageRating} size="md" />
                <span className="text-sm text-gray-500">({product.reviewCount} reviews)</span>
              </div>

              <div className="mb-4">
                {hasDiscount ? (
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold text-red-600 dark:text-red-400">
                      ${discountedPrice.toFixed(2)}
                    </span>
                    <span className="text-xl text-gray-400 line-through">
                      ${product.price.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <span className="text-3xl font-bold text-gray-900 dark:text-white">
                    ${product.price.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Stock status */}
              <div className="mb-4">
                {isOutOfStock ? (
                  <span className="inline-block bg-red-500 text-white text-sm font-semibold px-3 py-1 rounded-full">
                    Out of Stock
                  </span>
                ) : product.stock <= 3 ? (
                  <span className="inline-block bg-orange-400 text-white text-sm font-semibold px-3 py-1 rounded-full">
                    Only {product.stock} left!
                  </span>
                ) : product.stock <= 10 ? (
                  <span className="inline-block bg-yellow-400 text-white text-sm font-semibold px-3 py-1 rounded-full">
                    Low Stock ({product.stock} available)
                  </span>
                ) : (
                  <span className="inline-block bg-green-500 text-white text-sm font-semibold px-3 py-1 rounded-full">
                    In Stock
                  </span>
                )}
              </div>

              <p className="text-gray-600 dark:text-gray-300 mb-6 line-clamp-4">
                {product.description}
              </p>

              {/* Quantity selector */}
              {!isOutOfStock && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Quantity
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
                    >
                      −
                    </button>
                    <span className="w-12 text-center font-medium">{quantity}</span>
                    <button
                      onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                      className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-auto">
                <button
                  onClick={handleAddToCart}
                  disabled={isOutOfStock || adding}
                  className="flex-1 btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {adding ? 'Adding...' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
                </button>
                <button
                  onClick={handleToggleWishlist}
                  className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl transition-all ${
                    isInWishlist
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-red-500'
                  }`}
                  aria-label="Add to wishlist"
                >
                  {isInWishlist ? '♥' : '♡'}
                </button>
              </div>

              <button
                onClick={() => {
                  navigate(`/products/${product._id}`);
                  onClose();
                }}
                className="mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline text-center"
              >
                View Full Details →
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
