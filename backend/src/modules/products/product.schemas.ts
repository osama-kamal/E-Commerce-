import { z } from 'zod';

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character ID');

// Bulk operations are capped so a single request cannot be used to drive an
// unbounded updateMany/deleteMany.
const bulkIds = z
  .array(objectIdString)
  .min(1, 'At least one product ID is required')
  .max(500, 'Cannot process more than 500 products in one request');

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(200),
    description: z.string().min(1, 'Description is required'),
    price: z.coerce.number().min(0, 'Price must be non-negative'),
    stock: z.coerce.number().int().min(0, 'Stock must be non-negative').default(0),
    categoryId: z.string().min(1, 'Category ID is required'),
    sizes: z.array(z.string()).optional(),
    discount: z.coerce.number().min(0).max(100).optional(),
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
    discount: z.coerce.number().min(0).max(100).optional(),
  }),
});

export const productIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'ID is required') }),
});

export const bulkDeleteProductsSchema = z.object({
  body: z.object({ ids: bulkIds }),
});

/**
 * Strict allow-list for bulk field updates.
 *
 * `.strict()` (reject unknown keys) rather than the Zod default (silently strip)
 * is deliberate and load-bearing: the `validate` middleware does not write the
 * parsed result back onto `req`, so the controller still reads the RAW body.
 * Stripping would therefore protect nothing — only outright rejection does.
 *
 * Fields NOT listed here were previously writable and must stay unwritable:
 *   storeId       — moving a product into another tenant's catalogue
 *   isDeleted     — resurrecting soft-deleted products
 *   averageRating / reviewCount — forging social proof
 */
export const bulkUpdateProductsSchema = z.object({
  body: z.object({
    ids: bulkIds,
    updates: z
      .object({
        price: z.number().min(0, 'Price must be non-negative').optional(),
        stock: z.number().int().min(0, 'Stock must be non-negative').optional(),
        discount: z.number().min(0).max(100, 'Discount must be between 0 and 100').optional(),
        categoryId: objectIdString.optional(),
      })
      .strict('Only price, stock, discount and categoryId can be updated in bulk')
      .refine((u) => Object.keys(u).length > 0, {
        message: 'updates must contain at least one field',
      }),
  }),
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
    // onSale and sortBy are read by product.controller.listProducts. They MUST be
    // declared here — once `validate` writes the parsed query back onto req, any
    // field missing from this schema is dropped and the filter/sort silently breaks.
    // Both stay strings: the service compares onSale === 'true' and sortBy === 'price_asc'.
    onSale: z.enum(['true', 'false']).optional(),
    sortBy: z.string().max(32).optional(),
  }),
});
