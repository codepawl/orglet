import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests restart the core and run real SQLite work. They take 2 to 8 seconds on a GitHub Windows
    // runner, so the 5 second default fails healthy tests there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
