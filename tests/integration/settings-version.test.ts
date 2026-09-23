import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { version } from '../../package.json';

/**
 * The version the About tab shows is the one the running build reports through `app.getVersion()`, which Electron
 * reads from the same package.json; the renderer no longer imports the file itself (COD-176). The desktop smoke
 * checks the two agree in a real window; this keeps a hardcoded number out of the source.
 */
it('shows the version the main process reports, never a number written into the renderer', () => {
  const about = readFileSync('apps/desktop/src/renderer/components/AboutSettings.tsx', 'utf8');
  const caches = readFileSync('apps/desktop/src/renderer/caches.ts', 'utf8');
  const settings = readFileSync('apps/desktop/src/renderer/components/SettingsDialog.tsx', 'utf8');
  expect(about).not.toMatch(/Orglet 0\.\d/);
  // The tab reads the build through the session cache, which asks the main process (COD-218).
  expect(about).toContain('useCached(aboutInfo');
  expect(caches).toContain('orglet.about()');
  expect(settings).not.toContain('package.json');
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});
