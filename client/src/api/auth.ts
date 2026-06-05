import api from './axios';
import { User } from '../types';

export const authApi = {
  register: (email: string, password: string) =>
    api.post<{ data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/register', { email, password }
    ),
  login: (email: string, password: string) =>
    api.post<{ data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/login', { email, password }
    ),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post(`/auth/reset-password/${token}`, { password }),
};
