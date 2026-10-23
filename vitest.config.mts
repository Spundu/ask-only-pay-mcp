import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Builds dist/ once (the end-to-end tests start the built programs) and writes two sets of certificates.
    globalSetup: ['test/support/global.ts'],
    testTimeout: 30_000,
  },
});
