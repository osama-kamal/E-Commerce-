import { z } from 'zod';

const shippingAddressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required'),
});

export const placeOrderSchema = z.object({
  body: z.object({
    shippingAddress: shippingAddressSchema,
    discountAmount: z.coerce.number().min(0).default(0),
    couponCode: z.string().optional(),
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

export const updateStatusSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Order ID is required') }),
  body: z.object({
    status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled'], {
      errorMap: () => ({ message: 'Invalid order status' }),
    }),
  }),
});
