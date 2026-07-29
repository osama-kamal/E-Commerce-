import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { User } from '../types';
import { authApi } from '../api/auth';

// ── Security note ─────────────────────────────────────────────────────────────
// The refresh token is now stored exclusively in an httpOnly cookie set by the
// backend — it is never stored in localStorage or Redux state, making it
// inaccessible to JavaScript and immune to XSS token theft.
//
// Only the short-lived access token (15 min) and non-sensitive user profile
// remain in memory (Redux) and localStorage.

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

function safeParseUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    // Malformed JSON in localStorage — clear it and start fresh
    localStorage.removeItem('user');
    return null;
  }
}

const initialState: AuthState = {
  user: safeParseUser(),
  accessToken: localStorage.getItem('accessToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Called after login / register — backend now sets the refresh cookie automatically.
    // We only store the access token + user profile on the client side.
    setCredentials(state, action: PayloadAction<{ user: User; accessToken: string }>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
      localStorage.setItem('user', JSON.stringify(action.payload.user));
      localStorage.setItem('accessToken', action.payload.accessToken);
      // refreshToken intentionally NOT stored here — lives in httpOnly cookie only
    },

    // Called after a successful silent token refresh — only the new access token is returned.
    setTokens(state, action: PayloadAction<{ accessToken: string }>) {
      state.accessToken = action.payload.accessToken;
      localStorage.setItem('accessToken', action.payload.accessToken);
      // refreshToken rotation is handled server-side via the httpOnly cookie
    },

    logout(state) {
      state.user = null;
      state.accessToken = null;
      state.isAuthenticated = false;
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      // No refreshToken to remove from localStorage — it was never stored there
      localStorage.removeItem('currentStoreId');
      localStorage.removeItem('currentStore');
      // Clear impersonation backup so the yellow banner never leaks after logout
      localStorage.removeItem('platformAdminToken');
      localStorage.removeItem('platformAdminStore');
    },
  },
});

export const { setCredentials, setTokens, logout } = authSlice.actions;

/**
 * Full sign-out: revoke the session on the server, then clear local state.
 *
 * Use this for every user-initiated logout. The bare `logout` reducer only
 * clears the client, which is correct for the axios interceptor (where a
 * refresh has already failed) but NOT for a logout button.
 *
 * Previously Navbar guarded the API call on
 * `localStorage.getItem('refreshToken')`, which is always null because the token
 * lives in an httpOnly cookie — so the request never fired, the server-side
 * token was never revoked, and the backend never cleared the cookie. The 7-day
 * session survived "logging out".
 *
 * The server call needs no argument: the cookie is sent automatically via
 * `withCredentials`.
 */
export const logoutThunk = createAsyncThunk(
  'auth/logoutThunk',
  async (_: void, { dispatch }) => {
    try {
      await authApi.logout();
    } catch {
      // Never block sign-out on a network failure — the user still expects the
      // local session to end. The server token expires on its own TTL.
    }
    dispatch(logout());
  }
);

export default authSlice.reducer;
