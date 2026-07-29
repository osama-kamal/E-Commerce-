import api from './axios';
import axios from 'axios';
import { User } from '../types';

// Headers that strip all store context — used for admin login so the server
// runs the global lookup (role: admin) rather than the store-scoped lookup
// (which would find a customer account with the same email).
const NO_STORE_HEADERS = {
  'X-Store-ID': '',
  'X-Store-Slug': '',
};

export const authApi = {
  register: (email: string, password: string) =>
    api.post<{ data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/register', { email, password }
    ),

  // Login intentionally bypasses the store-context headers so the server can
  // always find the admin-role document regardless of which store the browser
  // thinks is active. This prevents a storefront customer session from blocking
  // the store owner from logging into /admin.
  login: (email: string, password: string) =>
    axios.post<{ data: { user: User; accessToken: string } }>(
      '/api/v1/auth/login',
      { email, password },
      {
        withCredentials: true, // needed for the httpOnly refresh-token cookie
        headers: {
          'Content-Type': 'application/json',
          ...NO_STORE_HEADERS,
          // Send the access token if we have one (allows the server to identify
          // which admin account is logging in on a token refresh)
          ...(localStorage.getItem('accessToken')
            ? { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
            : {}),
        },
      }
    ),

  // No argument: the refresh token travels in the httpOnly cookie, which axios
  // sends automatically (withCredentials). The old signature took a token read
  // from localStorage — a key that is never written, so callers guarded on a
  // value that was always null and the request never went out.
  logout: () => api.post('/auth/logout'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post(`/auth/reset-password/${token}`, { password }),
};
