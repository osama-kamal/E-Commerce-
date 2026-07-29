/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  // Safelist ensures these gradient/effect classes are always generated,
  // even if Tailwind's JIT scanner misses them in dynamic class strings.
  safelist: [
    'bg-gradient-to-br',
    'bg-gradient-to-b',
    'bg-gradient-to-r',
    'from-amber-100',
    'from-amber-50',
    'from-amber-500',
    'via-white',
    'to-yellow-100',
    'to-white',
    'to-yellow-600',
    'to-yellow-700',
    'hover:from-amber-600',
    'hover:to-yellow-700',
    'shadow-2xl',
    'shadow-amber-200',
    'backdrop-blur-md',
    'backdrop-blur-sm',
    'blur-3xl',
    'bg-amber-200/50',
    'bg-yellow-200/50',
    'border-amber-300',
    'border-amber-200',
    'border-amber-700/50',
  ],
  theme: {
    extend: {
      // ── Typeface ────────────────────────────────────────────────────────────
      // No fontFamily was defined, so every surface rendered in the browser's
      // default UI font. Inter is loaded in index.html; the stack after it is a
      // real fallback, not decoration — if the font request fails the app still
      // gets a modern grotesque rather than Times.
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },

      // ── Display scale ───────────────────────────────────────────────────────
      // The hero headline was text-3xl/4xl (30–36px). These are the sizes a
      // premium hero actually needs, with the negative tracking that large
      // Inter requires to avoid looking loose.
      fontSize: {
        'display-sm': ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '800' }],
        'display-lg': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '800' }],
        'display-xl': ['5.5rem', { lineHeight: '0.98', letterSpacing: '-0.035em', fontWeight: '900' }],
      },

      // ── Elevation ───────────────────────────────────────────────────────────
      // Tailwind's default shadows are single-layer neutral grey and read flat.
      // These are two-layer and tinted toward slate, which is what makes a card
      // look like it is above the page rather than outlined on it.
      // Default shadow-* utilities are untouched — this is additive only.
      boxShadow: {
        soft: '0 1px 3px rgb(16 24 40 / 0.05), 0 1px 2px rgb(16 24 40 / 0.03)',
        elevated: '0 4px 14px -3px rgb(16 24 40 / 0.09), 0 2px 6px -2px rgb(16 24 40 / 0.05)',
        float: '0 16px 40px -12px rgb(16 24 40 / 0.18), 0 6px 16px -6px rgb(16 24 40 / 0.08)',
        brand: '0 10px 30px -8px rgb(245 158 11 / 0.45)',
        'inner-top': 'inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
      },

      // ── Motion ──────────────────────────────────────────────────────────────
      // Names avoid `fade-in`, which index.css already defines outside @layer;
      // colliding would make which rule wins depend on bundling order.
      keyframes: {
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        drift: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        // A decelerating curve (not ease-out) is what makes entrances read as
        // "considered" rather than "animated".
        'rise-in': 'rise-in .7s cubic-bezier(.16,1,.3,1) both',
        'scale-in': 'scale-in .5s cubic-bezier(.16,1,.3,1) both',
        drift: 'drift 6s ease-in-out infinite',
      },

      colors: {
        // Full 50–900 scale. The five shades that were already defined
        // (50/100/500/600/700) are Tailwind's default `blue` values and are
        // UNCHANGED — brand identity is preserved exactly.
        //
        // 200/300/400/800/900 were missing while being referenced 41 times
        // across the app (e.g. `ring-primary-200`, `text-primary-400`,
        // `dark:bg-primary-900/20`). Tailwind emits no CSS for an undefined
        // shade, so those elements rendered with no colour at all — most
        // visibly on focus rings and dark-mode surfaces. Values below are the
        // matching `blue` steps, so the scale stays internally consistent.
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [],
};
