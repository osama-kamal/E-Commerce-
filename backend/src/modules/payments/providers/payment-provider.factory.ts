/**
 * PaymentProviderFactory
 *
 * Returns the correct `IPaymentProvider` implementation for a given provider key.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   // From payment.service.ts (when migration happens):
 *   const provider = PaymentProviderFactory.get('stripe');
 *   const result = await provider.initiatePayment(params);
 *
 *   // Per-store dynamic selection (future, when Store.paymentProvider exists):
 *   const store = await Store.findById(storeId).lean();
 *   const provider = PaymentProviderFactory.get(store.paymentProvider ?? 'stripe');
 *
 * ── Adding a new provider ──────────────────────────────────────────────────
 * 1. Create the adapter (e.g. `paymob.adapter.ts`) implementing `IPaymentProvider`
 * 2. Import it here and add a case to `get()`
 * 3. Add the key to `PaymentProviderKey` in the interface file
 *
 * ── Singleton pattern ──────────────────────────────────────────────────────
 * Adapters are instantiated once and cached.  This avoids re-instantiation on
 * every request and matches how the Stripe SDK is already initialised as a
 * module-level singleton in `config/stripe.ts`.
 */

import type { IPaymentProvider, PaymentProviderKey } from './payment-provider.interface';
import { StripeAdapter } from './stripe.adapter';
import { PaymobAdapter } from './paymob.adapter';

class PaymentProviderFactory {
  private readonly cache = new Map<PaymentProviderKey, IPaymentProvider>();

  /**
   * Returns a cached adapter instance for the given provider key.
   * Throws if an unsupported key is requested — fail fast rather than silently
   * using the wrong provider.
   */
  get(key: PaymentProviderKey): IPaymentProvider {
    const cached = this.cache.get(key);
    if (cached) return cached;

    let adapter: IPaymentProvider;

    switch (key) {
      case 'stripe':
        adapter = new StripeAdapter();
        break;

      case 'paymob':
        adapter = new PaymobAdapter();
        break;

      default: {
        // TypeScript exhaustiveness check — if a new key is added to
        // PaymentProviderKey but not handled here, this line causes a
        // compile-time error.
        const _exhaustive: never = key;
        throw new Error(`Unsupported payment provider: ${_exhaustive}`);
      }
    }

    this.cache.set(key, adapter);
    return adapter;
  }

  /**
   * Clears the adapter cache.
   * Intended for use in tests where a fresh adapter instance is needed.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export a single factory instance — the application's central registry.
export const paymentProviderFactory = new PaymentProviderFactory();
