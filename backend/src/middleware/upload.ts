import multer, { FileFilterCallback } from 'multer';
import { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import { createError } from './errorHandler';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (increased since we'll optimize)

// Use memory storage — no local disk writes needed since files go straight to Cloudinary
const storage = multer.memoryStorage();

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  }
}

export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
}).single('image');

/**
 * Magic-byte verification — mimetype alone is spoofable.
 * Verifies the buffer is actually a decodable image via sharp metadata.
 * Must run AFTER multer (needs req.file.buffer).
 */
export async function verifyImageMagic(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.file) return next();
  try {
    const metadata = await sharp(req.file.buffer).metadata();
    if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
      return next(createError(`Invalid image format: ${metadata.format ?? 'unknown'}. Only JPEG, PNG, WebP, GIF allowed`, 400, 'BAD_REQUEST'));
    }
    next();
  } catch (err) {
    // sharp throws on non-image buffers
    if ((err as Error & { status?: number })?.status === 400) return next(err);
    return next(createError('File is not a valid image', 400, 'BAD_REQUEST'));
  }
}
