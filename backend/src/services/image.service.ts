/**
 * Image Optimization Service
 * Handles image compression, resizing, and format conversion using Sharp
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';

interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
  createThumbnail?: boolean;
  thumbnailSize?: number;
}

interface OptimizationResult {
  optimizedPath: string;
  thumbnailPath?: string;
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
}

const DEFAULT_OPTIONS: ImageOptimizationOptions = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 85,
  format: 'webp',
  createThumbnail: true,
  thumbnailSize: 300,
};

/**
 * Optimize an uploaded image
 * - Resize to max dimensions
 * - Convert to WebP format (smaller size, better quality)
 * - Compress with quality setting
 * - Optionally create thumbnail
 */
export async function optimizeImage(
  inputPath: string,
  options: ImageOptimizationOptions = {}
): Promise<OptimizationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Get original file size
  const stats = await fs.stat(inputPath);
  const originalSize = stats.size;

  // Parse file paths
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const dirname = path.dirname(inputPath);
  
  // Output paths - add "-optimized" suffix to avoid same file conflict
  const optimizedPath = path.join(dirname, `${basename}-optimized.${opts.format}`);
  const thumbnailPath = opts.createThumbnail
    ? path.join(dirname, `${basename}-thumb.${opts.format}`)
    : undefined;

  // Optimize main image
  await sharp(inputPath)
    .resize(opts.maxWidth, opts.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFormat(opts.format!, { quality: opts.quality })
    .toFile(optimizedPath);

  // Create thumbnail if requested
  if (opts.createThumbnail && thumbnailPath) {
    await sharp(inputPath)
      .resize(opts.thumbnailSize, opts.thumbnailSize, {
        fit: 'cover',
        position: 'center',
      })
      .toFormat(opts.format!, { quality: opts.quality })
      .toFile(thumbnailPath);
  }

  // Get optimized file size
  const optimizedStats = await fs.stat(optimizedPath);
  const optimizedSize = optimizedStats.size;
  const compressionRatio = Math.round((1 - optimizedSize / originalSize) * 100);

  // Delete original file
  await fs.unlink(inputPath).catch(() => {});

  return {
    optimizedPath,
    thumbnailPath,
    originalSize,
    optimizedSize,
    compressionRatio,
  };
}

/**
 * Get image metadata (dimensions, format, size)
 */
export async function getImageMetadata(imagePath: string) {
  const metadata = await sharp(imagePath).metadata();
  const stats = await fs.stat(imagePath);
  
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: stats.size,
    sizeKB: Math.round(stats.size / 1024),
    sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
  };
}

/**
 * Batch optimize multiple images
 */
export async function optimizeImages(
  inputPaths: string[],
  options: ImageOptimizationOptions = {}
): Promise<OptimizationResult[]> {
  const results = await Promise.all(
    inputPaths.map(path => optimizeImage(path, options))
  );
  return results;
}
