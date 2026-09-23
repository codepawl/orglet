import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Startup } from '../../apps/desktop/src/renderer/components/Startup';
import { Skeleton, SkeletonGroup, SkeletonText } from '../../packages/orglet-ui/src/index';

const kitCss = readFileSync(join(__dirname, '../../packages/orglet-ui/src/components/Skeleton.css'), 'utf8');
const appCss = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/styles.css'), 'utf8');

it('draws the whole shell before any workspace exists: sidebar, sections, footer, main column and prompt bar', () => {
  const html = renderToStaticMarkup(createElement(Startup, { sidebarWidth: 300 }));
  expect(html).toContain('class="app startup"');
  expect(html).toContain('--sidebar-width:300px');
  expect(html).toContain('<aside class="sidebar"');
  expect(html).toContain('<main class="main-pane"');
  // The two sections are there with the shape of their rows, and their names, not an empty list.
  expect(html).toContain('Crews');
  expect(html).toContain('Orglets');
  expect(html.match(/class="row-shape"/g)).toHaveLength(4);
  expect(html).toContain('Opening the orglet list…');
  // The footer keeps its four entries in place; the prompt bar is there and asleep until the workspace lands.
  for (const label of ['Notifications', 'Schedules', 'Library', 'Settings']) expect(html).toContain(label);
  expect(html).toContain('<form class="composer"');
  expect(html).toMatch(/<textarea[^>]*disabled/);
  // The face does the waiting where the chat's face will be, and the copy says what is happening.
  expect(html).toContain('class="startup-face"');
  expect(html).toContain('Opening workspace…');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('spinner');
});

it('collapses the sidebar the way the person left it and turns an error into a retry', () => {
  const html = renderToStaticMarkup(createElement(Startup, { sidebar: false, error: 'Core did not answer', onRetry: () => undefined }));
  expect(html).toContain('class="app startup sidebar-hidden"');
  expect(html).toContain('<aside class="sidebar collapsed"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Core did not answer');
  expect(html).toContain('Retry');
});

it('ships one skeleton in the kit: hidden shapes under one spoken label, sweeping under a second and still under reduced motion', () => {
  const html = renderToStaticMarkup(createElement(SkeletonGroup, { label: 'Opening…', children: [
    createElement(Skeleton, { key: 'face', shape: 'circle' }), createElement(SkeletonText, { key: 'text', lines: 2 })] }));
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('class="org-skeleton-label">Opening…');
  expect(html).toContain('class="org-skeleton org-skeleton-circle"');
  expect(html.match(/aria-hidden="true" class="org-skeleton org-skeleton-line"/g)).toHaveLength(2);
  const cycle = kitCss.match(/animation: org-skeleton-sweep ([\d.]+)s/);
  expect(cycle).not.toBeNull();
  expect(Number(cycle![1])).toBeLessThan(1);
  expect(kitCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.org-skeleton \{ animation: none;/);
  // The app has no skeleton of its own any more, and no spinner keyframe is used for a wait.
  expect(appCss).not.toContain('skeleton-pulse');
});
