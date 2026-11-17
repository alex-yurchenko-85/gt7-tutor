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
