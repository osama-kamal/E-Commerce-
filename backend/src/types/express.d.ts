import { Types } from 'mongoose';
import { IStore } from '../modules/stores/store.model';
import { SubscriptionAccess } from '../modules/stores/subscription-access';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: Types.ObjectId;
        role: 'super-admin' | 'admin' | 'customer';
        storeId?: Types.ObjectId; // set by resolveStore middleware
      };
      /** The resolved tenant store — set by resolveStore middleware */
      store?: IStore;
      /**
       * Resolved entitlement + access level for `store` — set by the
       * enforceSubscription middleware, so quota checks downstream can read
       * `subscription.effectivePlan` instead of the raw `subscriptionPlan`
       * (which still reads 'pro' on a lapsed store).
       */
      subscription?: SubscriptionAccess;
    }
  }
}
