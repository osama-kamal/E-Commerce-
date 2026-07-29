import { z } from 'zod';

const shippingAddressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required'),
});

// NOTE: `discountAmount` is deliberately NOT accepted here.
// The discount is derived server-side from `couponCode` during checkout
// (see order.service.placeOrder). Accepting a client-supplied amount allowed
// any caller to zero out their own order total.
// Unknown keys are stripped by Zod, so older clients that still send
// `discountAmount` continue to work — the value is simply ignored.
export const placeOrderSchema = z.object({
  body: z.object({
    shippingAddress: shippingAddressSchema,
    paymentMethod: z.enum(['online', 'cod']).default('online'),
    couponCode: z.string().trim().min(1).max(64).optional(),
  }),
});

export const orderIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Order ID is required') }),
});

export const paginationSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  }),
});

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character ID');

const bulkIds = z
  .array(objectIdString)
  .min(1, 'At least one order ID is required')
  .max(500, 'Cannot process more than 500 orders in one request');

const orderStatusEnum = z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled'], {
  errorMap: () => ({ message: 'Invalid order status' }),
});

// `updateMany` does NOT run Mongoose validators by default, so without this the
// status enum was unenforced and an arbitrary string could be written to
// order.status — later crashing STATUS_TRANSITIONS[status] lookups with a 500.
export const bulkUpdateStatusSchema = z.object({
  body: z.object({
    ids: bulkIds,
    status: orderStatusEnum,
  }),
});

export const bulkDeleteOrdersSchema = z.object({
  body: z.object({ ids: bulkIds }),
});

export const updateStatusSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Order ID is required') }),
  body: z.object({ status: orderStatusEnum }),
});
