import api from './axios';
import { Refund, RefundPreview } from '../types';

export interface RefundRequest {
  lines?: Array<{ productId: string; quantity: number }>;
  /** Refund everything still outstanding. Ignores `lines` when true. */
  refundAll?: boolean;
  refundShipping?: boolean;
  /** Whether returned units go back on sale. Defaults to true server-side. */
  restock?: boolean;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
}

/**
 * Refund API.
 *
 * Note what these calls never send: an amount. The client names WHICH items are
 * coming back and the server decides what that is worth from the order's own
 * stored breakdown. Accepting a client-supplied figure would let a compromised
 * admin session move arbitrary money out of the merchant's gateway.
 *
 * `preview` exists so the merchant sees the exact figures that will be charged,
 * from the same engine that will charge them — the UI does no money arithmetic.
 */
export const refundsApi = {
  preview: (orderId: string, request: RefundRequest) =>
    api.post<{ data: RefundPreview }>(`/orders/admin/${orderId}/refunds/preview`, request),

  create: (orderId: string, request: RefundRequest) =>
    api.post<{ data: Refund }>(`/orders/admin/${orderId}/refunds`, request),

  list: (orderId: string) =>
    api.get<{ data: Refund[] }>(`/orders/admin/${orderId}/refunds`),
};
