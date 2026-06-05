import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(200),
    description: z.string().min(1, 'Description is required'),
    price: z.coerce.number().min(0, 'Price must be non-negative'),
    stock: z.coerce.number().int().min(0, 'Stock must be non-negative').default(0),
    categoryId: z.string().min(1, 'Category ID is required'),
    sizes: z.array(z.string()).optional(),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).optional(),
    price: z.coerce.number().min(0).optional(),
    stock: z.coerce.number().int().min(0).optional(),
    categoryId: z.string().optional(),
    sizes: z.array(z.string()).optional(),
  }),
});

export const productIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'ID is required') }),
});

export const listProductsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    category: z.string().optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    inStock: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
  }),
});
