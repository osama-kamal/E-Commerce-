import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Store } from '../types';
import axios from 'axios';
import { getHostTenant } from '../api/activeTenant';

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
  // Priority order for resolving which store to load:
  //   1. Host tenant — this deployment's domain belongs to a store, so that
  //      store wins over anything a previous session left in storage.
  //   2. currentStoreId in localStorage (the store the user last selected in
  //      the admin switcher)
  //   3. storeId embedded in the JWT (the store this account belongs to)
  //
  // There is deliberately no env-var fallback any more. `VITE_STORE_ID` sat at
  // the bottom of this list and meant that on the platform's own domain every
  // visitor loaded one hardcoded tenant. Resolving to NOTHING is the correct
  // answer on a platform host: there is no current store, and pages that need
  // one say so rather than silently showing someone else's shop.
  let storeId = getHostTenant()?.storeId ?? localStorage.getItem('currentStoreId');

  if (!storeId) {
    // Try to extract storeId from the JWT payload
    try {
      const token = localStorage.getItem('accessToken');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (typeof payload?.storeId === 'string' && payload.storeId) {
          storeId = payload.storeId;
        }
      }
    } catch {
      // Malformed token — no store to load
    }
  }

  if (!storeId) return null;

  const res = await axios.get<{ data: Store }>('/api/v1/stores/current', {
    headers: { 'X-Store-ID': storeId },
  });
  return res.data.data;
});

/** Fetch all stores owned by the authenticated user.
 *
 * - Super-admin (JWT role === 'super-admin'): fetches all tenant stores via
 *   /api/v1/admin/stores for the platform management view.
 * - All other authenticated users (store admins): fetches their own stores
 *   via GET /api/v1/stores/mine so multi-store owners can switch between them.
 */
export const fetchMyStores = createAsyncThunk('store/fetchMine', async () => {
  const token = localStorage.getItem('accessToken') || '';

  // Decode role from JWT (client-side only — not a security gate, just UI)
  let jwtRole: string | undefined;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    jwtRole = typeof payload?.role === 'string' ? payload.role : undefined;
  } catch { /* ignore malformed token */ }

  const isSuperAdmin = jwtRole === 'super-admin';

  if (isSuperAdmin) {
    // Super-admin: fetch all tenant stores for the platform management list
    const res = await axios.get<{ data: { data: import('../types').Store[] } }>('/api/v1/admin/stores', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data.data ?? [];
  }

  // Store admin: fetch only stores owned by this user (supports multi-store owners).
  // No X-Store-ID header — queries by ownerId, independent of active store context.
  const res = await axios.get<{ data: import('../types').Store[] }>('/api/v1/stores/mine', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.data ?? [];
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
