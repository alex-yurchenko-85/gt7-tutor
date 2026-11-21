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
    globalSetup: ['./tools/testing/temp-root.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
        'tools/setup/**/*.ts',
        'tools/start/**/*.ts',
        'apps/server/src/auth/{password,session-cookie,sign-in-limiter}.ts',
        'apps/server/src/{drop-oldest,http-errors}.ts',
        'apps/server/src/exercises/exercise-step.ts',
        'apps/server/src/config/app-config.ts',
        'apps/server/src/captures/sample-cache.ts',
        'apps/server/src/races/live-race.ts',
        'apps/server/src/training/training-session.ts'
      ],
      exclude: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.d.ts', 'apps/web/src/main.tsx', 'tools/start/start.ts']
    },
    projects: [
      {
        extends: true,
        test: { name: 'packages', include: ['packages/*/test/**/*.spec.ts'] }
      },
      {
        extends: true,
        test: { name: 'tools', include: ['tools/setup/**/*.spec.ts', 'tools/start/**/*.spec.ts', 'tools/testing/**/*.spec.ts'] }
      },
      {
        extends: true,
        test: { name: 'server', include: ['apps/server/test/unit/**/*.spec.ts'] }
      },
      'apps/web'
    ]
  }
});
