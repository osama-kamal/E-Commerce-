/**
 * Per-storefront "recently viewed" history.
 *
 * ── Why localStorage and not the API ──────────────────────────────────────────
 * Browsing history is the one signal a storefront can personalise on WITHOUT a
 * login. Every server-side alternative needs an account, and the catalogue is
 * public — most of the people this helps have never authenticated. Keeping it in
 * the browser also means it costs zero requests on a page that already fires
 * four.
 *
 * ── Why the key is scoped to the slug ─────────────────────────────────────────
 * One browser visits many storefronts on this platform, and a shopper's history
 * in one merchant's shop must never surface in another's — that is the same
 * tenant boundary the API enforces, and there is no reason to leak it in the
 * client just because the storage happens to be local. `sf:recent:<slug>` keeps
 * each store's list separate; nothing reads across the prefix.
 *
 * Stores a SNAPSHOT (name, price, discount, first image) rather than ids: the
 * widget renders from storage alone, so it never needs a fetch to draw, and a
 * product deleted from the catalogue simply ages out of the list instead of
 * rendering an empty row. Prices in the snapshot can therefore go stale — which
 * is why the rows link to the product page and are not add-to-cart affordances.
 */

import { useEffect, useState } from 'react';
import type { Product } from '../types';

export interface RecentProduct {
  _id: string;
  name: string;
  price: number;
  discount: number;
  images?: string[];
}

/** Four rows show; the rest is headroom so a revisit re-promotes rather than re-adds. */
const MAX_ENTRIES = 8;

const keyFor = (slug: string) => `sf:recent:${slug}`;

/**
 * localStorage is attacker-writable and survives across releases, so anything
 * read back is treated as untrusted input rather than as our own data.
 */
function isRecentProduct(value: unknown): value is RecentProduct {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<RecentProduct>;
  return (
    typeof p._id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.price === 'number' &&
    typeof p.discount === 'number'
  );
}

function read(slug: string): RecentProduct[] {
  try {
    const raw = localStorage.getItem(keyFor(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentProduct).slice(0, MAX_ENTRIES);
  } catch {
    // Disabled storage, private mode, or a malformed entry. A browsing history
    // is a nicety — it must never take the page down with it.
    return [];
  }
}

/** Records a view, moving a product already in the list back to the front. */
export function recordRecentlyViewed(slug: string, product: Product): void {
  if (!slug || !product?._id) return;

  const entry: RecentProduct = {
    _id: product._id,
    name: product.name,
    price: product.price,
    discount: product.discount ?? 0,
    // One image, not the gallery: this is a 56px thumbnail, and the rest would
    // only fill the origin's storage quota.
    images: product.images?.slice(0, 1),
  };

  try {
    const next = [entry, ...read(slug).filter(p => p._id !== entry._id)].slice(0, MAX_ENTRIES);
    localStorage.setItem(keyFor(slug), JSON.stringify(next));
  } catch {
    /* see read() */
  }
}

/**
 * Reads the history for a storefront.
 *
 * Read in an effect rather than a `useState` initializer so the first paint does
 * not depend on storage, and so a slug change re-reads instead of keeping the
 * previous tenant's list.
 *
 * `excludeId` is for the product page, where the item being looked at should not
 * appear in its own "recently viewed" rail.
 */
export function useRecentlyViewed(slug: string, excludeId?: string): RecentProduct[] {
  const [items, setItems] = useState<RecentProduct[]>([]);

  useEffect(() => {
    setItems(read(slug).filter(p => p._id !== excludeId));
  }, [slug, excludeId]);

  return items;
}
