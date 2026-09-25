import { CodePreview, type LineMark } from './CodePreview';
import { t } from '../i18n';

/**
 * What the two font choices look like, shown under their rows in Settings (COD-172, from the owner's Claude
 * "Code appearance" reference). Both samples read the live font tokens (`--font`, `--font-mono`), so a pick
 * shows here the moment it is saved. Neither knows the workspace: they are samples, not settings.
 */

/**
 * One sentence in the interface font, in the text colour, under a small "Preview" word so nobody takes the sentence
 * for a setting or a hint (owner, 2026-09-25).
 */
export function InterfaceFontSample() {
  return <div className="font-sample" role="group" aria-label={t('Xem trước phông chữ')}>
    <span className="font-sample-label">{t('Xem trước')}</span>
    <p>{t('Tí đọc nguồn rồi trả lời bằng tiếng Việt có dấu đầy đủ.')}</p>
  </div>;
}

/** Line five went and line six came, so the diff colours show beside the token colours. */
const CODE_SAMPLE_MARKS: Partial<Record<number, LineMark>> = { 5: 'removed', 6: 'added' };

/**
 * The lines are kept short so two cards fit side by side in the dialog without wrapping. The comment is the
 * only translated line: a Vietnamese comment shows the code font's diacritics, and the string shows the glyphs
 * a code font has to keep apart.
 */
function codeSample(): string {
  return [
    `// ${t('Đọc rồi trả lời')}`,
    'const tag = "il1 O0";',
    'function pick(list) {',
    '  const n = 3;',
    '  return list;',
    '  return top(list, n);',
    '}',
  ].join('\n');
}

/**
 * The same short snippet on a light card and a dark card, side by side, with line numbers, the tokenizer's
 * colours and one removed/added pair. Each card carries its own theme through `.theme-light` / `.theme-dark`,
 * so both are seen at once whatever the app is set to; the code renderer and its tokens are the ones every
 * source view uses. The cards stack when the panel is narrow.
 */
export function CodeFontPreview() {
  const sample = codeSample();
  return <div className="font-preview-cards" role="group" aria-label={t('Xem trước phông chữ code')}>
    <div className="font-preview-card theme-light" role="group" aria-label={t('Nền sáng')}>
      <CodePreview text={sample} language="javascript" lineMarks={CODE_SAMPLE_MARKS} />
    </div>
    <div className="font-preview-card theme-dark" role="group" aria-label={t('Nền tối')}>
      <CodePreview text={sample} language="javascript" lineMarks={CODE_SAMPLE_MARKS} />
    </div>
  </div>;
}
