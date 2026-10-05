import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The files that start a real Chrome or Edge. They run one at a time, in a project of their own: on a 4-core CI runner
 * each running at once with the rest of the suite made Chrome's start take 7 s with two of them going and 23 s with
 * four (measured for COD-374), and a click that takes half a second took 4 s. A step that slow ran into the 40 s limit
 * of an acting step and failed browser-act-loop, browser-window and, starved alongside them, thread-context.
 */
const REAL_BROWSER_TESTS = [
  'tests/integration/browser-act-loop.test.ts',
  'tests/integration/browser-live.test.ts',
  'tests/integration/browser-policy.test.ts',
  'tests/integration/browser-tool-loop.test.ts',
  'tests/integration/browser-window.test.ts',
];

export default defineConfig({
  // The same source alias the renderer build uses, so a test can render an app component that imports the kit.
  resolve: { alias: { '@codepawlhq/orglet-ui': fileURLToPath(new URL('packages/orglet-ui/src/index.ts', import.meta.url)) } },
  test: {
    // Integration tests restart the core and run real SQLite work. They take 2 to 8 seconds on a GitHub Windows
    // runner, so the 5 second default fails healthy tests there. On CI the whole suite shares a 4-core runner with
    // browser tests starting Chrome, and on 2026-09-27 healthy tests (forward, harness-budget, crew-turn-honesty) ran
    // 42 to 47 seconds there before passing on a rerun; a real hang still fails, at 90 seconds instead of 30.
    testTimeout: process.env.CI ? 90_000 : 30_000,
    hookTimeout: process.env.CI ? 90_000 : 30_000,
    // Sample replies stand in for a model here, as in the packaged smokes (apps/desktop/src/shared/demo-replies.ts).
    env: { ORGLET_DEMO_REPLIES: '1' },
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          include: ['tests/integration/**/*.test.ts', 'tests/live/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...REAL_BROWSER_TESTS],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'real-browser',
          include: REAL_BROWSER_TESTS,
          environment: 'node',
          fileParallelism: false,
        },
      },
      // The kit's own tests, in a browser-like environment, from its own config.
      'packages/orglet-ui',
    ],
  },
});
