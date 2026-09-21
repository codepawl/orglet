import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const html = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/index.html'), 'utf8');

/**
 * The window's Content Security Policy. Media previews are the only reason `blob:` is allowed, and only for
 * images and media: scripts, styles, fonts and connections keep the policy they had, so a widened source here
 * has to be a deliberate change in this test as well.
 */
it('allows blob: for pictures and media only', () => {
  const policy = /content="([^"]+)"/.exec(html.split('Content-Security-Policy')[1])![1];
  expect(policy).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'");
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).not.toContain('worker-src');
});
