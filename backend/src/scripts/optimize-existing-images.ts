/**
 * Optimize Existing Images Script
 * Run: npx ts-node src/scripts/optimize-existing-images.ts
 * 
 * This script optimizes all existing images in the uploads folder
 */

import fs from 'fs/promises';
import path from 'path';
import { optimizeImage } from '../services/image.service';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

async function optimizeExistingImages() {
  console.log('🖼️  Starting image optimization...\n');

  try {
    // Check if uploads directory exists
    try {
      await fs.access(UPLOADS_DIR);
    } catch {
      console.log('❌ Uploads directory not found. No images to optimize.');
      return;
    }

    // Read all files in uploads directory
    const files = await fs.readdir(UPLOADS_DIR);
    
    // Filter image files (exclude .gitkeep and already optimized .webp files)
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
    });

    if (imageFiles.length === 0) {
      console.log('✅ No images to optimize. All images are already optimized or no images found.');
      return;
    }

    console.log(`📦 Found ${imageFiles.length} images to optimize\n`);

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;
    let successCount = 0;
    let errorCount = 0;

    // Optimize each image
    for (const file of imageFiles) {
      const filePath = path.join(UPLOADS_DIR, file);
      
      try {
        console.log(`⏳ Optimizing: ${file}`);
        
        const result = await optimizeImage(filePath, {
          maxWidth: 1200,
          maxHeight: 1200,
          quality: 85,
          format: 'webp',
          createThumbnail: true,
          thumbnailSize: 300,
        });

        totalOriginalSize += result.originalSize;
        totalOptimizedSize += result.optimizedSize;
        successCount++;

        console.log(`   ✅ ${file} → ${path.basename(result.optimizedPath)}`);
        console.log(`   📊 ${Math.round(result.originalSize / 1024)} KB → ${Math.round(result.optimizedSize / 1024)} KB (${result.compressionRatio}% smaller)\n`);
      } catch (error) {
        errorCount++;
        console.log(`   ❌ Failed to optimize ${file}: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      }
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 OPTIMIZATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully optimized: ${successCount} images`);
    if (errorCount > 0) {
      console.log(`❌ Failed: ${errorCount} images`);
    }
    console.log(`📦 Total original size: ${Math.round(totalOriginalSize / 1024)} KB`);
    console.log(`📦 Total optimized size: ${Math.round(totalOptimizedSize / 1024)} KB`);
    
    if (totalOriginalSize > 0) {
      const totalSavings = Math.round((1 - totalOptimizedSize / totalOriginalSize) * 100);
      console.log(`💾 Total savings: ${totalSavings}%`);
      console.log(`🚀 Saved ${Math.round((totalOriginalSize - totalOptimizedSize) / 1024)} KB!`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

optimizeExistingImages()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
