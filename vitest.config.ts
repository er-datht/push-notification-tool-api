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
    // Integration test files share one MySQL database and truncate its tables
    // in afterEach. Run files one at a time so they cannot delete each other's
    // rows mid-assertion. Tests inside a file already run sequentially.
    fileParallelism: false,
    // Set before any test file is imported, so src/lib/env.ts sees them.
    // AWS_REGION/S3_BUCKET_NAME only need to be non-empty here: every test injects
    // a fake uploadToS3, so nothing ever calls real AWS with these values.
    env: {
      API_TOKEN: TEST_API_TOKEN,
      AWS_REGION: 'ap-northeast-1',
      S3_BUCKET_NAME: 'test-bucket',
    },
  },
})
