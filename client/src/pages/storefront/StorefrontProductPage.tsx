/**
 * StorefrontProductPage  (/s/:slug/products/:id)
 *
 * Product detail view scoped to a storefront. Uses sfApi from StorefrontContext
 * for all data fetching so requests carry the correct X-Store-Slug header.
 *
 * This is a self-contained component — it does NOT reuse ProductDetailPage
 * to avoid threading a custom axios instance through that page's many hooks.
 * It implements the same core UX: image gallery, price, add-to-cart, reviews.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { recordRecentlyViewed } from '../../hooks/useRecentlyViewed';
import { useAddToCart } from '../../hooks/useCart';
import { Product, Review } from '../../types';
import StarRating from '../../components/StarRating';
import { ProductDetailSkeleton } from '../../components/Skeleton';

export default function StorefrontProductPage() {
  const { id } = useParams<{ id: string }>();
  const { slug, sfApi } = useStorefront();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [selectedImage, setSelectedImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);

  // Fetch product
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    sfApi.get<{ data: Product }>(`/products/${id}`)
      .then(res => {
        setProduct(res.data.data);
        // Recorded only on a successful fetch, so a 404 (or another tenant's id)
        // never enters this store's history.
        recordRecentlyViewed(slug, res.data.data);
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [sfApi, id, slug]);

  // Fetch reviews
  useEffect(() => {
    if (!id) return;
    sfApi.get<{ data: { reviews: Review[]; averageRating: number } }>(`/reviews/products/${id}`)
      .then(res => {
        setReviews(res.data.data.reviews);
        setAvgRating(res.data.data.averageRating);
      })
      .catch(() => {});
  }, [sfApi, id]);

  /**
   * Adds through the shared cart mutation rather than posting directly.
   *
   * The raw `sfApi.post('/cart/items', …)` this replaces did reach the server,
   * but it wrote to nothing on the client: not the React Query cache the cart
   * page reads, and not the Redux slice the navbar counter reads. So the item
   * was genuinely in the cart while the badge stayed at its old number and the
   * cart page could serve a stale list for the rest of its 2-minute staleTime.
   * `useAddToCart` is the same call plus the optimistic update and both cache
   * writes — it is what ProductCard in the catalogue grid already used, which is
   * why adding from the grid behaved differently from adding here.
   *
   * It also owns the success toast, so this no longer raises its own.
   */
  const addToCart = useAddToCart();

  // A product with declared sizes cannot be added without one — the server
  // rejects a sizeless add (cart.service assertValidSize), so the page must
  // collect the size the same way the catalogue's ProductCard does. Mirrors
  // its `needsSize` gate exactly.
  const hasSizes = !!product?.sizes?.length;
  const needsSize = hasSizes && !selectedSize;

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/s/${slug}/products/${id}`);
      return;
    }
    if (!product || needsSize) return;
    setAddingToCart(true);
    try {
      await addToCart.mutateAsync({
        productId: product._id,
        quantity: qty,
        selectedSize: selectedSize ?? undefined,
        productName: product.name,
      });
    } catch {
      // Rolled back by the mutation; the toast is fired by the interceptor.
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) return <ProductDetailSkeleton />;
  if (!product) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-5xl mb-4">📦</p>
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-4">Product not found</h2>
        <Link to={`/s/${slug}`} className="btn-primary px-6">Back to store</Link>
      </div>
    );
  }

  const hasDiscount = product.discount > 0;
  const discountedPrice = hasDiscount ? product.price * (1 - product.discount / 100) : product.price;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 dark:text-gray-400 mb-6 flex items-center gap-2">
        <Link to={`/s/${slug}`} className="hover:text-primary-600">Store</Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-white truncate max-w-xs">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        {/* Images */}
        <div>
          <div className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-xl overflow-hidden mb-3">
            {product.images[selectedImage] ? (
              <img
                src={product.images[selectedImage]}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-6xl">📦</div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {product.images.map((img, i) => (
                <button key={i} onClick={() => setSelectedImage(i)}
                  className={`w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${i === selectedImage ? 'border-primary-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{product.name}</h1>

          <div className="flex items-center gap-3 mb-4">
            <StarRating rating={avgRating} />
            <span className="text-sm text-gray-500">({reviews.length} review{reviews.length !== 1 ? 's' : ''})</span>
            {product.stock === 0 ? (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Out of Stock</span>
            ) : product.stock < 5 ? (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">Only {product.stock} left</span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">In Stock</span>
            )}
          </div>

          <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">{product.description}</p>

          <div className="mb-6">
            {hasDiscount ? (
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-red-600 dark:text-red-400">${discountedPrice.toFixed(2)}</span>
                <span className="text-xl text-gray-500 line-through">${product.price.toFixed(2)}</span>
                <span className="bg-red-500 text-white px-2 py-1 rounded-md text-sm font-bold">-{product.discount}% OFF</span>
              </div>
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">${product.price.toFixed(2)}</p>
            )}
          </div>

          {/* Size selector — only when the product declares sizes and is in
              stock. Without a choice here the add is rejected server-side, so
              this is a gate, not decoration. Toggles like ProductCard's: a
              second click on the chosen size clears it. */}
          {hasSizes && product.stock > 0 && (
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Size</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.sizes.map(size => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(s => (s === size ? null : size))}
                    aria-pressed={selectedSize === size}
                    className={`min-w-[42px] rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                      selectedSize === size
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {needsSize && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Select a size to continue
                </p>
              )}
            </div>
          )}

          {product.stock > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Qty</label>
              <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}
                  className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">−</button>
                <span className="w-10 text-center text-sm font-medium dark:text-white">{qty}</span>
                <button onClick={() => setQty(q => Math.min(product.stock, q + 1))} disabled={qty >= product.stock}
                  className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">+</button>
              </div>
              <span className="text-xs text-gray-400">{product.stock} available</span>
            </div>
          )}

          <button
            onClick={handleAddToCart}
            disabled={product.stock === 0 || addingToCart || needsSize}
            className="btn-primary w-full"
          >
            {addingToCart ? 'Adding…' : product.stock === 0 ? 'Out of Stock' : needsSize ? 'Select a size' : 'Add to Cart'}
          </button>
        </div>
      </div>

      {/* Reviews */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
          Reviews {reviews.length > 0 && <span className="ml-2 text-sm font-normal text-gray-500">· avg {avgRating.toFixed(1)}/5</span>}
        </h2>
        {reviews.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No reviews yet.</p>
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
    </div>
  );
}
