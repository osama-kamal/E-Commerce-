import { useState, useEffect, useRef, FormEvent } from 'react';
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

// ── Provider type ─────────────────────────────────────────────────────────────
type OnlineProvider = 'stripe' | 'paymob';

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
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
              i < current   ? 'bg-primary-600 border-primary-600 text-white' :
              i === current ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 ring-2 ring-primary-200 dark:ring-primary-800 ring-offset-1' :
                              'border-gray-300 text-gray-400'
            }`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-sm hidden sm:block transition-all ${
              i === current ? 'font-semibold text-primary-700 dark:text-primary-300' :
              i < current   ? 'font-medium text-primary-600' :
                              'font-normal text-gray-400'
            }`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-12 sm:w-20 h-0.5 mx-2 transition-colors ${i < current ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Paymob iframe modal ───────────────────────────────────────────────────────

function PaymobIframeModal({
  iframeUrl,
  onSuccess,
  onClose,
}: {
  iframeUrl: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.includes('paymob.com')) return;
      const data = event.data as Record<string, unknown>;
      if (data?.type === 'TRANSACTION' || data?.success === true) {
        onSuccess();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-visible">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🇪🇬</span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">Pay with Paymob</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Secured by Paymob</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close Paymob payment"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none transition-colors">
            ×
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          title="Paymob Payment"
          className="w-full"
          style={{ height: '520px', border: 'none', display: 'block', pointerEvents: 'auto' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation allow-top-navigation-by-user-activation"
        />
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            🔒 Payments are encrypted and secured by Paymob. Vendbase never stores your card details.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Stripe payment step ───────────────────────────────────────────────────────

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

// ── Main checkout form ────────────────────────────────────────────────────────

function CheckoutForm() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const cart = useAppSelector(s => s.cart.cart);
  const { discount, code: couponCode, label: couponLabel, loading: couponLoading, error: couponError } = useAppSelector(s => s.coupon);

  const [step, setStep] = useState<Step>(0);
  const [orderId, setOrderId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [shippingData, setShippingData] = useState<ShippingAddress | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');
  const [onlineProvider, setOnlineProvider] = useState<OnlineProvider>('stripe');
  const [payLoading, setPayLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedItems, setSavedItems] = useState<typeof cart extends null ? never[] : NonNullable<typeof cart>['items']>([]);
  const [couponInput, setCouponInput] = useState('');
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);

  // Stable idempotency key for this checkout session — generated once on mount.
  // Ensures that clicking "Continue to Payment" twice creates only one order.
  const idempotencyKey = useState(() => `checkout_${Date.now()}_${Math.random().toString(36).slice(2)}`)[0];

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AddressForm>({
    resolver: yupResolver(addressSchema),
    defaultValues: { country: 'US' },
  });

  const finalTotal = savedTotal > 0 ? savedTotal : Math.max(0, (cart?.subtotal ?? 0) - discount);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    const result = await dispatch(validateCouponThunk({ code, subtotal: cart?.subtotal ?? 0 }));
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
    if (orderLoading) return; // prevent double-submit
    setOrderLoading(true);
    try {
      const currentTotal = Math.max(0, (cart?.subtotal ?? 0) - discount);
      setSavedTotal(currentTotal);
      setSavedItems(cart?.items ?? []);

      const orderRes = await ordersApi.place(data as ShippingAddress, paymentMethod, currentTotal > 0 ? discount : 0, couponCode ?? undefined, idempotencyKey);
      const oid = orderRes.data.data._id;
      setOrderId(oid);
      setShippingData(data as ShippingAddress);

      if (paymentMethod === 'cod') { setStep(2); return; }

      if (onlineProvider === 'paymob') {
        const paymobRes = await paymentsApi.initiatePaymob(oid);
        setPaymobIframeUrl(paymobRes.data.data.iframeUrl);
        setStep(1);
        return;
      }

      if (!TEST_MODE) {
        const intentRes = await paymentsApi.createIntent(oid);
        setClientSecret(intentRes.data.data.clientSecret);
      }
      setStep(1);
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? '';
      if (msg.includes('different store')) {
        toast.error('Your cart has items from another store. Clearing cart…', { duration: 4000 });
        try {
          const { cartApi } = await import('../api/cart');
          const res = await cartApi.clear();
          const { setCart } = await import('../store/cartSlice');
          dispatch(setCart(res.data.data));
          navigate('/cart');
        } catch { navigate('/cart'); }
      }
    } finally {
      setOrderLoading(false);
    }
  };

  const handleRealPayment = async (e: FormEvent, stripe: ReturnType<typeof useStripe>, elements: ReturnType<typeof useElements>) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) return;
    setPayLoading(true);
    const card = elements.getElement(CardElement);
    if (!card) { setPayLoading(false); return; }
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } });
    if (error) { toast.error(error.message ?? 'Payment failed'); setPayLoading(false); return; }
    if (paymentIntent?.status === 'succeeded') setStep(2);
    setPayLoading(false);
  };

  const handlePaymobSuccess = () => {
    setPaymobIframeUrl(null);
    setStep(2);
    toast.success('Payment completed via Paymob!');
  };

  const handleFinish = () => {
    toast.success('Order placed successfully!');
    navigate(`/orders/${orderId}?success=1`);
  };

  // Guard: redirect to cart if it becomes empty during checkout.
  // Must be a useEffect — calling navigate() directly in the render body
  // causes "Cannot update a component while rendering a different component".
  const cartIsEmpty = !cart || cart.items.length === 0;
  useEffect(() => {
    if (cartIsEmpty) navigate('/cart');
  }, [cartIsEmpty, navigate]);

  if (cartIsEmpty) return null;

  const slideVariants = {
    enter:  { opacity: 0, x: 40 },
    center: { opacity: 1, x: 0 },
    exit:   { opacity: 0, x: -40 },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-amber-50 dark:bg-gray-950">
      {paymobIframeUrl && (
        <PaymobIframeModal
          iframeUrl={paymobIframeUrl}
          onSuccess={handlePaymobSuccess}
          onClose={() => { setPaymobIframeUrl(null); toast('Payment cancelled', { icon: '↩️' }); }}
        />
      )}

      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Checkout</h1>

        {TEST_MODE && onlineProvider === 'stripe' && (
          <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg px-4 py-2 text-xs text-yellow-800 dark:text-yellow-400">
            🧪 <strong>Test mode</strong> — Add <code>VITE_STRIPE_PUBLISHABLE_KEY</code> to <code>client/.env</code> for real Stripe payments.
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
                <button type="submit" className="btn-primary w-full py-3" disabled={isSubmitting || orderLoading}>
                  {orderLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Placing order…
                    </span>
                  ) : (
                    paymentMethod === 'cod' ? 'Place Order (Cash on Delivery)' : 'Continue to Payment →'
                  )}
                </button>

                {/* ── Payment Method ── */}
                <div className="border-t dark:border-gray-700 pt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Payment Method</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      paymentMethod === 'online' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}>
                      <input type="radio" name="paymentMethod" value="online" checked={paymentMethod === 'online'} onChange={() => setPaymentMethod('online')} className="sr-only" />
                      <span className="text-xl">💳</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Online</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Card payment</p>
                      </div>
                      {paymentMethod === 'online' && <span className="ml-auto w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs">✓</span>}
                    </label>

                    <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      paymentMethod === 'cod' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}>
                      <input type="radio" name="paymentMethod" value="cod" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} className="sr-only" />
                      <span className="text-xl">💵</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Cash on Delivery</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Pay when delivered</p>
                      </div>
                      {paymentMethod === 'cod' && <span className="ml-auto w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs">✓</span>}
                    </label>
                  </div>

                  {/* ── Gateway selector (Stripe / Paymob) ── */}
                  {paymentMethod === 'online' && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Payment Gateway</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm ${
                          onlineProvider === 'stripe' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 hover:border-gray-300'
                        }`}>
                          <input type="radio" name="onlineProvider" value="stripe" checked={onlineProvider === 'stripe'} onChange={() => setOnlineProvider('stripe')} className="sr-only" />
                          <span>💳</span>
                          <div>
                            <p className="font-semibold leading-none">Stripe</p>
                            <p className="text-xs text-gray-400 mt-0.5">Global · USD</p>
                          </div>
                          {onlineProvider === 'stripe' && <span className="ml-auto text-blue-500 text-xs">✓</span>}
                        </label>

                        <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm ${
                          onlineProvider === 'paymob' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 hover:border-gray-300'
                        }`}>
                          <input type="radio" name="onlineProvider" value="paymob" checked={onlineProvider === 'paymob'} onChange={() => setOnlineProvider('paymob')} className="sr-only" />
                          <span>🇪🇬</span>
                          <div>
                            <p className="font-semibold leading-none">Paymob</p>
                            <p className="text-xs text-gray-400 mt-0.5">MENA · EGP</p>
                          </div>
                          {onlineProvider === 'paymob' && <span className="ml-auto text-amber-500 text-xs">✓</span>}
                        </label>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'cod' && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-center gap-1">
                      <span>ℹ️</span> Payment will be collected by the delivery agent at your door.
                    </p>
                  )}
                </div>

                {/* ── Coupon ── */}
                <div className="border-t dark:border-gray-700 pt-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Promo Code</p>
                  {couponCode ? (
                    <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                      <div>
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400">
                          🏷️ {couponCode}
                          <span className="ml-1 px-2 py-0.5 bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-full text-xs">{couponLabel}</span>
                        </span>
                        <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">−${discount.toFixed(2)} discount applied</p>
                      </div>
                      <button type="button" onClick={handleRemoveCoupon} className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">Remove</button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <input type="text" value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase())}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleApplyCoupon())}
                          placeholder="Enter promo code" className="input flex-1 uppercase placeholder:normal-case" disabled={couponLoading} />
                        <button type="button" onClick={handleApplyCoupon} disabled={couponLoading || !couponInput.trim()} className="btn-primary px-4 disabled:opacity-50 whitespace-nowrap">
                          {couponLoading ? '…' : 'Apply'}
                        </button>
                      </div>
                      {couponError && <p className="text-xs text-red-500">{couponError}</p>}
                    </div>
                  )}

                  <div className="text-sm space-y-1 text-gray-600 dark:text-gray-400">
                    <div className="flex justify-between"><span>Subtotal</span><span>${(cart?.subtotal ?? 0).toFixed(2)}</span></div>
                    {discount > 0 && (
                      <div className="flex justify-between text-green-600 dark:text-green-400"><span>Discount</span><span>−${discount.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between font-semibold text-gray-900 dark:text-white border-t dark:border-gray-700 pt-1">
                      <span>Total</span><span>${Math.max(0, (cart?.subtotal ?? 0) - discount).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </form>
            </motion.div>
          )}

          {/* ── Step 1: Payment ── */}
          {step === 1 && (
            <motion.div key="payment" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              {onlineProvider === 'paymob' ? (
                <div className="card p-6 space-y-4">
                  <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Pay with Paymob</h2>
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">🇪🇬 Paymob secure checkout</p>
                    <p className="text-xs text-amber-700 dark:text-amber-500">
                      You'll complete your payment in the Paymob window. Your card details are handled securely by Paymob.
                    </p>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Total</span>
                    <span className="font-bold text-gray-900 dark:text-white">${finalTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(0)} className="btn-secondary flex-1">← Back</button>
                    <button type="button" onClick={() => paymobIframeUrl && setPaymobIframeUrl(paymobIframeUrl)} disabled={!paymobIframeUrl}
                      className="flex-1 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 shadow-sm shadow-amber-200 transition-all disabled:opacity-50">
                      Open Payment Window
                    </button>
                  </div>
                </div>
              ) : TEST_MODE ? (
                <div className="card p-6 space-y-4">
                  <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Payment Details</h2>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4 text-sm text-yellow-800 dark:text-yellow-400">
                    <p className="font-semibold mb-1">🧪 Test Mode Active</p>
                    <p>No Stripe key configured. Click below to simulate a successful payment.</p>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Total</span><span className="font-bold text-gray-900 dark:text-white">${finalTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(0)} className="btn-secondary flex-1">← Back</button>
                    <button type="button" onClick={() => { toast('Test mode: payment skipped', { icon: '🧪' }); setStep(2); }}
                      className="flex-1 py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-lg transition-colors">
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
                  {paymentMethod === 'cod' ? 'Order Placed!' : TEST_MODE && onlineProvider === 'stripe' ? 'Test Order Placed!' : 'Payment Successful!'}
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {paymentMethod === 'cod' ? 'Your order is confirmed. Payment will be collected on delivery.' : 'Your order has been placed and is being processed.'}
                </p>

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
                      <span>Coupon discount</span><span>−${discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t dark:border-gray-700 pt-2 flex justify-between font-bold text-gray-900 dark:text-white">
                    <span>Total {paymentMethod === 'cod' ? '(pay on delivery)' : 'paid'}</span>
                    <span>${finalTotal.toFixed(2)}</span>
                  </div>
                </div>

                <button onClick={handleFinish} className="btn-primary w-full py-3">View My Order</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
