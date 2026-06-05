import { z } from 'zod';

// Reusable MongoDB ObjectId validator
const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character hex ID');

export const dateRangeSchema = z.object({
  query: z.object({
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
});

export const paginationSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    role: z.enum(['admin', 'customer']).optional(),
  }),
});

export const userIdParamSchema = z.object({
  params: z.object({ id: objectIdSchema }),
});

export const toggleStatusSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: z.object({
    isActive: z.boolean({ required_error: 'isActive is required' }),
  }),
});

export const updateRoleSchema = z.object({
  params: z.object({ id: objectIdSchema }),
  body: z.object({
    role: z.enum(['admin', 'customer'], {
      required_error: 'role is required',
      invalid_type_error: "role must be 'admin' or 'customer'",
    }),
  }),
});

export const orderFilterSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z
      .enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
      .optional(),
    userId: objectIdSchema.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  }),
});
