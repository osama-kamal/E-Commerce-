import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
} from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { cartApi } from '../api/cart';
import { setCart } from '../store/cartSlice';
import { Cart } from '../types';
import toast from 'react-hot-toast';

// ── Query key ──────────────────────────────────────────────────────────────────
export const CART_KEY = ['cart'] as const;

// ── useCart ────────────────────────────────────────────────────────────────────
// Fetches the cart and keeps it in the React Query cache.
// Also syncs the result into Redux so the Navbar cart count badge stays accurate.
export function useCart() {
  const dispatch = useDispatch();

  return useQuery<Cart>({
    queryKey: CART_KEY,
    queryFn: async () => {
      const res = await cartApi.get();
      dispatch(setCart(res.data.data)); // keep Redux in sync for Navbar badge
      return res.data.data;
    },
    staleTime: 2 * 60 * 1000, // 2 min — cart is user-specific, refresh fairly often
  });
}

// ── Shared optimistic-update helpers ──────────────────────────────────────────

/**
 * Snapshot the current cart, apply an optimistic mutation, and return the
 * snapshot so onError can roll it back.
 */
function applyOptimistic(
  qc: QueryClient,
  dispatch: ReturnType<typeof useDispatch>,
  updater: (prev: Cart) => Cart
): Cart | undefined {
  qc.cancelQueries({ queryKey: CART_KEY });
  const snapshot = qc.getQueryData<Cart>(CART_KEY);
  if (snapshot) {
    const optimistic = updater(snapshot);
    qc.setQueryData<Cart>(CART_KEY, optimistic);
    dispatch(setCart(optimistic)); // keep Navbar badge in sync immediately
  }
  return snapshot;
}

function rollback(
  qc: QueryClient,
  dispatch: ReturnType<typeof useDispatch>,
  snapshot: Cart | undefined
) {
  if (snapshot) {
    qc.setQueryData<Cart>(CART_KEY, snapshot);
    dispatch(setCart(snapshot));
  }
}

function settle(qc: QueryClient, dispatch: ReturnType<typeof useDispatch>, serverCart: Cart) {
  // Replace optimistic state with the authoritative server response
  qc.setQueryData<Cart>(CART_KEY, serverCart);
  dispatch(setCart(serverCart));
}

// ── useAddToCart ───────────────────────────────────────────────────────────────
export function useAddToCart() {
  const qc = useQueryClient();
  const dispatch = useDispatch();

  return useMutation<
    Cart,
    Error,
    { productId: string; quantity: number; selectedSize?: string; productName?: string },
    { snapshot: Cart | undefined }
  >({
    mutationFn: async ({ productId, quantity, selectedSize }) => {
      const res = await cartApi.addItem(productId, quantity, selectedSize);
      return res.data.data;
    },

    onMutate: async ({ productId, quantity, selectedSize, productName }) => {
      const snapshot = applyOptimistic(qc, dispatch, (prev) => {
        const existingIdx = prev.items.findIndex(
          // Normalise both sides to string — server may return ObjectId-shaped strings
          (i) => String(i.productId) === String(productId) &&
                 (i.selectedSize ?? undefined) === (selectedSize ?? undefined)
        );
        let items = [...prev.items];
        if (existingIdx >= 0) {
          const item = items[existingIdx];
          const newQty = item.quantity + quantity;
          items[existingIdx] = {
            ...item,
            quantity: newQty,
            lineTotal: Math.round(item.currentPrice * newQty * 100) / 100,
          };
        } else {
          // We don't know the price yet — use 0 as placeholder; server will correct it
          items = [
            ...items,
            {
              productId,
              name: productName ?? 'Product',
              currentPrice: 0,
              quantity,
              lineTotal: 0,
              selectedSize,
            },
          ];
        }
        const subtotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
        return { ...prev, items, subtotal };
      });
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      rollback(qc, dispatch, ctx?.snapshot);
      // toast is already shown by the axios interceptor
    },

    onSuccess: (serverCart) => {
      settle(qc, dispatch, serverCart);
      toast.success('Added to cart!');
    },
  });
}

// ── useUpdateCartItem ──────────────────────────────────────────────────────────
export function useUpdateCartItem() {
  const qc = useQueryClient();
  const dispatch = useDispatch();

  return useMutation<
    Cart,
    Error,
    { productId: string; quantity: number },
    { snapshot: Cart | undefined }
  >({
    mutationFn: async ({ productId, quantity }) => {
      if (quantity === 0) {
        const res = await cartApi.removeItem(productId);
        return res.data.data;
      }
      const res = await cartApi.updateItem(productId, quantity);
      return res.data.data;
    },

    onMutate: async ({ productId, quantity }) => {
      const snapshot = applyOptimistic(qc, dispatch, (prev) => {
        let items = prev.items
          .map((i) => {
            if (i.productId !== productId) return i;
            return {
              ...i,
              quantity,
              lineTotal: Math.round(i.currentPrice * quantity * 100) / 100,
            };
          })
          .filter((i) => i.quantity > 0);
        const subtotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
        return { ...prev, items, subtotal };
      });
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      rollback(qc, dispatch, ctx?.snapshot);
    },

    onSuccess: (serverCart) => {
      settle(qc, dispatch, serverCart);
    },
  });
}

// ── useRemoveCartItem ──────────────────────────────────────────────────────────
export function useRemoveCartItem() {
  const qc = useQueryClient();
  const dispatch = useDispatch();

  return useMutation<
    Cart,
    Error,
    { productId: string },
    { snapshot: Cart | undefined }
  >({
    mutationFn: async ({ productId }) => {
      const res = await cartApi.removeItem(productId);
      return res.data.data;
    },

    onMutate: async ({ productId }) => {
      const snapshot = applyOptimistic(qc, dispatch, (prev) => {
        const items = prev.items.filter((i) => i.productId !== productId);
        const subtotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
        return { ...prev, items, subtotal };
      });
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      rollback(qc, dispatch, ctx?.snapshot);
    },

    onSuccess: (serverCart) => {
      settle(qc, dispatch, serverCart);
      toast('Item removed', { icon: '🗑️' });
    },
  });
}

// ── useClearCart ───────────────────────────────────────────────────────────────
export function useClearCart() {
  const qc = useQueryClient();
  const dispatch = useDispatch();

  return useMutation<Cart, Error, void, { snapshot: Cart | undefined }>({
    mutationFn: async () => {
      const res = await cartApi.clear();
      return res.data.data;
    },

    onMutate: async () => {
      const snapshot = applyOptimistic(qc, dispatch, (prev) => ({
        ...prev,
        items: [],
        subtotal: 0,
      }));
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      rollback(qc, dispatch, ctx?.snapshot);
    },

    onSuccess: (serverCart) => {
      settle(qc, dispatch, serverCart);
    },
  });
}
