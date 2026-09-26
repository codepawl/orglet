import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The same source alias the renderer build uses, so a test can render an app component that imports the kit.
  resolve: { alias: { '@codepawl/orglet-ui': fileURLToPath(new URL('packages/orglet-ui/src/index.ts', import.meta.url)) } },
  test: {
    // Integration tests restart the core and run real SQLite work. They take 2 to 8 seconds on a GitHub Windows
    // runner, so the 5 second default fails healthy tests there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          include: ['tests/integration/**/*.test.ts', 'tests/live/**/*.test.ts'],
          environment: 'node',
        },
      },
      // The kit's own tests, in a browser-like environment, from its own config.
      'packages/orglet-ui',
    ],
  },
});
