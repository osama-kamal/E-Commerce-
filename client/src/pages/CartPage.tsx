import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, ShoppingCart } from 'lucide-react';
import { validateCouponThunk, removeCoupon } from '../store/couponSlice';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { useCart, useUpdateCartItem, useRemoveCartItem, useClearCart } from '../hooks/useCart';
import { formatCurrency } from '../utils/format';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function CartPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // ── React Query cart hooks ─────────────────────────────────────────────────
  const { data: cart } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();

  // ── Coupon state (still in Redux) ──────────────────────────────────────────
  const { code: couponCode, discount, label: couponLabel } = useAppSelector(s => s.coupon);
  const currency = useAppSelector(s => s.currentStore.current?.currency) ?? 'USD';
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');

  // Detect stale cross-store cart on mount
  useEffect(() => {
    if (cart && cart.items.length === 0) {
      dispatch(removeCoupon());
    }
  }, [cart, dispatch]);

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError('');
    const code = couponInput.trim();
    if (!code) return;
    const subtotal = cart?.subtotal ?? 0;
    const result = await dispatch(validateCouponThunk({ code, subtotal }));
    if (validateCouponThunk.fulfilled.match(result)) {
      toast.success(`Coupon applied: ${result.payload.label}`);
      setCouponInput('');
    } else {
      setCouponError((result.payload as string) ?? 'Invalid coupon code');
    }
  };

  const handleRemoveCoupon = () => {
    dispatch(removeCoupon());
    toast('Coupon removed', { icon: '✕' });
  };

  // Empty state
  if (!cart || cart.items.length === 0) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        {/* Icon in a soft container rather than a 72px emoji: the emoji was the
            largest element on the screen and carried none of the meaning. */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
          <ShoppingCart className="h-9 w-9 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Your cart is empty</h2>
        <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          Browse the catalogue and add something you like — your cart will keep it safe.
        </p>
        <button onClick={() => navigate('/')} className="btn btn-brand btn-lg">
          Start Shopping
        </button>
      </motion.div>
    </div>
  );

  const subtotal = cart.subtotal;
  const finalTotal = Math.max(0, subtotal - discount);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shopping Cart</h1>
        <button
          onClick={() => clearCart.mutate()}
          disabled={clearCart.isPending}
          // btn-link supplies the shape; the red is layered on top because the
          // utilities layer outranks the components layer.
          className="btn btn-link text-sm text-red-500 dark:text-red-400"
        >
          Clear cart
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Items */}
        <div className="lg:col-span-2 space-y-3">
          <AnimatePresence>
            {cart.items.map(item => (
              <motion.div
                key={item.productId}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20, height: 0 }}
                transition={{ duration: 0.2 }}
                className="card p-4 flex items-center gap-4"
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-300 dark:bg-gray-800 dark:text-gray-600">
                  <Package className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                  {item.selectedSize && (
                    <p className="text-xs text-primary-600 dark:text-primary-400 font-medium">Size: {item.selectedSize}</p>
                  )}
                  <p className="text-sm text-gray-500">${item.currentPrice.toFixed(2)} each</p>
                </div>

                {/* Quantity controls — 44px min touch targets per HIG */}
                <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg">
                  <button
                    onClick={() => updateItem.mutate({ productId: item.productId, quantity: item.quantity - 1 })}
                    disabled={updateItem.isPending}
                    aria-label="Decrease quantity"
                    // btn-ghost carries colour only — the explicit corner rounding
                    // stays because this is a segmented control, not a lone button.
                    className="btn-ghost min-w-[44px] min-h-[44px] flex items-center justify-center px-3 rounded-l-lg disabled:opacity-50 transition-colors"
                  >
                    −
                  </button>
                  <span className="px-3 py-1 text-sm dark:text-white min-w-[2rem] text-center">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateItem.mutate({ productId: item.productId, quantity: item.quantity + 1 })}
                    disabled={updateItem.isPending}
                    aria-label="Increase quantity"
                    className="btn-ghost min-w-[44px] min-h-[44px] flex items-center justify-center px-3 rounded-r-lg disabled:opacity-50 transition-colors"
                  >
                    +
                  </button>
                </div>

                <p className="font-semibold text-gray-900 dark:text-white w-20 text-right">
                  ${item.lineTotal.toFixed(2)}
                </p>

                <button
                  onClick={() => removeItem.mutate({ productId: item.productId })}
                  disabled={removeItem.isPending}
                  // Glyph-only control: without a label a screen reader announces
                  // it as "✕, button".
                  aria-label="Remove item from cart"
                  className="text-gray-400 hover:text-red-500 ml-2 transition-colors disabled:opacity-50"
                >
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Summary */}
        <div className="card p-5 h-fit space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Order Summary</h2>

          {/* Coupon input */}
          {!couponCode ? (
            <form onSubmit={handleApplyCoupon} className="space-y-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Coupon code"
                  className="input flex-1 uppercase placeholder:normal-case"
                  value={couponInput}
                  onChange={e => { setCouponInput(e.target.value); setCouponError(''); }}
                />
                <button type="submit" className="btn-secondary px-3 text-sm shrink-0">Apply</button>
              </div>
              {couponError && <p className="text-red-500 text-xs">{couponError}</p>}
              <p className="text-xs text-gray-400">Enter your promo code</p>
            </form>
          ) : (
            <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">{couponCode}</p>
                <p className="text-xs text-green-600 dark:text-green-500">{couponLabel}</p>
              </div>
              <button onClick={handleRemoveCoupon} className="text-green-600 hover:text-red-500 text-sm transition-colors">✕</button>
            </div>
          )}

          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Discount ({couponLabel})</span>
                <span>−{formatCurrency(discount, currency)}</span>
              </div>
            )}
            {/* This line used to read "Free" unconditionally, which was
                harmless when no shipping existed and is a false promise now
                that it does. The cart cannot know the cost: it depends on a
                delivery address the shopper has not entered yet. */}
            <div className="flex justify-between">
              <span>Shipping &amp; tax</span>
              <span className="text-gray-500 dark:text-gray-400">Calculated at checkout</span>
            </div>
          </div>

          <div className="border-t dark:border-gray-700 pt-3 flex justify-between font-bold text-gray-900 dark:text-white">
            {/* "Subtotal", not "Total" — naming it Total while shipping and tax
                are still unknown is the classic hidden-cost dark pattern. */}
            <span>Subtotal</span>
            <span>{formatCurrency(finalTotal, currency)}</span>
          </div>

          <button onClick={() => navigate('/checkout')} className="btn-primary w-full py-3">
            Proceed to Checkout
          </button>
          <Link to="/" className="btn-secondary w-full text-center block text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}
