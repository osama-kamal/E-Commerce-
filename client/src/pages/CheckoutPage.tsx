import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { ordersApi } from '../api/orders';
import { paymentsApi } from '../api/payments';
import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch';
import { validateCouponThunk, removeCoupon } from '../store/couponSlice';
import { ShippingAddress } from '../types';

// Guard against empty/fake Stripe key — avoids IntegrationError crash
const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const isRealStripeKey = Boolean(STRIPE_KEY && STRIPE_KEY.startsWith('pk_') && STRIPE_KEY.length > 30 && !STRIPE_KEY.includes('000000000000'));
const stripePromise = isRealStripeKey ? loadStripe(STRIPE_KEY!) : null;
const TEST_MODE = !isRealStripeKey;

const addressSchema = yup.object({
  line1:      yup.string().required('Address is required'),
  city:       yup.string().required('City is required'),
  state:      yup.string().required('State is required'),
  postalCode: yup.string().required('Postal code is required'),
  country:    yup.string().required('Country is required'),
});
type AddressForm = yup.InferType<typeof addressSchema>;

const STEPS = ['Shipping', 'Payment', 'Summary'] as const;
type Step = 0 | 1 | 2;

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={`flex items-center gap-2 ${i <= current ? 'text-primary-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
              i < current   ? 'bg-primary-600 border-primary-600 text-white' :
              i === current ? 'border-primary-600 text-primary-600' :
                              'border-gray-300 text-gray-400'
            }`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className="text-sm font-medium hidden sm:block">{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-12 sm:w-20 h-0.5 mx-2 transition-colors ${i < current ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Stripe hooks (useStripe/useElements) MUST only be called inside <Elements> context.
// This component is only rendered when stripePromise is non-null.
function StripePaymentStep({
  finalTotal, payLoading, onBack, onPay,
}: {
  finalTotal: number;
  payLoading: boolean;
  onBack: () => void;
  onPay: (e: FormEvent, stripe: ReturnType<typeof useStripe>, elements: ReturnType<typeof useElements>) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  return (
    <form onSubmit={e => onPay(e, stripe, elements)} className="card p-6 space-y-4">
      <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Payment Details</h2>
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-400">
        🔒 Test card: <strong>4242 4242 4242 4242</strong> · Any future date · Any CVC
      </div>
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-800">
        <CardElement options={{ style: { base: { fontSize: '16px', color: '#111827' } } }} />
      </div>
      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 pt-1">
        <span>Total to charge</span>
        <span className="font-bold text-gray-900 dark:text-white">${finalTotal.toFixed(2)}</span>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="btn-secondary flex-1">← Back</button>
        <button type="submit" className="btn-primary flex-1 py-3" disabled={payLoading || !stripe}>
          {payLoading ? 'Processing…' : `Pay $${finalTotal.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

function CheckoutForm() {
  // NOTE: useStripe/useElements are only called when wrapped in <Elements>
  // In TEST_MODE this component renders without them — see StripePaymentStep below
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const cart = useAppSelector(s => s.cart.cart);
  const { discount, code: couponCode, label: couponLabel, loading: couponLoading, error: couponError } = useAppSelector(s => s.coupon);

  const [step, setStep] = useState<Step>(0);
  const [orderId, setOrderId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [shippingData, setShippingData] = useState<ShippingAddress | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedItems, setSavedItems] = useState<typeof cart extends null ? never[] : NonNullable<typeof cart>['items']>([]);
  const [couponInput, setCouponInput] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AddressForm>({
    resolver: yupResolver(addressSchema),
    defaultValues: { country: 'US' },
  });

  // Use savedTotal after cart is cleared, otherwise compute live
  const finalTotal = savedTotal > 0 ? savedTotal : Math.max(0, (cart?.subtotal ?? 0) - discount);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    const subtotal = cart?.subtotal ?? 0;
    const result = await dispatch(validateCouponThunk({ code, subtotal }));
    if (validateCouponThunk.fulfilled.match(result)) {
      toast.success(`Coupon applied: ${result.payload.label}`);
      setCouponInput('');
    }
  };

  const handleRemoveCoupon = () => {
    dispatch(removeCoupon());
    setCouponInput('');
  };

  const handleShippingSubmit = async (data: AddressForm) => {
    try {
      // Snapshot total AND items before the order clears the cart
      const currentTotal = Math.max(0, (cart?.subtotal ?? 0) - discount);
      setSavedTotal(currentTotal);
      setSavedItems(cart?.items ?? []);

      const orderRes = await ordersApi.place(data as ShippingAddress, currentTotal > 0 ? discount : 0, couponCode ?? undefined);
      const oid = orderRes.data.data._id;
      setOrderId(oid);
      setShippingData(data as ShippingAddress);
      // Only create Stripe payment intent when a real key is configured
      if (!TEST_MODE) {
        const intentRes = await paymentsApi.createIntent(oid);
        setClientSecret(intentRes.data.data.clientSecret);
      }
      setStep(1);
    } catch (err: any) {
      // If the error is a store mismatch, offer to clear the cart
      const msg: string = err?.response?.data?.message ?? '';
      if (msg.includes('different store')) {
        toast.error('Your cart has items from another store. Clearing cart…', { duration: 4000 });
        try {
          const { cartApi } = await import('../api/cart');
          const res = await cartApi.clear();
          const { setCart } = await import('../store/cartSlice');
          dispatch(setCart(res.data.data));
          navigate('/cart');
        } catch {
          navigate('/cart');
        }
      }
      // other errors: toast fired by axios interceptor
    }
  };

  const handleRealPayment = async (e: FormEvent, stripe: ReturnType<typeof useStripe>, elements: ReturnType<typeof useElements>) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) return;
    setPayLoading(true);
    const card = elements.getElement(CardElement);
    if (!card) { setPayLoading(false); return; }
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    });
    if (error) {
      toast.error(error.message ?? 'Payment failed');
      setPayLoading(false);
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      setStep(2);
    }
    setPayLoading(false);
  };

  const handleSkipPayment = () => {
    toast('Test mode: payment skipped', { icon: '🧪' });
    setStep(2);
  };

  const handleFinish = () => {
    toast.success('Order placed successfully!');
    navigate(`/orders/${orderId}?success=1`);
  };

  if (!cart || cart.items.length === 0) {
    navigate('/cart');
    return null;
  }

  const slideVariants = {
    enter:  { opacity: 0, x: 40 },
    center: { opacity: 1, x: 0 },
    exit:   { opacity: 0, x: -40 },
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Checkout</h1>

      {TEST_MODE && (
        <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg px-4 py-2 text-xs text-yellow-800 dark:text-yellow-400">
          🧪 <strong>Test mode</strong> — Add <code>VITE_STRIPE_PUBLISHABLE_KEY</code> to <code>client/.env</code> for real payments.
        </div>
      )}

      <StepIndicator current={step} />

      <AnimatePresence mode="wait">
        {/* ── Step 0: Shipping ── */}
        {step === 0 && (
          <motion.div key="shipping" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
            <form onSubmit={handleSubmit(handleShippingSubmit)} className="card p-6 space-y-4" noValidate>
              <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Shipping Address</h2>
              {([
                { name: 'line1' as const,      label: 'Address line 1' },
                { name: 'city' as const,       label: 'City' },
                { name: 'state' as const,      label: 'State / Province' },
                { name: 'postalCode' as const, label: 'Postal code' },
                { name: 'country' as const,    label: 'Country' },
              ]).map(({ name, label }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                  <input className="input" {...register(name)} />
                  {errors[name] && <p className="text-red-500 text-xs mt-1">{errors[name]?.message}</p>}
                </div>
              ))}
              <button type="submit" className="btn-primary w-full py-3" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Continue to Payment →'}
              </button>

              {/* ── Coupon / Promo Code ── */}
              <div className="border-t dark:border-gray-700 pt-4 space-y-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Promo Code</p>

                {couponCode ? (
                  /* Applied state */
                  <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                    <div>
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400">
                        🏷️ {couponCode}
                        <span className="ml-1 px-2 py-0.5 bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-full text-xs">
                          {couponLabel}
                        </span>
                      </span>
                      <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                        −${discount.toFixed(2)} discount applied
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  /* Input state */
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={e => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleApplyCoupon())}
                        placeholder="Enter promo code"
                        className="input flex-1 uppercase placeholder:normal-case"
                        disabled={couponLoading}
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={couponLoading || !couponInput.trim()}
                        className="btn-primary px-4 disabled:opacity-50 whitespace-nowrap"
                      >
                        {couponLoading ? '…' : 'Apply'}
                      </button>
                    </div>
                    {couponError && (
                      <p className="text-xs text-red-500">{couponError}</p>
                    )}
                  </div>
                )}

                {/* Order summary with discount */}
                <div className="text-sm space-y-1 text-gray-600 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>${(cart?.subtotal ?? 0).toFixed(2)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Discount</span>
                      <span>−${discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-gray-900 dark:text-white border-t dark:border-gray-700 pt-1">
                    <span>Total</span>
                    <span>${Math.max(0, (cart?.subtotal ?? 0) - discount).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        )}

        {/* ── Step 1: Payment ── */}
        {step === 1 && (
          <motion.div key="payment" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
            {TEST_MODE ? (
              <div className="card p-6 space-y-4">
                <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Payment Details</h2>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4 text-sm text-yellow-800 dark:text-yellow-400">
                  <p className="font-semibold mb-1">🧪 Test Mode Active</p>
                  <p>No Stripe key configured. Click below to simulate a successful payment.</p>
                </div>
                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                  <span>Total</span>
                  <span className="font-bold text-gray-900 dark:text-white">${finalTotal.toFixed(2)}</span>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(0)} className="btn-secondary flex-1">← Back</button>
                  <button type="button" onClick={handleSkipPayment} className="flex-1 py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-lg transition-colors">
                    Skip Payment (Test)
                  </button>
                </div>
              </div>
            ) : (
              <StripePaymentStep
                finalTotal={finalTotal}
                payLoading={payLoading}
                onBack={() => setStep(0)}
                onPay={(e, stripe, elements) => handleRealPayment(e, stripe, elements)}
              />
            )}
          </motion.div>
        )}

        {/* ── Step 2: Confirmation ── */}
        {step === 2 && (
          <motion.div key="summary" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
            <div className="card p-6 space-y-4 text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}>
                <p className="text-6xl mb-3">🎉</p>
              </motion.div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {TEST_MODE ? 'Test Order Placed!' : 'Payment Successful!'}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Your order has been placed and is being processed.</p>

              {shippingData && (
                <div className="text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm space-y-1">
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">Shipping to:</p>
                  <p className="text-gray-600 dark:text-gray-400">{shippingData.line1}</p>
                  <p className="text-gray-600 dark:text-gray-400">{shippingData.city}, {shippingData.state} {shippingData.postalCode}</p>
                  <p className="text-gray-600 dark:text-gray-400">{shippingData.country}</p>
                </div>
              )}

              <div className="text-left space-y-1 text-sm">
                {savedItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>
                      {item.name} × {item.quantity}
                      {item.selectedSize && <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(Size: {item.selectedSize})</span>}
                    </span>
                    <span>${item.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
                {discount > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Coupon discount</span>
                    <span>−${discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t dark:border-gray-700 pt-2 flex justify-between font-bold text-gray-900 dark:text-white">
                  <span>Total paid</span>
                  <span>${finalTotal.toFixed(2)}</span>
                </div>
              </div>

              <button onClick={handleFinish} className="btn-primary w-full py-3">View My Order</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Conditionally wrap with Elements only when Stripe is configured
export default function CheckoutPage() {
  if (TEST_MODE) {
    return <CheckoutForm />;
  }
  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm />
    </Elements>
  );
}
