import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IslandDock, type DockedIsland } from '../../apps/desktop/src/renderer/components/islandDock';

const planOut: DockedIsland = {
  kind: 'account', key: 'claude-code:system:2026-10-10T02:00:00Z', harnessName: 'Claude Code', retries: false,
  resetsAt: '2026-10-10T02:00:00Z', switchAccount: () => {}, dismiss: () => {},
};

it('says on the island, not in a line under the bar, that the plan ran out (user, 2026-10-06)', () => {
  const html = renderToStaticMarkup(createElement(IslandDock, { dock: 'plan-out-test', fallback: planOut }));
  expect(html).toContain('live-island-account');
  expect(html).toContain('Claude Code ran out');
  expect(html).toContain('live-island-meta');
});

it('offers the other account without promising to run anything again', () => {
  const html = renderToStaticMarkup(createElement(IslandDock, { dock: 'plan-out-test', fallback: { ...planOut, target: { label: 'Work', usedPercent: 20 } } }));
  expect(html).toContain('aria-label="Switch to Work"');
  expect(html).toContain('Use Work · 80% left');
});
