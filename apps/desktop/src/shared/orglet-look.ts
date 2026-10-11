/*
 * An orglet's look is a body and a pair of eyes (plus a colour, which is stored beside it). Owner, 2026-10-12: the
 * old named looks are gone and only the shape of the body, the colour and the shape of the eyes remain.
 *
 * It is stored in the `mascot` string that `WorkerAvatar` already has, as `<body>-<eyes>` in kebab-case (for example
 * `tall-wink` or `tail-right-plain`). No field is added, because the released app reads an avatar strictly and
 * a released app that meets a value it does not know simply falls back to its automatic look.
 *
 * Pure and shared, so the renderer and main (the `orglet` command) read a stored value the same way.
 */

export const BODY_SHAPE_IDS = ['base', 'round', 'tall', 'tailRight', 'wide', 'soft', 'tailTop', 'leaf'] as const;
export type BodyShapeId = typeof BODY_SHAPE_IDS[number];

/** The eyes' expressions, all of them in the eyes alone: nothing is worn on the face either. */
export const EYE_IDS = ['plain', 'happy', 'curious', 'wink', 'sleepy', 'narrow', 'delighted'] as const;
export type FaceId = typeof EYE_IDS[number];

export type OrgletLook = { body: BodyShapeId; eyes: FaceId };

const kebab = (body: BodyShapeId) => body.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/** The stored form: `<body>-<eyes>`, kebab-case, which fits the `mascot` pattern of the released schema. */
export function formatLook(look: OrgletLook): string {
  return `${kebab(look.body)}-${look.eyes}`;
}

/** Every one of the 8 x 7 = 56 looks, bodies in the order of `BODY_SHAPE_IDS`. */
export const ALL_LOOKS: readonly OrgletLook[] = BODY_SHAPE_IDS.flatMap(body => EYE_IDS.map(eyes => ({ body, eyes })));

const looksByStoredForm = new Map<string, OrgletLook>(ALL_LOOKS.map(look => [formatLook(look), look]));

/*
 * The 29 names orglets were saved under before 2026-10-12, each now a body and a pair of eyes. This table exists only
 * so a saved orglet keeps its look: a stored `classic` still reads as the base body with plain eyes. `paletteSlot` is
 * the identity colour (an index into the palette in `mascot-suggest.ts`) the name gave, so an orglet that never chose
 * a colour keeps that one too. Nothing else may name these ids, and new looks are never added here. Frozen: the order
 * is the order the automatic look picks from.
 */
const LEGACY_LOOKS = Object.freeze({
  classic: { body: 'base', eyes: 'plain', paletteSlot: 1 },
  happy: { body: 'round', eyes: 'happy', paletteSlot: 4 },
  curious: { body: 'tall', eyes: 'curious', paletteSlot: 6 },
  wink: { body: 'tailRight', eyes: 'wink', paletteSlot: 3 },
  sleepy: { body: 'wide', eyes: 'sleepy', paletteSlot: 3 },
  focused: { body: 'soft', eyes: 'narrow', paletteSlot: 1 },
  antenna: { body: 'tailTop', eyes: 'plain', paletteSlot: 6 },
  sprout: { body: 'leaf', eyes: 'plain', paletteSlot: 2 },
  idea: { body: 'round', eyes: 'plain', paletteSlot: 4 },
  headset: { body: 'wide', eyes: 'plain', paletteSlot: 6 },
  delighted: { body: 'leaf', eyes: 'delighted', paletteSlot: 5 },
  cool: { body: 'tailTop', eyes: 'narrow', paletteSlot: 7 },
  tie: { body: 'tall', eyes: 'plain', paletteSlot: 1 },
  bowtie: { body: 'soft', eyes: 'plain', paletteSlot: 5 },
  briefcase: { body: 'tailRight', eyes: 'plain', paletteSlot: 4 },
  calendar: { body: 'base', eyes: 'happy', paletteSlot: 0 },
  mail: { body: 'tailRight', eyes: 'happy', paletteSlot: 1 },
  finance: { body: 'tall', eyes: 'happy', paletteSlot: 2 },
  search: { body: 'base', eyes: 'curious', paletteSlot: 1 },
  chart: { body: 'wide', eyes: 'curious', paletteSlot: 6 },
  target: { body: 'round', eyes: 'curious', paletteSlot: 0 },
  writer: { body: 'soft', eyes: 'happy', paletteSlot: 3 },
  notes: { body: 'leaf', eyes: 'happy', paletteSlot: 4 },
  megaphone: { body: 'tailTop', eyes: 'delighted', paletteSlot: 0 },
  checker: { body: 'round', eyes: 'delighted', paletteSlot: 2 },
  guard: { body: 'base', eyes: 'narrow', paletteSlot: 7 },
  coder: { body: 'tailRight', eyes: 'curious', paletteSlot: 3 },
  automation: { body: 'tall', eyes: 'wink', paletteSlot: 4 },
  care: { body: 'wide', eyes: 'happy', paletteSlot: 5 },
} as const satisfies Record<string, OrgletLook & { paletteSlot: number }>);

/** The looks the 29 old names stood for, in the old order: the pool the automatic look still picks from. */
export const STARTER_LOOKS: readonly OrgletLook[] = Object.values(LEGACY_LOOKS).map(({ body, eyes }) => ({ body, eyes }));

/** The identity-colour slot an old name gave this look, or undefined for a look no old name had. */
export function starterPaletteSlot(look: OrgletLook): number | undefined {
  return Object.values(LEGACY_LOOKS).find(entry => entry.body === look.body && entry.eyes === look.eyes)?.paletteSlot;
}

/**
 * Reads a stored `mascot` string: a `<body>-<eyes>` value, or one of the old names (which reads as the body and eyes
 * it always had). Anything else, a released app's unknown value included, is undefined.
 */
export function parseLook(stored: string | undefined): OrgletLook | undefined {
  if (!stored) return undefined;
  const current = looksByStoredForm.get(stored);
  if (current) return current;
  if (!Object.hasOwn(LEGACY_LOOKS, stored)) return undefined;
  const { body, eyes } = LEGACY_LOOKS[stored as keyof typeof LEGACY_LOOKS];
  return { body, eyes };
}

export const sameLook = (a: OrgletLook, b: OrgletLook) => a.body === b.body && a.eyes === b.eyes;

/** A stored value written in today's form (an old name becomes its `<body>-<eyes>`), or undefined when it is not a look. */
export function normalizeStoredLook(stored: string | undefined): string | undefined {
  const look = parseLook(stored);
  return look ? formatLook(look) : undefined;
}

/** The look of an orglet nobody can name (a message with no known author): the logo's own body and plain eyes. */
export const DEFAULT_LOOK: OrgletLook = { body: 'base', eyes: 'plain' };
