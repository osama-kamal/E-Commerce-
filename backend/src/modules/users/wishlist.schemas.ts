import { z } from 'zod';

export const wishlistProductSchema = z.object({
  params: z.object({ productId: z.string().min(1, 'Product ID is required') }),
});
