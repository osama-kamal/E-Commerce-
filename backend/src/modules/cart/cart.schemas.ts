import { z } from 'zod';

export const addItemSchema = z.object({
  body: z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
    selectedSize: z.string().optional(),
  }),
});

export const updateItemSchema = z.object({
  params: z.object({ productId: z.string().min(1, 'Product ID is required') }),
  body: z.object({
    quantity: z.coerce.number().int().min(0, 'Quantity must be 0 or more'),
    selectedSize: z.string().optional(),
  }),
});

export const itemParamSchema = z.object({
  params: z.object({ productId: z.string().min(1, 'Product ID is required') }),
});
