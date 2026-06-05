import cloudinary from '../config/cloudinary';
import fs from 'fs/promises';

export const cloudinaryService = {
  /**
   * Upload image to Cloudinary with automatic optimization.
   * Accepts either a local file path (string) or an in-memory Buffer.
   * When a Buffer is provided no disk I/O is performed.
   * @param source - Local file path or Buffer containing image data
   * @param folder - Cloudinary folder name (e.g., 'products')
   * @returns Cloudinary URL and public_id
   */
  async uploadImage(source: string | Buffer, folder: string = 'products') {
    const uploadOptions = {
      folder,
      transformation: [
        {
          width: 800,
          height: 800,
          crop: 'fill',
          gravity: 'auto',
          quality: 'auto:good',
          fetch_format: 'auto',
        },
      ],
    };

    try {
      let result: any;

      if (Buffer.isBuffer(source)) {
        // Stream the buffer directly to Cloudinary — no temp file needed
        result = await new Promise<any>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, res) => (error ? reject(error) : resolve(res)),
          );
          uploadStream.end(source);
        });
      } else {
        result = await cloudinary.uploader.upload(source, uploadOptions);
        // Delete local file after upload
        await fs.unlink(source).catch(() => {});
      }

      return {
        url: result.secure_url,
        publicId: result.public_id,
        thumbnail: result.secure_url,
      };
    } catch (error: any) {
      // Clean up local file on failure (only relevant for path-based uploads)
      if (typeof source === 'string') {
        await fs.unlink(source).catch(() => {});
      }
      throw new Error(`Cloudinary upload failed: ${error.message}`);
    }
  },

  /**
   * Delete image from Cloudinary
   * @param publicId - Cloudinary public_id
   */
  async deleteImage(publicId: string) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error: any) {
      throw new Error(`Cloudinary delete failed: ${error.message}`);
    }
  },

  /**
   * Get optimized image URL with transformations
   * @param publicId - Cloudinary public_id
   * @param width - Desired width
   * @param height - Desired height
   * @returns Optimized image URL
   */
  getOptimizedUrl(publicId: string, width?: number, height?: number) {
    return cloudinary.url(publicId, {
      transformation: [
        {
          width: width || 1200,
          height: height || 1200,
          crop: 'limit',
          quality: 'auto',
          fetch_format: 'auto',
        },
      ],
    });
  },

  /**
   * Get thumbnail URL
   * @param publicId - Cloudinary public_id
   * @returns Thumbnail URL (300x300)
   */
  getThumbnailUrl(publicId: string) {
    return cloudinary.url(publicId, {
      transformation: [
        {
          width: 300,
          height: 300,
          crop: 'fill',
          quality: 'auto',
          fetch_format: 'auto',
        },
      ],
    });
  },
};
