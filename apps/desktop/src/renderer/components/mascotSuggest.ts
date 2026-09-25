import type { MascotId } from './mascots';

/*
 * Mascot categories for the picker. The suggester, the automatic face and the colours are pure and live in
 * `shared/mascot-suggest.ts`, so main (for the `orglet` command) picks the same default face and colour as the app.
 */
export {
  autoMascot, avatarPalette, distinctMascot, mascotColors, rankMascots, seedHash, suggestMascots, suggestedColors, suggestedMascots,
  type MascotHints, type MascotSuggestion,
} from '../../shared/mascot-suggest';

export const mascotCategoryLabels = {
  basic: 'Cơ bản',
  office: 'Công sở',
  research: 'Nghiên cứu & phân tích',
  content: 'Nội dung & truyền thông',
  quality: 'Kiểm tra & bảo mật',
  tech: 'Kỹ thuật',
  support: 'Hỗ trợ & con người',
};
export type MascotCategory = keyof typeof mascotCategoryLabels;

export const mascotCategoryIds: Record<MascotCategory, MascotId[]> = {
  basic: ['classic', 'happy', 'curious', 'wink', 'delighted', 'cool', 'sleepy'],
  office: ['tie', 'bowtie', 'briefcase', 'calendar', 'mail', 'finance'],
  research: ['search', 'chart', 'focused', 'target', 'idea'],
  content: ['writer', 'notes', 'megaphone'],
  quality: ['checker', 'guard'],
  tech: ['coder', 'automation', 'antenna'],
  support: ['headset', 'care', 'sprout'],
};
