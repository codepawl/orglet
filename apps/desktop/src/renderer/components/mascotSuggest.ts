import type { MascotId } from './mascots';
import { bodyShapeIds, mascotShapes, type BodyShapeId } from './orgletShapes';

/*
 * Mascot groups for the picker. The suggester, the automatic face and the colours are pure and live in
 * `shared/mascot-suggest.ts`, so main (for the `orglet` command) picks the same default face and colour as the app.
 */
export {
  autoMascot, avatarPalette, defaultAvatarColor, distinctAvatar, distinctMascot, mascotColors, rankMascots, seedHash, suggestMascots, suggestedColors, suggestedMascots,
  type MascotHints, type MascotSuggestion,
} from '../../shared/mascot-suggest';

/* The picker groups the mascots by body (owner, 2026-10-05: an orglet is told by its shape, and nothing is worn), so
   a row holds one body with each of the eyes it comes with. The names are the ones `mascotName` uses. */
export const mascotCategoryLabels = {
  base: 'Dáng gốc',
  tailRight: 'Góc nhỏ bên phải',
  tailTop: 'Góc nhỏ phía trên',
  round: 'Tròn đều',
  tall: 'Dáng cao',
  wide: 'Dáng rộng',
  leaf: 'Dáng lá',
  soft: 'Dáng mềm',
} satisfies Record<BodyShapeId, string>;
export type MascotCategory = keyof typeof mascotCategoryLabels;

export const mascotCategoryIds: Record<MascotCategory, MascotId[]> = Object.assign({}, ...bodyShapeIds.map(body => ({
  [body]: (Object.keys(mascotShapes) as MascotId[]).filter(id => mascotShapes[id].body === body),
})));
