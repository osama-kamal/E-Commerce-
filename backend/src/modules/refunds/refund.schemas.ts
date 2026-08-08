import { z } from 'zod';

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character ID');

const refundLine = z.object({
  productId: objectIdString,
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

/**
 * Note what is NOT accepted: any monetary amount.
 *
 * The caller names WHICH items come back; the server decides what that is
 * worth, from the order's own stored breakdown. Accepting an amount would let
 * a compromised admin session move arbitrary money out of the merchant's
 * gateway — the same reasoning that keeps `discountAmount` off the checkout
 * schema.
 */
const refundBody = z.object({
  lines: z.array(refundLine).max(100).optional(),
  /** Refund everything still outstanding. Ignores `lines` when true. */
  refundAll: z.boolean().optional(),
  refundShipping: z.boolean().optional(),
  /** Whether returned units go back on sale. Defaults to true. */
  restock: z.boolean().optional(),
  reason: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const previewRefundSchema = z.object({
  params: z.object({ id: objectIdString }),
  body: refundBody,
});

export const createRefundSchema = z.object({
  params: z.object({ id: objectIdString }),
  body: refundBody,
});

export const listRefundsSchema = z.object({
  params: z.object({ id: objectIdString }),
});
