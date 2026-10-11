import { expect, it } from 'vitest';
import { bodyShapes } from '../../apps/desktop/src/renderer/components/orgletShapes';
import { WorkerAvatar } from '../../apps/desktop/src/shared/contracts';
import { ALL_LOOKS, BODY_SHAPE_IDS, DEFAULT_LOOK, EYE_IDS, STARTER_LOOKS, formatLook, normalizeStoredLook, parseLook } from '../../apps/desktop/src/shared/orglet-look';

/** The body and eyes each of the 29 old names had on 2026-10-11 (`mascotShapes`), written out so a saved orglet keeps its look. */
const oldTable: Record<string, [string, string]> = {
  classic: ['base', 'plain'], happy: ['round', 'happy'], curious: ['tall', 'curious'], wink: ['tailRight', 'wink'], sleepy: ['wide', 'sleepy'],
  focused: ['soft', 'narrow'], antenna: ['tailTop', 'plain'], sprout: ['leaf', 'plain'], idea: ['round', 'plain'], headset: ['wide', 'plain'],
  delighted: ['leaf', 'delighted'], cool: ['tailTop', 'narrow'], tie: ['tall', 'plain'], bowtie: ['soft', 'plain'], briefcase: ['tailRight', 'plain'],
  calendar: ['base', 'happy'], mail: ['tailRight', 'happy'], finance: ['tall', 'happy'], search: ['base', 'curious'], chart: ['wide', 'curious'],
  target: ['round', 'curious'], writer: ['soft', 'happy'], notes: ['leaf', 'happy'], megaphone: ['tailTop', 'delighted'], checker: ['round', 'delighted'],
  guard: ['base', 'narrow'], coder: ['tailRight', 'curious'], automation: ['tall', 'wink'], care: ['wide', 'happy'],
};

it('reads every old name as the body and eyes it always had', () => {
  expect(Object.keys(oldTable)).toHaveLength(29);
  for (const [id, [body, eyes]] of Object.entries(oldTable)) expect(parseLook(id), id).toEqual({ body, eyes });
  expect(STARTER_LOOKS).toEqual(Object.values(oldTable).map(([body, eyes]) => ({ body, eyes })));
});

it('round-trips all 56 pairs through the stored form', () => {
  expect(BODY_SHAPE_IDS).toHaveLength(8);
  expect(EYE_IDS).toHaveLength(7);
  expect(ALL_LOOKS).toHaveLength(56);
  const stored = new Set<string>();
  for (const look of ALL_LOOKS) {
    const text = formatLook(look);
    expect(text, text).toMatch(/^[a-z-]{1,32}$/);
    expect(parseLook(text), text).toEqual(look);
    stored.add(text);
  }
  expect(stored.size).toBe(56);
  expect(Object.keys(bodyShapes).sort()).toEqual([...BODY_SHAPE_IDS].sort());
});

it('writes the kebab-case form the released schema accepts', () => {
  expect(formatLook({ body: 'tall', eyes: 'wink' })).toBe('tall-wink');
  expect(formatLook({ body: 'tailRight', eyes: 'plain' })).toBe('tail-right-plain');
  expect(formatLook({ body: 'tailTop', eyes: 'delighted' })).toBe('tail-top-delighted');
  expect(formatLook(DEFAULT_LOOK)).toBe('base-plain');
  for (const look of ALL_LOOKS) expect(WorkerAvatar.safeParse({ mascot: formatLook(look) }).success).toBe(true);
});

it('returns undefined for anything that is not a look', () => {
  for (const garbage of [undefined, '', 'nope', 'tall', 'tall-', 'tall-angry', 'tailRight-plain', 'TALL-WINK', 'tall-wink-x', ' tall-wink', 'constructor', '__proto__', 'toString']) {
    expect(parseLook(garbage), String(garbage)).toBeUndefined();
  }
});

it('rewrites an old name to the new form and leaves other values alone', () => {
  expect(normalizeStoredLook('finance')).toBe('tall-happy');
  expect(normalizeStoredLook('tall-happy')).toBe('tall-happy');
  expect(normalizeStoredLook('unknown')).toBeUndefined();
});
