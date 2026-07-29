/**
 * Regression tests for logout actually ending the server-side session.
 *
 * Navbar guarded the API call on a value that can never exist:
 *
 *     const refreshToken = localStorage.getItem('refreshToken');
 *     if (refreshToken) { await authApi.logout(refreshToken); }
 *
 * The refresh token was moved to an httpOnly cookie and nothing writes that key
 * to localStorage, so the guard was always false and `authApi.logout` never ran.
 * AdminLayout's two logout buttons did not even attempt the call.
 *
 * Net effect: "log out" only cleared local state. The server-side refresh token
 * was never revoked and the httpOnly cookie was never cleared (the backend does
 * that inside the logout handler), so the 7-day session stayed live — anyone
 * with the browser could silently re-authenticate via /auth/refresh.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const logoutRequest = vi.fn();
vi.mock('../api/auth', () => ({
  authApi: {
    logout: (...args: unknown[]) => logoutRequest(...args),
  },
}));

import { configureStore } from '@reduxjs/toolkit';
import authReducer, { logout, logoutThunk, setCredentials } from './authSlice';

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

const USER = { _id: 'u1', email: 'a@b.com', role: 'admin' } as never;

beforeEach(() => {
  logoutRequest.mockReset();
  logoutRequest.mockResolvedValue({ data: {} });
  localStorage.clear();
});

describe('logoutThunk', () => {
  it('notifies the server so the refresh token is revoked', async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ user: USER, accessToken: 'tok' }));

    await store.dispatch(logoutThunk());

    expect(logoutRequest).toHaveBeenCalledTimes(1);
  });

  it('does not depend on a refreshToken in localStorage', async () => {
    // The token lives in an httpOnly cookie and is unreadable from JS; the
    // request must go out regardless.
    expect(localStorage.getItem('refreshToken')).toBeNull();

    const store = makeStore();
    await store.dispatch(logoutThunk());

    expect(logoutRequest).toHaveBeenCalledTimes(1);
  });

  it('clears local auth state', async () => {
    const store = makeStore();
    store.dispatch(setCredentials({ user: USER, accessToken: 'tok' }));
    expect(store.getState().auth.isAuthenticated).toBe(true);

    await store.dispatch(logoutThunk());

    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(store.getState().auth.accessToken).toBeNull();
    expect(store.getState().auth.user).toBeNull();
  });

  it('clears persisted keys', async () => {
    localStorage.setItem('accessToken', 'tok');
    localStorage.setItem('user', JSON.stringify(USER));
    localStorage.setItem('currentStoreId', 'store1');
    localStorage.setItem('platformAdminToken', 'ptok');

    const store = makeStore();
    await store.dispatch(logoutThunk());

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('currentStoreId')).toBeNull();
    expect(localStorage.getItem('platformAdminToken')).toBeNull();
  });

  it('still clears local state when the server call fails', async () => {
    // A user must never be stuck logged in because the network is down.
    logoutRequest.mockRejectedValue(new Error('network down'));

    const store = makeStore();
    store.dispatch(setCredentials({ user: USER, accessToken: 'tok' }));

    await store.dispatch(logoutThunk());

    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('does not reject when the server call fails', async () => {
    logoutRequest.mockRejectedValue(new Error('network down'));
    const store = makeStore();

    await expect(store.dispatch(logoutThunk())).resolves.toBeDefined();
  });
});

describe('plain logout reducer', () => {
  it('clears state without contacting the server', () => {
    // Used by the axios interceptor after a refresh has already failed —
    // calling /auth/logout there would be pointless.
    const store = makeStore();
    store.dispatch(setCredentials({ user: USER, accessToken: 'tok' }));

    store.dispatch(logout());

    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(logoutRequest).not.toHaveBeenCalled();
  });
});
