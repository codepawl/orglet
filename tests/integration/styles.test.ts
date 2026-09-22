import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/styles.css'), 'utf8');

it('defaults the shell to SF Pro, with the bundled font and the platform sans behind it', () => {
  expect(css).toContain('--font: "SF Pro Text", "SF Pro Display", "Inter", ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";');
  expect(css).toContain('--font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;');
  expect(css).toContain('--font-sans: var(--font); --default-font-family: var(--font);');
  expect(css).toMatch(/:root \{[\s\S]*?font-family: var\(--font\)/);
  expect(css).toContain('body { margin:0; background:var(--bg); color:var(--text); font-family: var(--font); }');
  expect(css).not.toMatch(/font-family:\s*'Segoe UI'/);
  expect(css).toContain('font:500 11px/18px var(--font)');
});
