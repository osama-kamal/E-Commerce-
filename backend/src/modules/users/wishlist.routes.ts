import { Router } from 'express';
import { authenticateJWT } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { wishlistProductSchema } from './wishlist.schemas';
import { getWishlist, addToWishlist, removeFromWishlist, moveToCart } from './wishlist.controller';

const router = Router();

// All wishlist routes require authentication
router.use(authenticateJWT);

router.get('/', getWishlist);
router.post('/:productId', validate(wishlistProductSchema), addToWishlist);
router.delete('/:productId', validate(wishlistProductSchema), removeFromWishlist);
router.post('/:productId/move-to-cart', validate(wishlistProductSchema), moveToCart);

export default router;
