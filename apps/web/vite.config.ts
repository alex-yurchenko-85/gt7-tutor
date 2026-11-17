import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const serverUrl = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  server: {
    proxy: {
      '/api': serverUrl,
      '/audio': serverUrl,
      '/live': { target: serverUrl.replace('http', 'ws'), ws: true }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.tsx', 'test/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    css: false
  }
});
