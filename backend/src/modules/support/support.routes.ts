import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { emailLimiter } from '../../middleware/rateLimiter';
import { contactSales } from './support.controller';

const router = Router();

const contactSalesSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    storeName: z.string().min(1, 'Store name is required').max(150),
    phone: z.string().min(5, 'Phone is required').max(30),
    requirements: z.string().max(2000).optional().default(''),
  }),
});

// POST /api/v1/support/contact-sales  — public, no auth required.
// Rate limited: it sends email to the platform operator on every call.
router.post('/contact-sales', emailLimiter, validate(contactSalesSchema), contactSales);

export default router;
