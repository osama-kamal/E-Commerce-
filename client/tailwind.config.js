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
