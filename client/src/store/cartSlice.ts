import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Cart } from '../types';

interface CartState {
  cart: Cart | null;
  loading: boolean;
  lastUpdated: number; // timestamp — increments on every cart change to trigger bounce
}

const initialState: CartState = { cart: null, loading: false, lastUpdated: 0 };

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    setCart(state, action: PayloadAction<Cart>) {
      state.cart = action.payload;
      state.lastUpdated = Date.now();
    },
    setCartLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    clearCart(state) {
      state.cart = null;
    },
  },
});

export const { setCart, setCartLoading, clearCart } = cartSlice.actions;
export default cartSlice.reducer;
