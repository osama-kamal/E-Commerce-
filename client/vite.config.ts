import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // In production the Vercel rewrite rule forwards /api → backend.
  // In development we proxy to localhost:5000 so no CORS header needed.
  const backendUrl = env.VITE_API_URL || 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/uploads': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    build: {
      // Warn when a chunk exceeds 1 MB (helps spot bundle bloat early)
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Split heavy vendor libraries into their own chunks for better caching
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-redux': ['@reduxjs/toolkit', 'react-redux'],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-charts': ['recharts'],
            'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'yup'],
            'vendor-stripe': ['@stripe/react-stripe-js', '@stripe/stripe-js'],
          },
        },
      },
    },
  };
});
