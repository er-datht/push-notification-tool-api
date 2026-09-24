/**
 * Values shared by the test suite. Not compiled into dist/ (tsconfig.build.json
 * excludes src/test/).
 */

/**
 * The X-APIToken the tests send and vitest.config.ts puts into env.API_TOKEN.
 * A fixture, not a secret: it only exists inside the test run, and the name
 * makes sure nobody mistakes it for a value to configure anywhere real.
 */
export const TEST_API_TOKEN = 'vitest-only-not-a-real-token'

/** A no-op `uploadToS3` so tests never touch real AWS. */
export const noopUploadToS3 = async () => {}
