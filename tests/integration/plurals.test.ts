import { expect, it } from 'vitest';
import { en } from '../../apps/desktop/src/shared/locales/en';
import { tableSizeLabel } from '../../apps/desktop/src/renderer/components/TablePreview';
import { forwardSummary } from '../../apps/desktop/src/renderer/forward';

// Counts read "1 page" and "2 pages": each count phrase has a key of its own for one (COD-292).
it('gives a count of one its own words', () => {
  expect(tableSizeLabel(1, 1)).toBe('1 row · 1 column');
  expect(tableSizeLabel(1204, 3)).toBe('1,204 rows · 3 columns');
  expect(forwardSummary(1, [{ name: 'Writer', error: 'Something the core never says.' }]))
    .toBe('Forwarded to 1 chat. Not sent: Writer: Something the core never says.');
});

it('never pairs a count of one with a plural noun in English', () => {
  const pluralAfterOne = Object.values(en).filter(value => /(^|[^\d.,])1 [a-zA-Z-]+s\b/.test(value))
    .filter(value => !/(^|[^\d.,])1 (?:is|was|has|does)\b/.test(value));
  expect(pluralAfterOne).toEqual([]);
});

it('keeps a singular key beside each plural count the app shows at one', () => {
  const pairs = [
    ['1 trang', '{0} trang'], ['1 phần tử', '{0} phần tử'], ['1 trường', '{0} trường'], ['1 yêu cầu', '{0} yêu cầu'],
    ['1 mục không được thêm vào chat', '{0} mục không được thêm vào chat'], ['1 Tí', '{0} Tí'], ['1 nguồn', '{0} nguồn'],
    ['Đã xóa 1 Tí', 'Đã xóa {0} Tí'], ['Đã lưu trữ 1 hội', 'Đã lưu trữ {0} hội'], ['Tự xóa sau 1 ngày', 'Tự xóa sau {0} ngày'],
  ];
  for (const [one, several] of pairs) {
    expect(en[one], one).toMatch(/\b1 [a-z]/);
    expect(en[several], several).toMatch(/\{0\} [a-z]+s\b/);
  }
});
