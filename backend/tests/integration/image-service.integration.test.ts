/**
 * Exercises the sharp API surface that image.service.ts actually depends on.
 *
 * sharp was upgraded 0.34.5 -> 0.35.3 to clear four inherited libvips CVEs
 * (GHSA-f88m-g3jw-g9cj). The upgrade crosses a 0.x minor, which for this package
 * is where breaking changes land, so the calls the service makes are verified
 * end-to-end against real image bytes rather than assumed compatible:
 *
 *   sharp(path)
 *     .resize(w, h, { fit, withoutEnlargement })
 *     .resize(n, n, { fit: 'cover', position: 'center' })
 *     .toFormat(fmt, { quality })
 *     .toFile(path)
 *   sharp(path).metadata()
 *
 * There was previously no test covering image processing at all.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

import { optimizeImage, getImageMetadata } from '../../src/services/image.service';

let workDir: string;

/** Writes a real PNG of the given dimensions to disk and returns its path. */
async function makeImage(name: string, width: number, height: number): Promise<string> {
  const file = path.join(workDir, name);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toFile(file);
  return file;
}

beforeAll(async () => {
  // sharp keeps recently-used files in a libvips cache and holds their handles.
  // On Windows that makes the temp-dir teardown below fail with EBUSY. Disabling
  // the cache releases handles as soon as each operation completes.
  sharp.cache(false);
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'img-svc-'));
});

afterAll(async () => {
  // Best-effort: a stranded temp directory is harmless and must never fail the
  // suite. The OS reclaims it.
  await fs.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    .catch(() => { /* ignore — see above */ });
});

// ── The library itself still behaves ────────────────────────────────────────

describe('sharp core API', () => {
  it('reports metadata for a generated image', async () => {
    const file = await makeImage('meta.png', 300, 200);

    const meta = await sharp(file).metadata();

    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
    expect(meta.format).toBe('png');
  });

  it('resizes with fit:inside and withoutEnlargement', async () => {
    const file = await makeImage('big.png', 2000, 1000);
    const out = path.join(workDir, 'resized.jpeg');

    await sharp(file)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 80 })
      .toFile(out);

    const meta = await sharp(out).metadata();
    // fit:inside preserves aspect ratio — 2000x1000 capped at 800 wide -> 800x400
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(400);
    expect(meta.format).toBe('jpeg');
  });

  it('does not enlarge a small image when withoutEnlargement is set', async () => {
    const file = await makeImage('small.png', 100, 80);
    const out = path.join(workDir, 'nonenlarged.jpeg');

    await sharp(file)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 80 })
      .toFile(out);

    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it('crops square with fit:cover and position:center', async () => {
    const file = await makeImage('wide.png', 600, 200);
    const out = path.join(workDir, 'thumb.jpeg');

    await sharp(file)
      .resize(150, 150, { fit: 'cover', position: 'center' })
      .toFormat('jpeg', { quality: 80 })
      .toFile(out);

    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(150);
  });
});

// ── The service wrapper ─────────────────────────────────────────────────────

describe('optimizeImage', () => {
  it('produces an optimized file and reports a compression ratio', async () => {
    const file = await makeImage('opt-input.png', 1600, 1200);
    const originalSize = (await fs.stat(file)).size;

    const result = await optimizeImage(file, { createThumbnail: false });

    await expect(fs.access(result.optimizedPath)).resolves.toBeUndefined();
    expect(result.originalSize).toBe(originalSize);
    expect(result.optimizedSize).toBeGreaterThan(0);
    expect(typeof result.compressionRatio).toBe('number');
  });

  it('creates a thumbnail when asked', async () => {
    const file = await makeImage('opt-thumb.png', 1200, 900);

    const result = await optimizeImage(file, { createThumbnail: true });

    expect(result.thumbnailPath).toBeDefined();
    await expect(fs.access(result.thumbnailPath!)).resolves.toBeUndefined();

    const meta = await sharp(result.thumbnailPath!).metadata();
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });

  it('removes the original after optimizing', async () => {
    const file = await makeImage('opt-unlink.png', 400, 400);

    await optimizeImage(file, { createThumbnail: false });

    await expect(fs.access(file)).rejects.toThrow();
  });

  it('caps oversized images to the configured maximum', async () => {
    const file = await makeImage('opt-cap.png', 4000, 3000);

    const result = await optimizeImage(file, {
      createThumbnail: false,
      maxWidth: 500,
      maxHeight: 500,
    });

    const meta = await sharp(result.optimizedPath).metadata();
    expect(meta.width).toBeLessThanOrEqual(500);
    expect(meta.height).toBeLessThanOrEqual(500);
  });
});

describe('getImageMetadata', () => {
  it('returns dimensions, format and size fields', async () => {
    const file = await makeImage('meta2.png', 320, 240);

    const meta = await getImageMetadata(file);

    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.format).toBe('png');
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.sizeKB).toBeGreaterThanOrEqual(0);
    expect(typeof meta.sizeMB).toBe('string');
  });
});
