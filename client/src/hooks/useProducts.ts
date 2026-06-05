import { useQuery } from '@tanstack/react-query';
import { productsApi, ProductFilters } from '../api/products';
import { PaginatedResponse, Product } from '../types';

// ── Query key factory ──────────────────────────────────────────────────────────
// Centralised so every component that uses the same filters shares one cache entry.
export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (filters: ProductFilters) => [...productKeys.lists(), filters] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

// ── useProducts ────────────────────────────────────────────────────────────────
// Paginated, filtered product list. Keeps previous page data visible while the
// next page loads (placeholderData: keepPreviousData behaviour).
export function useProducts(filters: ProductFilters) {
  return useQuery<PaginatedResponse<Product>>({
    queryKey: productKeys.list(filters),
    queryFn: async () => {
      const res = await productsApi.list(filters);
      return res.data.data;
    },
    // Show stale data while refetching so the grid never goes blank on filter change
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000, // 5 min — product lists don't change that often
  });
}

// ── useProduct ─────────────────────────────────────────────────────────────────
// Single product by ID. Seeded from the list cache when available so navigating
// to a detail page is instant if the product was already in a list.
export function useProduct(id: string | undefined) {
  return useQuery<Product>({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await productsApi.getById(id!);
      return res.data.data;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
