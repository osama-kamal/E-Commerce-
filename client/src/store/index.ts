import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import cartReducer from './cartSlice';
import wishlistReducer from './wishlistSlice';
import couponReducer from './couponSlice';
import comparisonReducer from './comparisonSlice';
import notificationReducer from './notificationSlice';
import storeReducer from './storeSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    cart: cartReducer,
    wishlist: wishlistReducer,
    coupon: couponReducer,
    comparison: comparisonReducer,
    notifications: notificationReducer,
    currentStore: storeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
