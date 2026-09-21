import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Mascot, bubbleOutline, mascots, mascotIds } from '../../apps/desktop/src/renderer/components/mascots';
import { autoMascot, mascotCategoryIds, mascotColors, rankMascots, suggestMascots, suggestedColors, suggestedMascots } from '../../apps/desktop/src/renderer/components/mascotSuggest';

const all = Object.values(mascotCategoryIds).flat();
const top = (name: string, description?: string) => suggestMascots({ name, description })[0];

it('suggests mascots from Vietnamese and English roles', () => {
  expect(top('Researcher')).toBe('search');
  expect(top('Kế toán trưởng')).toBe('finance');
  expect(top('Tí chăm sóc khách hàng')).toBe('headset');
  expect(top('Lập trình viên backend')).toBe('coder');
  expect(top('Trợ lý', 'Sắp xếp lịch họp cho sếp')).toBe('calendar');
  expect(top('Data analyst')).toBe('chart');
  expect(top('Chuyên viên tuyển dụng')).toBe('care');
});

it('matches whole words, with prefixes only for longer stems', () => {
  expect(suggestMascots({ name: 'Latest news' })).not.toContain('checker');
  expect(top('Chất lượng')).toBe('checker');
  expect(suggestMascots({ name: 'Lịch sử công ty' })).not.toContain('calendar');
  expect(suggestMascots({ name: 'Hợp đồng' })[0]).toBe('briefcase');
});

it('weights the name above the description and instructions, and one field cannot stack a keyword', () => {
  expect(top('Writer', 'reviews drafts')).toBe('writer');
  expect(suggestMascots({ name: 'Minh', instructions: 'Review the evidence carefully.' })[0]).toBe('checker');
  const repeated = rankMascots({ name: 'audit audit audit' }).find(item => item.id === 'checker')!.score;
  expect(repeated).toBe(rankMascots({ name: 'audit' }).find(item => item.id === 'checker')!.score);
  expect(suggestMascots({ name: 'Minh', skill: 'Payroll' })[0]).toBe('finance');
});

it('always offers suggestions, pushes back mascots other workers use, and keeps the automatic face stable', () => {
  expect(suggestMascots({ name: 'Zed' })).toEqual([]);
  expect(suggestedMascots({ name: 'Zed' })).toHaveLength(7);
  expect(suggestedMascots({ name: 'Researcher' })[0]).toBe('search');
  expect(suggestedMascots({ name: 'Researcher' }, { taken: ['search'] })[0]).toBe('focused');
  expect(suggestedMascots({ name: 'Zed' }, { taken: ['tie'] })[0]).toBe('briefcase');
  expect(autoMascot(all, 'w1', { name: 'Zed' })).toBe(autoMascot(all, 'w1', { name: 'Zed' }));
  expect(autoMascot(all, 'w1', { name: 'Researcher' })).toBe('search');
});

it('lists every mascot in exactly one category', () => {
  expect(new Set(all).size).toBe(all.length);
  expect(all.length).toBe(29);
});

it('suggests three colours led by the colour of the face shown', () => {
  const colors = suggestedColors('finance', 'w1', { name: 'Kế toán trưởng' });
  expect(colors).toHaveLength(3);
  expect(colors[0]).toBe(mascotColors.finance);
  expect(new Set(colors).size).toBe(3);
  expect(suggestedColors('classic', 'w1', { name: 'Zed' })[0]).toBe(mascotColors.classic);
  expect(Object.keys(mascotColors).sort()).toEqual([...all].sort());
});

/** Every element a mascot draws, flattened out of the fragment tree, with the colours it paints with. */
function painted(art: ReactNode): { name: string; fill?: string; stroke?: string; d?: string }[] {
  const out: { name: string; fill?: string; stroke?: string; d?: string }[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (typeof element.type === 'string') {
      const text = (key: string) => typeof element.props[key] === 'string' ? element.props[key] as string : undefined;
      out.push({ name: element.type, fill: text('fill'), stroke: text('stroke'), d: text('d') });
    }
    walk(element.props.children as ReactNode);
  };
  walk(art);
  return out;
}

it('never fills a mascot with the colour of the body it sits on', () => {
  // The bubble is filled with the mascot colour, so a shape filled with that same colour and nothing else simply
  // disappears into it. That is how a wink lost its open eye, sunglasses became invisible and a tie went missing
  // (COD-106). A worn accessory is the exception and proves the rule: it fills with the body colour but carries
  // an ink rim, which is what lets it read over the bubble.
  //
  // The mirror of this bug — a part drawn outside the body in the page colour, like an antenna stem — is not
  // caught here. Telling inside from outside needs the rendered geometry, not the source, so those are held by
  // the `outside` helper in mascots.tsx and by looking at them.
  //
  // The body paint is `--mascot-fill` (the shaded gradient, COD-131) with currentColor as its fallback; a shape in
  // either is the body's own colour. The body itself is the one shape allowed to be, so it is skipped by its outline.
  const bodyColoured = (fill: string | undefined) => fill === 'currentColor' || Boolean(fill?.startsWith('var(--mascot-fill'));
  const invisible: string[] = [];
  let wornShapes = 0;
  for (const id of mascotIds) {
    for (const shape of painted(mascots[id].art)) {
      if (shape.d === bubbleOutline) continue;
      if (!bodyColoured(shape.fill)) continue;
      wornShapes += 1;
      const rimmed = Boolean(shape.stroke && shape.stroke.includes('--mascot-ink'));
      if (!rimmed) invisible.push(`${id}: a ${shape.name} is filled with the body colour and has no rim`);
    }
  }
  expect(invisible).toEqual([]);
  // The rule has to see the hats, or a change to the body paint would silently switch it off.
  expect(wornShapes).toBeGreaterThan(20);
});

it('lights every mascot from its own gradient, never a shared one', () => {
  // Many faces sit on one page. A gradient id shared between them would resolve to the first face in the document,
  // painting every mascot in that one's colour, so each rendered face must define and reference its own.
  const markup = renderToStaticMarkup(createElement('div', null, mascotIds.map(id => createElement(Mascot, { id, key: id }))));
  const definedIds = [...markup.matchAll(/<radialGradient id="([^"]+)-body"/g)].map(match => match[1]);
  const referencedIds = [...markup.matchAll(/--mascot-fill:url\(#([^)]+)-body\)/g)].map(match => match[1]);
  expect(definedIds).toHaveLength(mascotIds.length);
  expect(new Set(definedIds).size).toBe(mascotIds.length);
  expect(referencedIds).toEqual(definedIds);
  for (const id of definedIds) expect(id).toMatch(/^[\w-]+$/);
  // The tones are mixed from the avatar colour at render time, never baked in, so any user colour shades.
  expect(markup).toContain('stop-color="color-mix(in srgb, currentColor 72%, white)"');
  expect(markup).toContain('stop-color="color-mix(in srgb, currentColor 74%, black)"');
});
