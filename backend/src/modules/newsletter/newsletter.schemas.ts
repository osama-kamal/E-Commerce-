import { z } from 'zod';

export const subscribeSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const unsubscribeSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});
