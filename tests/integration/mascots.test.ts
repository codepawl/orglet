import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Mascot, artOf, bubbleOutline, eyeColor, smallBodyBox, smallGlyphs } from '../../apps/desktop/src/renderer/components/mascots';
import { bodyPath, bodyShapeIds, bodyShapes } from '../../apps/desktop/src/renderer/components/orgletShapes';
import { mascotGlyph } from '../../apps/desktop/src/renderer/components/Avatar';
import { autoLook, avatarPalette, defaultAvatarColor, distinctAvatar, distinctLook, lookColor, rankLooks, suggestLooks, suggestedColors, suggestedLooks } from '../../apps/desktop/src/renderer/components/mascotSuggest';
import { ALL_LOOKS, formatLook, parseLook, sameLook, type OrgletLook } from '../../apps/desktop/src/shared/orglet-look';

/** A look as an old stored name read it: these tests name the old ids only to show the saved ones keep their look. */
const old = (id: string): OrgletLook => parseLook(id)!;
const is = (look: OrgletLook | undefined, id: string) => look !== undefined && sameLook(look, old(id));
const top = (name: string, description?: string) => suggestLooks({ name, description })[0];

it('suggests looks from Vietnamese and English roles', () => {
  expect(is(top('Researcher'), 'search')).toBe(true);
  expect(is(top('Kế toán trưởng'), 'finance')).toBe(true);
  expect(is(top('Tí chăm sóc khách hàng'), 'headset')).toBe(true);
  expect(is(top('Lập trình viên backend'), 'coder')).toBe(true);
  expect(is(top('Trợ lý', 'Sắp xếp lịch họp cho sếp'), 'calendar')).toBe(true);
  expect(is(top('Data analyst'), 'chart')).toBe(true);
  expect(is(top('Chuyên viên tuyển dụng'), 'care')).toBe(true);
});

it('matches whole words, with prefixes only for longer stems', () => {
  expect(suggestLooks({ name: 'Latest news' }).some(look => is(look, 'checker'))).toBe(false);
  expect(is(top('Chất lượng'), 'checker')).toBe(true);
  expect(suggestLooks({ name: 'Lịch sử công ty' }).some(look => is(look, 'calendar'))).toBe(false);
  expect(is(suggestLooks({ name: 'Hợp đồng' })[0], 'briefcase')).toBe(true);
});

it('weights the name above the description and instructions, and one field cannot stack a keyword', () => {
  expect(is(top('Writer', 'reviews drafts'), 'writer')).toBe(true);
  expect(is(suggestLooks({ name: 'Minh', instructions: 'Review the evidence carefully.' })[0], 'checker')).toBe(true);
  const scoreOf = (name: string) => rankLooks({ name }).find(item => is(item.look, 'checker'))!.score;
  expect(scoreOf('audit audit audit')).toBe(scoreOf('audit'));
  expect(is(suggestLooks({ name: 'Minh', skill: 'Payroll' })[0], 'finance')).toBe(true);
});

it('always offers suggestions, pushes back looks other workers use, and keeps the automatic look stable', () => {
  expect(suggestLooks({ name: 'Zed' })).toEqual([]);
  expect(suggestedLooks({ name: 'Zed' })).toHaveLength(7);
  expect(is(suggestedLooks({ name: 'Researcher' })[0], 'search')).toBe(true);
  expect(is(suggestedLooks({ name: 'Researcher' }, { taken: [old('search')] })[0], 'focused')).toBe(true);
  expect(is(suggestedLooks({ name: 'Zed' }, { taken: [old('tie')] })[0], 'briefcase')).toBe(true);
  expect(autoLook('w1', { name: 'Zed' })).toEqual(autoLook('w1', { name: 'Zed' }));
  expect(is(autoLook('w1', { name: 'Researcher' }), 'search')).toBe(true);
});

it('suggests three colours led by the colour of the look shown', () => {
  const colors = suggestedColors(old('finance'), 'w1', { name: 'Kế toán trưởng' });
  expect(colors).toHaveLength(3);
  expect(colors[0]).toBe(lookColor(old('finance')));
  expect(new Set(colors).size).toBe(3);
  expect(suggestedColors(old('classic'), 'w1', { name: 'Zed' })[0]).toBe(lookColor(old('classic')));
});

it('keeps the colour every old name gave, and gives any other look a palette colour', () => {
  // The colours the 29 old names carried before 2026-10-12, written out so a saved orglet that never chose one keeps its colour.
  const [coral, blue, green, purple, amber, rose, teal, slate] = avatarPalette;
  const expected: Record<string, string> = {
    classic: blue, happy: amber, curious: teal, wink: purple, delighted: rose, cool: slate, sleepy: purple,
    tie: blue, bowtie: rose, briefcase: amber, calendar: coral, mail: blue, finance: green,
    search: blue, chart: teal, focused: blue, target: coral, idea: amber,
    writer: purple, notes: amber, megaphone: coral,
    checker: green, guard: slate,
    coder: purple, automation: amber, antenna: teal,
    headset: teal, care: rose, sprout: green,
  };
  expect(Object.keys(expected)).toHaveLength(29);
  for (const [id, color] of Object.entries(expected)) expect(lookColor(old(id)), id).toBe(color);
  for (const look of ALL_LOOKS) expect(avatarPalette, formatLook(look)).toContain(lookColor(look));
  expect(defaultAvatarColor({ id: 'a', name: 'Researcher', avatar: { mascot: 'finance' } })).toBe(green);
  expect(defaultAvatarColor({ id: 'a', name: 'Researcher', avatar: { mascot: 'tall-happy' } })).toBe(green);
});

/** Every element a look draws, flattened out of the fragment tree, with the colours it paints with. */
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

it('draws a body, its eyes and nothing worn', () => {
  // Owner, 2026-10-05: no hat and nothing worn. A hat in the body's own colour needed a rim in the page colour to
  // read over the bubble (COD-106), and that rim read as a mistake. So a mascot paints exactly one shape in the body
  // paint, which is its body from `orgletShapes.ts`, and everything else is an eye or a blush.
  const bodyColoured = (fill: string | undefined) => fill === 'currentColor' || Boolean(fill?.startsWith('var(--mascot-fill'));
  for (const look of ALL_LOOKS) {
    const id = formatLook(look);
    const shapes = painted(artOf(look));
    const bodies = shapes.filter(shape => bodyColoured(shape.fill));
    expect(bodies.map(shape => shape.d), id).toEqual([bodyPath(bodyShapes[look.body])]);
    for (const shape of shapes) {
      expect(shape.stroke ?? '', `${id}: nothing is rimmed in the page colour`).not.toContain('--mascot-ink');
      if (bodyColoured(shape.fill) || shape.name === 'g') continue;
      expect([shape.fill, shape.stroke].some(paint => paint === eyeColor || paint === '#ff8fa3'), `${id}: a ${shape.name} is neither an eye nor a blush`).toBe(true);
    }
  }
  // All 8 x 7 = 56 pairs of a body and eyes draw, and no two are the same.
  expect(new Set(ALL_LOOKS.map(formatLook)).size).toBe(56);
  // The cursor draws the logo's own outline: the app icon's bowed bubble on the 64 grid.
  expect(bubbleOutline.startsWith('M32 13C45.24 13 52 19.76 52 33')).toBe(true);
});

it('lights every mascot from its own gradient, never a shared one', () => {
  // Many faces sit on one page. A gradient id shared between them would resolve to the first face in the document,
  // painting every mascot in that one's colour, so each rendered face must define and reference its own.
  const markup = renderToStaticMarkup(createElement('div', null, ALL_LOOKS.map(look => createElement(Mascot, { look, key: formatLook(look) }))));
  const definedIds = [...markup.matchAll(/<linearGradient id="([^"]+)-body"/g)].map(match => match[1]);
  const referencedIds = [...markup.matchAll(/--mascot-fill:url\(#([^)]+)-body\)/g)].map(match => match[1]);
  expect(definedIds).toHaveLength(ALL_LOOKS.length);
  expect(new Set(definedIds).size).toBe(ALL_LOOKS.length);
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
    const markup = renderToStaticMarkup(createElement('div', null, ALL_LOOKS.map(look => createElement(Mascot, { look, glyph: name as keyof typeof smallGlyphs, key: formatLook(look) }))));
    // Every plain face draws its two capsules at whole-pixel rectangles, moved with its body's box by whole pixels.
    const eyeRects = markup.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="[\d.]+" fill="oklch/g) ?? [];
    expect(eyeRects.length, name).toBe(2 * ALL_LOOKS.filter(look => look.eyes === 'plain').length);
    // Every body's box is whole pixels, centred on the canvas, inside it, and stands on the logo body's bottom line.
    for (const id of bodyShapeIds) {
      const box = smallBodyBox(glyph, bodyShapes[id]);
      for (const value of [box.left, box.top, box.width, box.height]) expect(Number.isInteger(value), `${name} ${id}`).toBe(true);
      expect(box.left * 2 + box.width, `${name} ${id}`).toBe(glyph.canvas);
      expect(box.left, `${name} ${id}`).toBeGreaterThanOrEqual(0);
      expect(box.top, `${name} ${id}`).toBeGreaterThanOrEqual(0);
      expect(box.top + box.height, `${name} ${id}`).toBe(glyph.top + glyph.body);
      for (const corner of box.corners) expect(corner * 2, `${name} ${id}`).toBeLessThanOrEqual(Math.min(box.width, box.height));
    }
    // The logo's own body is the box the glyph was tuned for.
    expect(smallBodyBox(glyph, bodyShapes.base), name).toMatchObject({ left, top: glyph.top, width: glyph.body, height: glyph.body, corners: [glyph.corner, glyph.corner, glyph.corner, glyph.tail] });
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
  const markup = renderToStaticMarkup(createElement('div', null, ALL_LOOKS.map(look => createElement(Mascot, { look, key: formatLook(look) }))));
  const eyeFills = markup.match(/<rect [^>]*rx="2\.2"[^>]*fill="([^"]+)"/g) ?? [];
  expect(eyeFills.length).toBeGreaterThanOrEqual(30);
  for (const eye of eyeFills) expect(eye).toContain(`fill="${eyeColor}"`);
  expect(markup).not.toMatch(/<rect [^>]*rx="2\.2"[^>]*fill="var\(--mascot-ink/);
});

it('gives orglets made together for similar roles different looks and colours (COD-265)', () => {
  const writerHints = { name: 'Writer', description: 'Drafts weekly X posts about what you shipped.' };
  const editorHints = { name: 'Editor', description: 'Edits X drafts for accuracy, clarity and a natural voice.' };
  const writer = distinctLook(writerHints, 'writer-seed', []);
  expect(writer).toEqual(autoLook('writer-seed', writerHints));
  const editor = distinctLook(editorHints, 'editor-seed', [writer]);
  expect(sameLook(editor, writer)).toBe(false);
  expect(lookColor(editor)).not.toBe(lookColor(writer));
  // With every colour already taken it still picks a look nobody shows.
  const crowd = ALL_LOOKS.filter(look => !is(look, 'notes'));
  expect(is(distinctLook(editorHints, 'editor-seed', crowd), 'notes')).toBe(true);
});

it('starts a new orglet in a colour the other orglets do not show (dogfood, 2026-09-26)', () => {
  // Dev came out purple, and a Writer made next came out purple too.
  const dev = { id: 'dev-id', name: 'Dev' };
  expect(defaultAvatarColor(dev)).toBe(lookColor(old('coder')));
  const writerHints = { name: 'Writer' };
  expect(lookColor(autoLook('writer-seed', writerHints))).toBe(defaultAvatarColor(dev));
  const colorOf = (avatar: { mascot: string; color?: string }) => avatar.color ?? lookColor(parseLook(avatar.mascot)!);
  const writer = distinctAvatar(writerHints, 'writer-seed', [old('coder')], [defaultAvatarColor(dev)]);
  expect(colorOf(writer)).not.toBe(defaultAvatarColor(dev));
  // A colour the person picked for another orglet counts as shown, whatever its look.
  const shown = [lookColor(old('notes')), lookColor(old('writer'))];
  const picked = distinctAvatar(writerHints, 'writer-seed', [old('classic')], shown);
  expect(shown).not.toContain(colorOf(picked));
  // When no fitting look has a free colour, the look stays and only the colour moves.
  const chartColor = lookColor(old('chart'));
  const allButTeal = avatarPalette.filter(color => color !== chartColor);
  const crowded = distinctAvatar(writerHints, 'writer-seed', [old('coder')], allButTeal);
  expect(crowded).toEqual({ mascot: formatLook(old('writer')), color: chartColor });
  // Nobody else yet: the plain automatic look in its own colour, stored in the new form.
  expect(distinctAvatar(writerHints, 'writer-seed', [], [])).toEqual({ mascot: formatLook(autoLook('writer-seed', writerHints)) });
});
