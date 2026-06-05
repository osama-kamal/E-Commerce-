import { Request, Response, NextFunction } from 'express';
import * as productService from './product.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';
import { cloudinaryService } from '../../services/cloudinary.service';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, category, minPrice, maxPrice, inStock, search, onSale, sortBy } = req.query as Record<string, string>;
    const result = await productService.listProducts({
      storeId: getStoreId(req),
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(Math.max(1, Number(limit) || 20), 50), // cap at 50 per page
      category,
      minPrice: minPrice !== undefined ? Number(minPrice) : undefined,
      maxPrice: maxPrice !== undefined ? Number(maxPrice) : undefined,
      inStock,
      search,
      onSale,
      sortBy,
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.getProductById(req.params.id, getStoreId(req));
    sendSuccess(res, product);
  } catch (err) { next(err); }
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.createProduct({ ...req.body, storeId: getStoreId(req) });
    sendSuccess(res, product, 201);
  } catch (err) { next(err); }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.updateProduct(req.params.id, getStoreId(req), req.body);
    sendSuccess(res, product);
  } catch (err) { next(err); }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await productService.softDeleteProduct(req.params.id, getStoreId(req));
    sendSuccess(res, { message: 'Product deleted' });
  } catch (err) { next(err); }
}

export async function uploadProductImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      return next(createError('Image file is required', 400, 'BAD_REQUEST'));
    }

    const uploadResult = await cloudinaryService.uploadImage(req.file.buffer, 'products');
    const product = await productService.addProductImage(req.params.id, getStoreId(req), uploadResult.url);

    sendSuccess(res, {
      imageUrl: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnail,
      publicId: uploadResult.publicId,
      product,
      message: 'Image uploaded successfully to Cloudinary CDN',
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteProductImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return next(createError('imageUrl is required', 400, 'BAD_REQUEST'));

    const product = await productService.removeProductImage(req.params.id, getStoreId(req), imageUrl);
    sendSuccess(res, { product, message: 'Image deleted successfully' });
  } catch (err) { next(err); }
}

export async function bulkDeleteProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return next(createError('ids array is required', 400, 'BAD_REQUEST'));
    }
    const count = await productService.bulkDeleteProducts(ids, getStoreId(req));
    sendSuccess(res, { deletedCount: count, message: `${count} products deleted` });
  } catch (err) { next(err); }
}

export async function bulkUpdateProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return next(createError('ids array is required', 400, 'BAD_REQUEST'));
    }
    if (!updates || typeof updates !== 'object') {
      return next(createError('updates object is required', 400, 'BAD_REQUEST'));
    }
    const count = await productService.bulkUpdateProducts(ids, getStoreId(req), updates);
    sendSuccess(res, { updatedCount: count, message: `${count} products updated` });
  } catch (err) { next(err); }
}
