import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { version } from '../../package.json';

it('shows the package version in Settings instead of a hardcoded 0.1', () => {
  const source = readFileSync('apps/desktop/src/renderer/components/SettingsDialog.tsx', 'utf8');
  expect(source).not.toMatch(/Orglet 0\.1/);
  expect(source).toContain('appVersion');
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});
