import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source']
  },
  ssr: {
    resolve: {
      conditions: ['source'],
      externalConditions: ['source']
    }
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'tools/site/**/*.ts', 'tools/demo/**/*.ts', 'tools/setup/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.d.ts', 'apps/web/src/main.tsx', 'tools/demo/demo.ts', 'tools/setup/setup-local.ts']
    },
    projects: [
      {
        extends: true,
        test: { name: 'packages', include: ['packages/*/test/**/*.spec.ts'] }
      },
      {
        extends: true,
        test: { name: 'tools', include: ['tools/site/**/*.spec.ts', 'tools/demo/**/*.spec.ts', 'tools/setup/**/*.spec.ts'] }
      },
      'apps/web'
    ]
  }
});
