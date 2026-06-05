import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { couponsApi } from '../api/coupons';

interface CouponState {
  code: string | null;
  discount: number;   // final dollar amount to subtract
  label: string;
  loading: boolean;
  error: string | null;
}

const initialState: CouponState = {
  code: null,
  discount: 0,
  label: '',
  loading: false,
  error: null,
};

/**
 * Validates a coupon code against the current cart subtotal via the server.
 */
export const validateCouponThunk = createAsyncThunk(
  'coupon/validate',
  async ({ code, subtotal }: { code: string; subtotal: number }, { rejectWithValue }) => {
    try {
      const res = await couponsApi.validate(code, subtotal);
      return res.data.data; // { discount, label, code }
    } catch (err: any) {
      const message: string =
        err.response?.data?.message ?? 'Invalid coupon code';
      return rejectWithValue(message);
    }
  }
);

const couponSlice = createSlice({
  name: 'coupon',
  initialState,
  reducers: {
    removeCoupon(state) {
      state.code = null;
      state.discount = 0;
      state.label = '';
      state.error = null;
    },
    clearCouponError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(validateCouponThunk.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(validateCouponThunk.fulfilled, (state, action) => {
        state.loading = false;
        state.code = action.payload.code;
        state.discount = action.payload.discount;
        state.label = action.payload.label;
        state.error = null;
      })
      .addCase(validateCouponThunk.rejected, (state, action) => {
        state.loading = false;
        state.code = null;
        state.discount = 0;
        state.label = '';
        state.error = action.payload as string;
      });
  },
});

export const { removeCoupon, clearCouponError } = couponSlice.actions;
export default couponSlice.reducer;
