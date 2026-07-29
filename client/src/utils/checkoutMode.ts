/**
 * Checkout payment-mode resolution.
 *
 * Extracted from CheckoutPage so the decision is pure and unit-testable — it
 * gates a payment bypass, so it must not live inline in a component.
 *
 * Background: the checkout previously derived a single `TEST_MODE` flag purely
 * from whether a usable Stripe publishable key was present:
 *
 *     const TEST_MODE = !isRealStripeKey;
 *
 * A production build with a missing or malformed VITE_STRIPE_PUBLISHABLE_KEY
 * therefore rendered a "Skip Payment (Test)" button to real customers, which
 * advanced the order to the confirmation screen with no payment taken. The order
 * had already been created server-side (stock decremented, confirmation email
 * sent), so a merchant fulfilling pending orders would ship unpaid goods.
 *
 * Simulation is now only ever reachable in a development build.
 */

export type CheckoutMode =
  /** A usable publishable key is configured — take real card payments. */
  | 'live'
  /** Dev build with no usable key — allow simulating a successful payment. */
  | 'simulated'
  /** Production build with no usable key — card payment must be refused. */
  | 'unavailable';

/**
 * A key is usable when it looks like a real Stripe publishable key.
 * The `000000000000` check rejects the common all-zeros placeholder.
 */
export function isValidStripeKey(key: string | undefined | null): boolean {
  return Boolean(
    key &&
    key.startsWith('pk_') &&
    key.length > 30 &&
    !key.includes('000000000000')
  );
}

/**
 * @param key    value of VITE_STRIPE_PUBLISHABLE_KEY
 * @param isDev  import.meta.env.DEV — true only for a development build
 */
export function resolveCheckoutMode(
  key: string | undefined | null,
  isDev: boolean
): CheckoutMode {
  if (isValidStripeKey(key)) return 'live';
  return isDev ? 'simulated' : 'unavailable';
}
