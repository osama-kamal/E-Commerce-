import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    // jsdom only where a DOM is actually needed; pure-logic tests (e.g.
    // utils/checkoutMode.test.ts) run fine under it too and the cost is small.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
