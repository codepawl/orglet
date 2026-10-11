/*
 * The suggester, the automatic look and the colours are pure and live in `shared/mascot-suggest.ts`, so main (for the
 * `orglet` command) picks the same default look and colour as the app.
 */
export {
  autoLook, avatarPalette, defaultAvatarColor, distinctAvatar, distinctLook, lookColor, rankLooks, seedHash, shownLook, suggestLooks, suggestedColors, suggestedLooks,
  type LookSuggestion, type MascotHints,
} from '../../shared/mascot-suggest';
