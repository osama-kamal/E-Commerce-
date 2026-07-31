import { Check, Loader2 } from 'lucide-react';
import { THEME_CATALOGUE, type StoreTheme } from '../theme/themes';
import { ThemeScope } from '../theme/ThemeProvider';

/**
 * Theme chooser for Store Settings → Appearance.
 *
 * Each tile is a live render of the theme, not a screenshot: the swatch card
 * inside is wrapped in `ThemeScope`, which sets `data-store-theme` on the
 * wrapper so the real theme CSS applies to that subtree only. The merchant sees
 * the actual radius, elevation, heading face and accent — and the settings page
 * they are standing on is unaffected.
 *
 * One click applies and saves; there is no separate confirm step.
 */
export default function ThemePicker({
  value,
  onSelect,
  savingTheme,
  disabled = false,
}: {
  value: StoreTheme;
  onSelect: (theme: StoreTheme) => void;
  /** The theme currently being written, or null when idle. */
  savingTheme: StoreTheme | null;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Storefront theme"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {THEME_CATALOGUE.map(meta => {
        const active = value === meta.id;
        const busy = savingTheme === meta.id;

        return (
          <button
            key={meta.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || savingTheme !== null}
            onClick={() => !active && onSelect(meta.id)}
            className={`group relative overflow-hidden rounded-xl border-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? 'border-gray-900 shadow-elevated dark:border-white'
                : 'border-gray-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-elevated dark:border-gray-700 dark:hover:border-gray-600'
            }`}
          >
            {/* ── Live preview ──
                A miniature storefront: page ground, a product surface, a price
                and a brand button. Rendered through the real theme CSS. */}
            <ThemeScope theme={meta.id} className="block">
              <div
                className="flex h-32 flex-col justify-end gap-2 p-3"
                style={{ backgroundColor: meta.swatches[0] }}
              >
                <div
                  className="surface p-2.5"
                  style={{ borderRadius: meta.previewRadius }}
                  aria-hidden="true"
                >
                  <div className="mb-2 h-8 w-full rounded bg-gray-200/80" />
                  <p
                    className="truncate text-[11px] font-semibold text-gray-900"
                    style={{ fontFamily: meta.previewFont }}
                  >
                    Product name
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-gray-900">$149</span>
                    <span
                      className="px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-white"
                      style={{ backgroundColor: meta.swatches[2], borderRadius: meta.previewRadius === '0rem' ? 0 : '0.375rem' }}
                    >
                      Add
                    </span>
                  </div>
                </div>
              </div>
            </ThemeScope>

            {/* ── Meta ── */}
            <div className="border-t border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{meta.name}</p>

                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden="true" />
                ) : active ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 dark:bg-white">
                    <Check className="h-3 w-3 text-white dark:text-gray-900" strokeWidth={3} aria-hidden="true" />
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {meta.description}
              </p>

              {/* Palette. Decorative — the name and description carry the meaning. */}
              <div className="mt-3 flex gap-1" aria-hidden="true">
                {meta.swatches.map((c, i) => (
                  <span
                    key={i}
                    className="h-4 w-4 rounded-full border border-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              {/* Announced to assistive tech; the tick above is visual only. */}
              <span className="sr-only">
                {active ? 'Currently applied' : busy ? 'Applying' : 'Not applied'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
