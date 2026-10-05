import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/server/test/integration/**/*.test.ts'],
          globalSetup: ['apps/server/test/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // Tests share one database; files run one after another.
          fileParallelism: false,
        },
      },
    ],
  },
});
