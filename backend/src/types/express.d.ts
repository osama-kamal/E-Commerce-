import { Types } from 'mongoose';
import { IStore } from '../modules/stores/store.model';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: Types.ObjectId;
        role: 'admin' | 'customer';
        storeId?: Types.ObjectId; // set by resolveStore middleware
      };
      /** The resolved tenant store — set by resolveStore middleware */
      store?: IStore;
    }
  }
}
