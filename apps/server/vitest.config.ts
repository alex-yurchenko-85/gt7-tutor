import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/unit/**'],
    globalSetup: ['../../tools/testing/temp-root.ts'],
    setupFiles: ['test/support/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { statements: 92.81, branches: 77.52, functions: 95.44, lines: 95.74 }
    }
  }
});
