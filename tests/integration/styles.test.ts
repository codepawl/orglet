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

// COD-249 UI audit: rules that keep text readable and on one line; each was measured failing before.
it('lets a quiet sidebar row give its name the width the hidden menu used to reserve', () => {
  expect(css).toContain('.worker-row > [data-no-drag]:has(> .org-row-menu) { position:absolute;');
  expect(css).toContain('.worker-row:is(:hover, :has(:focus-visible), :has(.row-action[aria-expanded=true])) .worker { padding-right:36px; }');
});

it('gives an orglet\'s side threads the same air under them as over them (dogfood, 2026-09-26)', () => {
  expect(css).toContain('.tree-children { display:flex; flex-direction:column; gap:4px; margin:8px 0 4px 21px; padding-left:25px; }');
});

it('gives the sidebar a background when it floats over the chat at the minimum window', () => {
  expect(css).toMatch(/@media\(max-width:780px\) \{ \.sidebar \{[^}]*background:var\(--bg\);/);
});

it('puts a group of choices\' title above its box, never on the box\'s edge (dogfood, 2026-09-26)', () => {
  expect(css).toContain('.form fieldset { border:0; padding:0; margin:0; min-width:0; }');
  expect(css).toContain('.form legend { display:flex; font-size:13px; font-weight:500; padding:0 0 8px; }');
  expect(css).toContain('.fieldset-options { border:1px solid var(--border); border-radius:10px; padding:12px; }');
  const channelEditor = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/components/ChannelDialog.tsx'), 'utf8');
  expect(channelEditor.match(/<\/legend><div className="fieldset-options">/g)).toHaveLength(2);
});

it('keeps a select option detail to one line instead of breaking a model id', () => {
  const selectCss = readFileSync(join(__dirname, '../../packages/orglet-ui/src/components/Select.css'), 'utf8');
  expect(selectCss).toMatch(/\.org-select-option \.org-select-detail \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
});

it('never fades working controls or small counts with opacity', () => {
  expect(css).not.toMatch(/\.setting-connection\.inactive \.setting-text \{[^}]*opacity/);
  expect(css).toMatch(/\.notice-filter span \{(?![^}]*opacity)[^}]*\}/);
});

it('gives a long orglet name in the Running view at most 60% so the chat name still shows', () => {
  expect(css).toMatch(/\.running-name \{[^}]*max-width:60%;[^}]*text-overflow:ellipsis;/);
  expect(css).toMatch(/\.running-chat \{[^}]*flex:1 1 0;/);
});

it('sweeps a light across the working line, and stops it under reduced motion', () => {
  expect(css).toMatch(/\.run-status-line \{[^}]*background-clip:text;[^}]*animation:status-sweep/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.run-status-line \{ animation:none; background:none; color:var\(--muted\); \} \}/);
});

// The header's texts share the name's baseline (owner, 2026-10-01, COD-355): the model beside the name, and each view
// tab's label and count. The group is centred in the header like the actions.
it('puts the chat header name, its model and the view tabs on one baseline', () => {
  expect(css).toContain('.topbar-title { display:inline-flex; align-items:baseline;');
  expect(css).toContain('.topbar > .topbar-main { display:flex; align-items:baseline;');
  expect(css).toMatch(/\.chat-views \{ display:flex; flex-wrap:wrap; align-items:baseline;/);
  expect(css).toMatch(/\.chat-view-tab \{ display:inline-flex; align-items:baseline;[^}]*padding:4px 10px;[^}]*line-height:20px;/);
});

// User, 2026-10-05: with the sidebar folded the message box stood 30px in from the thread above it.
it('keeps the message box as wide as the thread and the chat\'s opening lines, so their left edges meet', () => {
  const widthOf = (selector: string) => new RegExp(`${selector.replace(/[.>]/g, '\\$&')} \\{[^}]*?max-width:(\\d+px)`).exec(css)?.[1];
  expect(widthOf('.thread-content')).toBe('960px');
  expect(widthOf('.thread-composer')).toBe(widthOf('.thread-content'));
  expect(widthOf('.team-chat-start > .fresh-chat')).toBe(widthOf('.thread-content'));
});
