import { defineConfig } from 'vitest/config'

import { TEST_API_TOKEN } from './src/test/fixtures.js'

export default defineConfig({
  test: {
    // Vitest sets NODE_ENV=test, so env.ts, logger.ts and prisma.ts take their
    // quiet, non-development paths without any test-specific switches.
    include: ['src/**/*.test.ts'],
    // Tests that reach the database need MySQL up (docker compose up -d).
    // Generous timeout: the first connection of a run can take a moment.
    testTimeout: 10_000,
    // Set before any test file is imported, so src/lib/env.ts sees them.
    env: {
      API_TOKEN: TEST_API_TOKEN,
    },
  },
})
