import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, Heart, Package } from 'lucide-react';
import { reviewsApi } from '../api/reviews';
import { wishlistApi } from '../api/wishlist';
import { categoriesApi } from '../api/categories';
import { productsApi } from '../api/products';
import { addToWishlist, removeFromWishlist } from '../store/wishlistSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { Review, Category } from '../types';
import StarRating from '../components/StarRating';
import { ProductDetailSkeleton } from '../components/Skeleton';
import Breadcrumbs, { Crumb } from '../components/Breadcrumbs';
import ProductCard from '../components/ProductCard';
import RecommendedProducts from '../components/RecommendedProducts';
import { useProduct } from '../hooks/useProducts';
import { useAddToCart } from '../hooks/useCart';
import toast from 'react-hot-toast';

// Image with shimmer placeholder until loaded
function ImageWithShimmer({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full h-full">
      {!loaded && <div className="absolute inset-0 shimmer rounded-xl" />}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`${className} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const isInWishlist = useAppSelector(s =>
    id ? s.wishlist.items.some(i => i._id === id) : false
  );
  // Used to add bottom padding so the ComparisonBar never overlaps the action buttons
  const comparisonCount = useAppSelector(s => s.comparison.products.length);

  // ── React Query — product data ─────────────────────────────────────────────
  const { data: product, isLoading: loading } = useProduct(id);

  // ── React Query — add to cart with optimistic update ──────────────────────
  const addToCart = useAddToCart();

  const [category, setCategory] = useState<Category | null>(null);
  const [parentCategory, setParentCategory] = useState<Category | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [selectedImage, setSelectedImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<import('../types').Product[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Close lightbox on Escape key + prevent body scroll while open
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [lightboxOpen]);

  // Load reviews, categories, and related products once the product is available
  useEffect(() => {
    if (!id || !product) return;
    reviewsApi.getForProduct(id).then(rRes => {
      const r = rRes.data.data;
      setReviews(r.reviews);
      setAvgRating(r.averageRating);
    });

    categoriesApi.list().then(catRes => {
      const cats = catRes.data.data;
      const cat = cats.find(c => c._id === product.categoryId) ?? null;
      setCategory(cat);
      if (cat?.parentId) {
        setParentCategory(cats.find(c => c._id === cat.parentId) ?? null);
      }
    });

    if (product.categoryId) {
      productsApi.list({ category: product.categoryId, limit: 4 }).then(relRes => {
        const related = relRes.data.data.data
          .filter((p: import('../types').Product) => p._id !== product._id)
          .slice(0, 4);
        setRelatedProducts(related);
      });
    }
  }, [id, product]);

  const handleAddToCart = async () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    if (!product) return;
    if (product.sizes && product.sizes.length > 0 && !selectedSize) {
      toast.error('Please select a size first');
      return;
    }
    addToCart.mutate({
      productId: product._id,
      quantity: qty,
      selectedSize: selectedSize ?? undefined,
      productName: product.name,
    });
  };

  const handleToggleWishlist = async () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    if (!product) return;
    setWishlistLoading(true);
    try {
      if (isInWishlist) {
        await wishlistApi.remove(product._id);
        dispatch(removeFromWishlist(product._id));
        toast('Removed from wishlist');
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
      }
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setReviewLoading(true);
    try {
      const res = await reviewsApi.submit(id, rating, comment);
      const newReview = res.data.data;

      // Prepend new review and recalculate average locally
      setReviews(prev => {
        const updated = [newReview, ...prev];
        const newAvg = updated.reduce((sum, r) => sum + r.rating, 0) / updated.length;
        setAvgRating(Math.round(newAvg * 100) / 100);
        return updated;
      });

      setComment('');
      setRating(5);
      toast.success('Review submitted!');
    } catch {
      // toast already fired by axios interceptor
    } finally {
      setReviewLoading(false);
    }
  };

  if (loading) return <ProductDetailSkeleton />;
  if (!product) return <div className="text-center py-20 text-gray-400">Product not found</div>;

  // Build breadcrumb trail: Home > [Parent Category] > [Sub Category] > Product
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }];
  if (parentCategory) crumbs.push({ label: parentCategory.name, to: `/?category=${parentCategory._id}` });
  if (category) crumbs.push({ label: category.name, to: `/?category=${category._id}` });
  crumbs.push({ label: product.name });

  // Stock status helper
  const getStockStatus = () => {
    if (product.stock === 0) return { text: 'Out of Stock', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' };
    if (product.stock < 5) return { text: `Only ${product.stock} left!`, color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' };
    if (product.stock < 10) return { text: 'Low Stock', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' };
    return { text: 'In Stock', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' };
  };

  const stockStatus = getStockStatus();

  return (
    <div className={`max-w-5xl mx-auto px-4 sm:px-6 py-8 ${comparisonCount > 0 ? 'pb-28' : ''}`}>
      {/* pb-28 (112px) ensures the ComparisonBar (~80px) never overlaps
          the Add-to-Cart / wishlist row when products are queued for comparison. */}
      <Breadcrumbs crumbs={crumbs} />
      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {/* Images — tap/click to open fullscreen lightbox */}
        <div>
          <div
            className="relative aspect-square bg-gray-100 dark:bg-gray-800 rounded-xl overflow-hidden mb-3 cursor-zoom-in group"
            onClick={() => product.images[selectedImage] && setLightboxOpen(true)}
            role="button"
            aria-label="View image fullscreen"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && product.images[selectedImage] && setLightboxOpen(true)}
          >
            {product.images[selectedImage] ? (
              <>
                <ImageWithShimmer
                  src={product.images[selectedImage]}
                  alt={product.name}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                {/* Tap-to-zoom hint — visible on touch devices, subtle on desktop */}
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Tap to zoom
                </div>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600"><Package className="h-16 w-16" strokeWidth={1.25} aria-hidden="true" /></div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory">
              {product.images.map((img, i) => (
                <button key={i} onClick={() => setSelectedImage(i)}
                  className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 snap-start transition-all ${i === selectedImage ? 'border-primary-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Lightbox overlay ── */}
        {lightboxOpen && product.images[selectedImage] && (
          <div
            className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Product image fullscreen"
          >
            {/* Close button — always in the top-right corner */}
            <button
              onClick={() => setLightboxOpen(false)}
              aria-label="Close fullscreen image"
              className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Navigate previous */}
            {product.images.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); setSelectedImage(i => (i - 1 + product.images.length) % product.images.length); }}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white text-2xl transition-colors"
              >
                ‹
              </button>
            )}

            {/* Full image — click on image itself stops propagation so only backdrop closes */}
            <img
              src={product.images[selectedImage]}
              alt={product.name}
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />

            {/* Navigate next */}
            {product.images.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); setSelectedImage(i => (i + 1) % product.images.length); }}
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white text-2xl transition-colors"
              >
                ›
              </button>
            )}

            {/* Image counter */}
            {product.images.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
                {selectedImage + 1} / {product.images.length}
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{product.name}</h1>
          
          {/* Rating & Stock Status */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <StarRating rating={avgRating} />
              <span className="text-sm text-gray-500">({reviews.length} review{reviews.length !== 1 ? 's' : ''})</span>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${stockStatus.color}`}>
              {stockStatus.text}
            </span>
          </div>

          <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">{product.description}</p>

          {/* Price with Discount */}
          <div className="mb-6">
            {product.discount > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-red-600 dark:text-red-400">
                  ${(product.price * (1 - product.discount / 100)).toFixed(2)}
                </span>
                <span className="text-xl text-gray-500 line-through">
                  ${product.price.toFixed(2)}
                </span>
                <span className="bg-red-500 text-white px-2 py-1 rounded-md text-sm font-bold">
                  -{product.discount}% OFF
                </span>
              </div>
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                ${product.price.toFixed(2)}
              </p>
            )}
          </div>

          {!product.inStock ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="flex items-center gap-2 font-medium text-red-600 dark:text-red-400"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />This product is currently out of stock</p>
            </div>
          ) : (
            <>
              {/* Size Selector */}
              {product.sizes && product.sizes.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Size <span className="text-red-500">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map(size => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size === selectedSize ? null : size)}
                        className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                          selectedSize === size
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-primary-400'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                  {!selectedSize && (
                    <p className="text-xs text-gray-400 mt-1">Please select a size</p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Qty</label>
                <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setQty(q => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    aria-label="Decrease quantity"
                    className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>

                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={product.stock}
                    value={qty}
                    aria-label="Quantity"
                    onChange={e => {
                      // Allow the field to be empty while the user is typing
                      const raw = e.target.value;
                      if (raw === '') {
                        // Temporarily set to empty string via a string state isn't possible
                        // with a number state, so clamp to 1 on empty
                        setQty(1);
                        return;
                      }
                      const parsed = parseInt(raw, 10);
                      if (!isNaN(parsed)) {
                        // Clamp immediately so the value is always valid
                        setQty(Math.min(Math.max(1, parsed), product.stock));
                      }
                    }}
                    onBlur={e => {
                      // On blur, ensure we never leave an invalid value
                      const parsed = parseInt(e.target.value, 10);
                      if (isNaN(parsed) || parsed < 1) setQty(1);
                      else if (parsed > product.stock) setQty(product.stock);
                    }}
                    onKeyDown={e => {
                      // Commit on Enter
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-14 py-2 text-center text-sm font-medium bg-transparent dark:text-white
                               border-x border-gray-300 dark:border-gray-600
                               focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500
                               [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />

                  <button
                    onClick={() => setQty(q => Math.min(product.stock, q + 1))}
                    disabled={qty >= product.stock}
                    aria-label="Increase quantity"
                    className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-gray-400">{product.stock} available</span>
              </div>
            </>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleAddToCart}
              disabled={!product.inStock || addToCart.isPending}
              className="btn-primary flex-1"
            >
              {addToCart.isPending ? 'Adding…' : 'Add to Cart'}
            </button>

            <button
              onClick={handleToggleWishlist}
              disabled={wishlistLoading}
              title={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
              className={`px-4 rounded-lg border transition-colors text-xl ${
                isInWishlist
                  ? 'bg-red-50 border-red-300 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-700'
                  : 'btn-secondary'
              }`}
            >
              <Heart className="h-5 w-5" fill={isInWishlist ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
          Reviews
          {reviews.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              · avg {avgRating.toFixed(1)} / 5
            </span>
          )}
        </h2>

        {isAuthenticated && (
          <form onSubmit={handleSubmitReview} className="card p-5 mb-6">
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">Write a review</h3>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">Your rating</label>
              <StarRating rating={rating} interactive onChange={setRating} />
            </div>
            <textarea
              className="input mb-3"
              rows={3}
              placeholder="Share your experience with this product…"
              value={comment}
              onChange={e => setComment(e.target.value)}
              required
              minLength={5}
            />
            <button type="submit" className="btn-primary" disabled={reviewLoading || !comment.trim()}>
              {reviewLoading ? 'Submitting…' : 'Submit review'}
            </button>
          </form>
        )}

        {!isAuthenticated && (
          <div className="card p-4 mb-6 text-sm text-gray-500 dark:text-gray-400 text-center">
            <button onClick={() => navigate('/login')} className="text-primary-600 hover:underline font-medium">Sign in</button> to leave a review
          </div>
        )}

        {reviews.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No reviews yet. Be the first!</p>
        ) : (
          <div className="space-y-4">
            {reviews.map(r => (
              <div key={r._id} className="card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <StarRating rating={r.rating} size="sm" />
                  <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-gray-700 dark:text-gray-300 text-sm">{r.comment}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Recommendations */}
      {product && <RecommendedProducts productId={product._id} />}

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">You May Also Like</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {relatedProducts.map(p => (
              <ProductCard key={p._id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
