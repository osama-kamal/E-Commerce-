import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createTaxRateSchema, updateTaxRateSchema, taxRateIdSchema } from './tax.schemas';
import { listTaxRates, createTaxRate, updateTaxRate, deleteTaxRate } from './tax.controller';

const router = Router();

// Tax rates decide what a customer is charged and what the merchant owes a
// revenue authority, so every route here is admin-only. There is deliberately
// no public read: the applicable rate reaches shoppers only through a priced
// quote or a placed order, never as a browsable table.
router.get('/rates', authenticateJWT, authorizeRole('admin'), listTaxRates);
router.post('/rates', authenticateJWT, authorizeRole('admin'), validate(createTaxRateSchema), createTaxRate);
router.put('/rates/:id', authenticateJWT, authorizeRole('admin'), validate(updateTaxRateSchema), updateTaxRate);
router.delete('/rates/:id', authenticateJWT, authorizeRole('admin'), validate(taxRateIdSchema), deleteTaxRate);

export default router;
