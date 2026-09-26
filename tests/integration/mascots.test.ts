import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Mascot, bubbleOutline, eyeColor, mascots, mascotIds, smallGlyphs } from '../../apps/desktop/src/renderer/components/mascots';
import { mascotGlyph } from '../../apps/desktop/src/renderer/components/Avatar';
import { autoMascot, avatarPalette, defaultAvatarColor, distinctAvatar, distinctMascot, mascotCategoryIds, mascotColors, rankMascots, suggestMascots, suggestedColors, suggestedMascots } from '../../apps/desktop/src/renderer/components/mascotSuggest';

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
  const definedIds = [...markup.matchAll(/<linearGradient id="([^"]+)-body"/g)].map(match => match[1]);
  const referencedIds = [...markup.matchAll(/--mascot-fill:url\(#([^)]+)-body\)/g)].map(match => match[1]);
  expect(definedIds).toHaveLength(mascotIds.length);
  expect(new Set(definedIds).size).toBe(mascotIds.length);
  expect(referencedIds).toEqual(definedIds);
  for (const id of definedIds) expect(id).toMatch(/^[\w-]+$/);
  // The tones are mixed from the avatar colour at render time, never baked in, so any user colour shades. The
  // mixes are gentle on purpose (matte, after the owner's reference, COD-154): a lighter and a darker tone within
  // a fifth of the colour itself, never a gloss.
  expect(markup).toMatch(/stop-color="color-mix\(in srgb, currentColor 8\d%, white\)"/);
  expect(markup).toMatch(/stop-color="color-mix\(in srgb, currentColor 8\d%, black\)"/);
  expect(markup).not.toContain('mascot-gloss');
});

it('draws the small orglets on whole pixels', () => {
  // In a list an orglet is 16 to 20 pixels tall, and a 64-unit drawing scaled that far smudges (COD-154). The
  // small drawings put the body edges, both eye capsules and the gap between them on whole pixels of a
  // whole-pixel canvas, which is what the stylesheet then places at whole-pixel offsets.
  for (const [name, glyph] of Object.entries(smallGlyphs)) {
    const left = (glyph.canvas - glyph.body) / 2;
    expect(Number.isInteger(glyph.canvas), name).toBe(true);
    expect(Number.isInteger(left), name).toBe(true);
    expect(Number.isInteger(glyph.body), name).toBe(true);
    expect(Number.isInteger(glyph.top), name).toBe(true);
    for (const value of Object.values(glyph.eye)) expect(Number.isInteger(value), name).toBe(true);
    expect(glyph.eye.right - (glyph.eye.left + glyph.eye.width), name).toBeGreaterThanOrEqual(1);
    const markup = renderToStaticMarkup(createElement('div', null, mascotIds.map(id => createElement(Mascot, { id, glyph: name as keyof typeof smallGlyphs, key: id }))));
    // Every default face draws its two capsules at exactly the glyph's whole-pixel rectangles.
    const eyeRects = markup.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="[\d.]+" fill="oklch/g) ?? [];
    expect(eyeRects.length, name).toBeGreaterThan(40);
    expect(markup, name).not.toContain('linearGradient');
    expect(markup, name).not.toContain('mascot-ground');
  }
  // The list sizes take the small drawings; the picker and the avatar editor keep the large art.
  expect(mascotGlyph('xxs')).toBe('tiny');
  expect(mascotGlyph('xs')).toBe('small');
  expect(mascotGlyph('sm')).toBe('small');
  expect(mascotGlyph('md')).toBe('medium');
  expect(mascotGlyph('lg')).toBe('large');
  expect(mascotGlyph('xl')).toBe('large');
});

it('draws white eyes on every body and dark ones only on a very light body', () => {
  // The eyes are white in both themes, the way Grok's are (owner, 2026-09-21), so they never take the page colour
  // the hat rims use; a near-white worker colour is the one case that needs a dark eye. That is one step on the
  // body's lightness, written once in `eyeColor` and used by every eye and eye stroke.
  expect(eyeColor).toMatch(/^oklch\(from currentColor calc\(0\.25 \+ 0\.73 \* clamp\(0, \(0\.78 - l\) \* 1000, 1\)\) 0 0\)$/);
  const markup = renderToStaticMarkup(createElement('div', null, mascotIds.map(id => createElement(Mascot, { id, key: id }))));
  const eyeFills = markup.match(/<rect [^>]*rx="2\.2"[^>]*fill="([^"]+)"/g) ?? [];
  expect(eyeFills.length).toBeGreaterThan(40);
  for (const eye of eyeFills) expect(eye).toContain(`fill="${eyeColor}"`);
  expect(markup).not.toMatch(/<rect [^>]*rx="2\.2"[^>]*fill="var\(--mascot-ink/);
});

it('gives orglets made together for similar roles different faces and colours (COD-265)', () => {
  const writerHints = { name: 'Writer', description: 'Drafts weekly X posts about what you shipped.' };
  const editorHints = { name: 'Editor', description: 'Edits X drafts for accuracy, clarity and a natural voice.' };
  const writer = distinctMascot(writerHints, 'writer-seed', []);
  expect(writer).toBe(autoMascot(mascotIds, 'writer-seed', writerHints));
  const editor = distinctMascot(editorHints, 'editor-seed', [writer]);
  expect(editor).not.toBe(writer);
  expect(mascotColors[editor]).not.toBe(mascotColors[writer]);
  // With every colour already taken it still picks a face nobody shows.
  const crowd = mascotIds.filter(id => id !== 'notes');
  expect(distinctMascot(editorHints, 'editor-seed', crowd)).toBe('notes');
});

it('starts a new orglet in a colour the other orglets do not show (dogfood, 2026-09-26)', () => {
  // Dev came out purple, and a Writer made next came out purple too.
  const dev = { id: 'dev-id', name: 'Dev' };
  expect(defaultAvatarColor(dev)).toBe(mascotColors.coder);
  const writerHints = { name: 'Writer' };
  expect(mascotColors[autoMascot(mascotIds, 'writer-seed', writerHints)]).toBe(defaultAvatarColor(dev));
  const writer = distinctAvatar(writerHints, 'writer-seed', ['coder'], [defaultAvatarColor(dev)]);
  const writerColor = writer.color ?? mascotColors[writer.mascot];
  expect(writerColor).not.toBe(defaultAvatarColor(dev));
  // A colour the person picked for another orglet counts as shown, whatever its face.
  const picked = distinctAvatar(writerHints, 'writer-seed', ['classic'], [mascotColors.notes, mascotColors.writer]);
  expect([mascotColors.notes, mascotColors.writer]).not.toContain(picked.color ?? mascotColors[picked.mascot]);
  // When no fitting face has a free colour, the face stays and only the colour moves.
  const allButTeal = avatarPalette.filter(color => color !== mascotColors.chart);
  const crowded = distinctAvatar(writerHints, 'writer-seed', ['coder'], allButTeal);
  expect(crowded).toEqual({ mascot: 'writer', color: mascotColors.chart });
  // Nobody else yet: the plain automatic face in its own colour.
  expect(distinctAvatar(writerHints, 'writer-seed', [], [])).toEqual({ mascot: autoMascot(mascotIds, 'writer-seed', writerHints) });
});
