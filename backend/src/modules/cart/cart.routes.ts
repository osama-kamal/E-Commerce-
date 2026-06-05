import { Router } from 'express';
import { authenticateJWT } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { addItemSchema, updateItemSchema, itemParamSchema } from './cart.schemas';
import { getCart, addItem, updateItem, removeItem, clearCart } from './cart.controller';

const router = Router();

// All cart routes require authentication
router.use(authenticateJWT);

router.get('/', getCart);
router.post('/items', validate(addItemSchema), addItem);
router.put('/items/:productId', validate(updateItemSchema), updateItem);
router.delete('/items/:productId', validate(itemParamSchema), removeItem);
router.delete('/', clearCart);

export default router;
