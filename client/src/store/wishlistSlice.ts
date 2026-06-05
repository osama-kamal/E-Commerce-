import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { WishlistProduct } from '../types';

interface WishlistState {
  items: WishlistProduct[];
  loaded: boolean; // true once fetched from API
}

const initialState: WishlistState = { items: [], loaded: false };

const wishlistSlice = createSlice({
  name: 'wishlist',
  initialState,
  reducers: {
    setWishlist(state, action: PayloadAction<WishlistProduct[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    addToWishlist(state, action: PayloadAction<WishlistProduct>) {
      if (!state.items.find(i => i._id === action.payload._id)) {
        state.items.push(action.payload);
      }
    },
    removeFromWishlist(state, action: PayloadAction<string>) {
      state.items = state.items.filter(i => i._id !== action.payload);
    },
    clearWishlist(state) {
      state.items = [];
      state.loaded = false;
    },
  },
});

export const { setWishlist, addToWishlist, removeFromWishlist, clearWishlist } = wishlistSlice.actions;
export default wishlistSlice.reducer;
