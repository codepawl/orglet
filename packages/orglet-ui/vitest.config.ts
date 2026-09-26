import { defineConfig } from 'vitest/config';

// The kit's own tests. The repository's root config runs them as one of its projects, so `pnpm test` at the root
// covers them; `pnpm --filter @codepawl/orglet-ui test` runs them alone.
export default defineConfig({
  test: {
    name: 'orglet-ui',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
