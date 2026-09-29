/** Vietnamese letters carry diacritics or are đ; English UI text and the names in these fixtures have neither. */
export const hasVietnamese = (text: string) => /[\u0300-\u036f\u0110\u0111]/.test(text.normalize('NFD'));
