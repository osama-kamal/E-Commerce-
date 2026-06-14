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
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
};
