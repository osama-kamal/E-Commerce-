/**
 * StorefrontCartPage  (/s/:slug/cart)
 *
 * Cart view for a storefront customer. Shows cart items fetched via the
 * global api (which carries X-Store-Slug via sessionStorage) and links
 * back into the storefront for continued shopping.
 */

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { CardGridSkeleton } from '../../components/Skeleton';
import { useStorefront } from '../../contexts/StorefrontContext';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { useCart, useUpdateCartItem, useRemoveCartItem } from '../../hooks/useCart';

export default function StorefrontCartPage() {
  const { slug } = useStorefront();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const navigate = useNavigate();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/s/${slug}/cart`, { replace: true });
    }
  }, [isAuthenticated, navigate, slug]);

  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  if (!isAuthenticated) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/s/${slug}`} className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600">
          ← Continue shopping
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your Cart</h1>
      </div>

      {isLoading ? (
        <CardGridSkeleton count={3} lines={2} className="space-y-4" label="Loading your cart…" />
      ) : !cart || cart.items.length === 0 ? (
        <div className="surface py-24 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <ShoppingCart className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Your cart is empty</h2>
          <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Browse the store and add something you like.
          </p>
          <Link to={`/s/${slug}`} className="btn btn-brand btn-lg inline-flex">Shop Now</Link>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-gray-100 dark:divide-gray-800 mb-6">
            {cart.items.map(item => (
              <div key={`${item.productId}-${item.selectedSize ?? ''}`} className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name}</p>
                  {item.selectedSize && (
                    <p className="text-xs text-gray-400">Size: {item.selectedSize}</p>
                  )}
                  <p className="text-sm font-bold text-primary-600 mt-0.5">${item.currentPrice.toFixed(2)}</p>
                </div>

                <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => updateItem.mutate({ productId: item.productId, quantity: item.quantity - 1 })}
                    className="px-3 py-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                    disabled={updateItem.isPending}
                  >−</button>
                  <span className="w-8 text-center text-sm font-medium dark:text-white">{item.quantity}</span>
                  <button
                    onClick={() => updateItem.mutate({ productId: item.productId, quantity: item.quantity + 1 })}
                    className="px-3 py-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                    disabled={updateItem.isPending}
                  >+</button>
                </div>

                <p className="text-sm font-semibold text-gray-900 dark:text-white w-20 text-right">
                  ${item.lineTotal.toFixed(2)}
                </p>

                <button
                  onClick={() => removeItem.mutate({ productId: item.productId })}
                  className="text-gray-400 hover:text-red-500 transition-colors text-lg ml-2"
                  aria-label="Remove item"
                >×</button>
              </div>
            ))}
          </div>

          <div className="card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Subtotal</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${cart.subtotal.toFixed(2)}</p>
            </div>
            {/* Stays inside /s/:slug. Linking to the bare "/checkout" left the
                storefront route tree, unmounting the provider that identifies
                this tenant — the order was then placed against the platform's
                own store rather than this merchant. */}
            <Link
              to={`/s/${slug}/checkout`}
              className="btn-primary px-8 py-3 text-base w-full sm:w-auto text-center"
            >
              Proceed to Checkout
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
