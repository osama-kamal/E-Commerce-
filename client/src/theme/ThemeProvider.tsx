import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_STORE_THEME, resolveTheme, type StoreTheme } from './themes';

/**
 * Applies a store's presentation theme.
 *
 * How it works: the theme id is written to `data-store-theme` on <html>, and
 * index.css restyles the shared primitives (`.surface`, `.card`, `.btn`, `.tile`,
 * page ground, heading face) under each `[data-store-theme="…"]` selector.
 *
 * Why that approach rather than swapping component trees:
 *   · the storefront already renders through those shared primitives, so one
 *     attribute reskins every page at once;
 *   · no component needs to know a theme exists, so a theme cannot reach into
 *     product, cart, checkout or auth logic even by accident;
 *   · `default` emits no overrides whatsoever, which is what guarantees the
 *     current design is untouched.
 *
 * The provider renders no DOM of its own.
 */

interface ThemeContextValue {
  /** The theme actually in effect (always a valid id, never undefined). */
  theme: StoreTheme;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_STORE_THEME });

/** Read the active theme. Presentation only — do not branch business logic on it. */
export function useStoreTheme(): StoreTheme {
  return useContext(ThemeContext).theme;
}

const ATTR = 'data-store-theme';

export function ThemeProvider({
  theme,
  children,
}: {
  /** Raw value straight off the store record; may be undefined or stale. */
  theme?: string | null;
  children: React.ReactNode;
}) {
  const resolved = resolveTheme(theme);

  // Tracks whether THIS provider set the attribute, so cleanup never clears a
  // value another provider owns (the admin preview mounts one inside a page
  // that already has one).
  const owned = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute(ATTR);

    if (resolved === DEFAULT_STORE_THEME) {
      // Default emits no overrides — remove the attribute entirely rather than
      // writing "default", so the base stylesheet applies with nothing layered
      // on top. This is what keeps the default design byte-identical.
      root.removeAttribute(ATTR);
    } else {
      root.setAttribute(ATTR, resolved);
    }
    owned.current = true;

    return () => {
      // Restore what was there before this provider mounted, so unmounting a
      // storefront route does not strip the theme from a parent that still
      // wants it.
      if (previous === null) root.removeAttribute(ATTR);
      else root.setAttribute(ATTR, previous);
    };
  }, [resolved]);

  const value = useMemo(() => ({ theme: resolved }), [resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Scoped theming for a preview tile.
 *
 * Sets the attribute on a wrapper element instead of <html>, so the merchant can
 * see a theme rendered without it taking over the settings page they are
 * standing on. The CSS selectors are written to match either.
 */
export function ThemeScope({
  theme,
  className = '',
  children,
}: {
  theme: StoreTheme;
  className?: string;
  children: React.ReactNode;
}) {
  const resolved = resolveTheme(theme);
  return (
    <div {...{ [ATTR]: resolved === DEFAULT_STORE_THEME ? undefined : resolved }} className={className}>
      {children}
    </div>
  );
}
