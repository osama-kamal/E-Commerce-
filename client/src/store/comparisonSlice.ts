import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Product } from '../types';

interface ComparisonState {
  products: Product[];
}

const initialState: ComparisonState = {
  products: [],
};

const comparisonSlice = createSlice({
  name: 'comparison',
  initialState,
  reducers: {
    addToComparison: (state, action: PayloadAction<Product>) => {
      // Max 4 products for comparison
      if (state.products.length < 4) {
        const exists = state.products.find(p => p._id === action.payload._id);
        if (!exists) {
          state.products.push(action.payload);
        }
      }
    },
    removeFromComparison: (state, action: PayloadAction<string>) => {
      state.products = state.products.filter(p => p._id !== action.payload);
    },
    clearComparison: (state) => {
      state.products = [];
    },
  },
});

export const { addToComparison, removeFromComparison, clearComparison } = comparisonSlice.actions;
export default comparisonSlice.reducer;
