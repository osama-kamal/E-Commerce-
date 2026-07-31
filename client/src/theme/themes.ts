/**
 * Storefront theme registry.
 *
 * A theme is presentation ONLY. It changes typography, colour, radius and
 * elevation — never products, pricing, stock, checkout, permissions or routing.
 * Nothing in this file may import an API client, a store slice or a router.
 *
 * The identifier list is mirrored from `STORE_THEMES` in the backend's
 * store.model.ts. Both sides validate against their own copy; the integration
 * test `store-theme.integration.test.ts` pins the server's list.
 */

export const STORE_THEMES = ['default', 'luxury', 'modern', 'minimal', 'fashion', 'marketplace'] as const;
export type StoreTheme = typeof STORE_THEMES[number];

export const DEFAULT_STORE_THEME: StoreTheme = 'default';

/**
 * Coerces any value to a known theme.
 *
 * Mirrors the server helper of the same name. Needed because a store written
 * before the feature shipped has no `theme` at all, and because a value could
 * be retired in a later release while rows still reference it. Anything
 * unrecognised renders the current design rather than an unstyled page.
 */
export function resolveTheme(value: unknown): StoreTheme {
  return STORE_THEMES.includes(value as StoreTheme) ? (value as StoreTheme) : DEFAULT_STORE_THEME;
}

export interface ThemeMeta {
  id: StoreTheme;
  name: string;
  description: string;
  /** Three swatches rendered in the picker: page, surface, accent. */
  swatches: [string, string, string];
  /** Shown on the preview tile so the merchant can see the heading face. */
  previewFont: string;
  /** Corner radius used by the preview tile, matching the theme's own radius. */
  previewRadius: string;
}

/**
 * Merchant-facing catalogue. Order is the order shown in Store Settings;
 * `default` is deliberately first.
 */
export const THEME_CATALOGUE: ThemeMeta[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'The standard storefront. Balanced, familiar, works for any catalogue.',
    swatches: ['#f9fafb', '#ffffff', '#f59e0b'],
    previewFont: 'Inter, sans-serif',
    previewRadius: '1rem',
  },
  {
    id: 'luxury',
    name: 'Luxury',
    description: 'Editorial serif headings on a bone ground. Hairlines instead of shadows.',
    swatches: ['#fafaf9', '#ffffff', '#1c1917'],
    previewFont: '"Cormorant Garamond", Georgia, serif',
    previewRadius: '0rem',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'High contrast, tight type and deep elevation. Bold and product-forward.',
    swatches: ['#f8fafc', '#ffffff', '#4f46e5'],
    previewFont: 'Inter, sans-serif',
    previewRadius: '1.25rem',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Monochrome and quiet. No shadows, square corners, maximum whitespace.',
    swatches: ['#ffffff', '#ffffff', '#111827'],
    previewFont: 'Inter, sans-serif',
    previewRadius: '0rem',
  },
  {
    id: 'fashion',
    name: 'Fashion',
    description: 'Warm neutrals with tall product imagery. Suits apparel and lifestyle.',
    swatches: ['#fdf6f0', '#ffffff', '#9d174d'],
    previewFont: '"Cormorant Garamond", Georgia, serif',
    previewRadius: '0.25rem',
  },
  {
    id: 'marketplace',
    name: 'Marketplace',
    description: 'Dense and information-first. Compact cards for large catalogues.',
    swatches: ['#f1f5f9', '#ffffff', '#0284c7'],
    previewFont: 'Inter, sans-serif',
    previewRadius: '0.5rem',
  },
];

export function getThemeMeta(id: StoreTheme): ThemeMeta {
  return THEME_CATALOGUE.find(t => t.id === id) ?? THEME_CATALOGUE[0];
}
