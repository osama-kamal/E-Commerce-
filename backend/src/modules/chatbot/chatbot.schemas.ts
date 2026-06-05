import { z } from 'zod';

export const chatMessageSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(500),
  }),
});
