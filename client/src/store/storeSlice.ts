import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Store } from '../types';
import axios from 'axios';

// ── Persistence helpers ───────────────────────────────────────────────────────

const STORE_KEY = 'currentStore';

function loadStoredStore(): Store | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : null;
  } catch {
    return null;
  }
}

function persistStore(store: Store | null): void {
  if (store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    localStorage.setItem('currentStoreId', store._id);
  } else {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem('currentStoreId');
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

interface StoreState {
  current: Store | null;
  myStores: Store[];
  loading: boolean;
  myStoresLoading: boolean;
}

const initialState: StoreState = {
  // Hydrate from localStorage immediately — no async gap on refresh
  current: loadStoredStore(),
  myStores: [],
  loading: false,
  myStoresLoading: false,
};

// ── Thunks ────────────────────────────────────────────────────────────────────

/** Fetch the current store from the backend and refresh the cached copy. */
export const fetchCurrentStore = createAsyncThunk('store/fetchCurrent', async () => {
  const storeId = localStorage.getItem('currentStoreId') || import.meta.env.VITE_STORE_ID;
  if (!storeId) return null;

  const res = await axios.get<{ data: Store }>('/api/v1/stores/current', {
    headers: { 'X-Store-ID': storeId },
  });
  return res.data.data;
});

/** Fetch all stores owned by the authenticated user.
 *  If the user is a super-admin (role: admin), returns ALL stores. */
export const fetchMyStores = createAsyncThunk('store/fetchMine', async () => {
  const token = localStorage.getItem('accessToken') || '';

  // Decode role from JWT without a full verify (client-side only, for UI purposes)
  let role = 'customer';
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    role = payload.role ?? 'customer';
  } catch { /* ignore */ }

  if (role === 'admin') {
    // Super-admin: fetch all stores
    const res = await axios.get<{ data: { data: import('../types').Store[] } }>('/api/v1/admin/stores', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data.data ?? [];
  } else {
    // Regular user: fetch only owned stores
    const res = await axios.get<{ data: import('../types').Store[] }>('/api/v1/stores/mine', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data;
  }
});

// ── Slice ─────────────────────────────────────────────────────────────────────

const storeSlice = createSlice({
  name: 'store',
  initialState,
  reducers: {
    setCurrentStore(state, action: PayloadAction<Store>) {
      state.current = action.payload;
      // Persist immediately so refresh keeps the same store
      persistStore(action.payload);
    },
    clearCurrentStore(state) {
      state.current = null;
      persistStore(null);
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchCurrentStore.pending, state => { state.loading = true; })
      .addCase(fetchCurrentStore.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload) {
          state.current = action.payload;
          // Refresh the cached copy with latest data from server
          persistStore(action.payload);
        }
      })
      .addCase(fetchCurrentStore.rejected, state => { state.loading = false; })

      .addCase(fetchMyStores.pending, state => { state.myStoresLoading = true; })
      .addCase(fetchMyStores.fulfilled, (state, action) => {
        state.myStoresLoading = false;
        state.myStores = action.payload;
      })
      .addCase(fetchMyStores.rejected, state => { state.myStoresLoading = false; });
  },
});

export const { setCurrentStore, clearCurrentStore } = storeSlice.actions;
export default storeSlice.reducer;
