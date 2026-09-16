import axios from 'axios';
import { Store } from '../types';

/**
 * Host → store resolution.
 *
 * Uses a bare axios call rather than the shared instance on purpose: this runs
 * BEFORE the tenant is known, so the instance's interceptor would have nothing
 * useful to attach and its global error toast would fire on the perfectly
 * normal "this is the platform host" answer.
 */
export const siteApi = {
  /**
   * Which store, if any, serves this hostname.
   *
   * `{ store: null }` means the platform host — an expected answer, not a
   * failure. The endpoint returns 200 for it so a cold load of the marketing
   * page does not surface an error.
   */
  resolveHost: (host: string) =>
    axios.get<{ data: { store: Store | null } }>('/api/v1/stores/resolve', {
      params: { host },
    }),

  /** Dev-only path: resolve a store by slug so localhost can act as a storefront. */
  resolveSlug: (slug: string) =>
    axios.get<{ data: Store }>(`/api/v1/stores/by-slug/${encodeURIComponent(slug)}`),
};
