/**
 * The font typed notes are written in when a PDF is saved (COD-302): Inter SemiBold, the face and weight the viewer
 * draws notes in, made from the app's own `InterVariable.woff2` (SIL Open Font License, `fonts/Inter-OFL.txt`) as a
 * static TrueType instance at wght 600, opsz 14, since a PDF embeds TrueType, not WOFF2 or a variable font. Made with
 * fontTools 4.60.1 (`uv run --with fonttools==4.60.1 --with brotli==1.1.0 python`):
 *
 *   font = instancer.instantiateVariableFont(TTFont('InterVariable.woff2'), {'wght': 600, 'opsz': 14})
 *   font.flavor = None
 *   for record in (16, 17, 21, 22, 25): font['name'].removeNames(nameID=record)
 *   for record, value in ((1, 'Inter SemiBold'), (2, 'Regular'), (3, '4.001;RSMS;Inter-SemiBold'), (4, 'Inter SemiBold'),
 *                         (6, 'Inter-SemiBold'), (16, 'Inter'), (17, 'SemiBold')):
 *     font['name'].setName(value, record, 3, 1, 0x409); font['name'].setName(value, record, 1, 0, 0)
 *   font['OS/2'].usWeightClass = 600
 *   font.save('Inter-SemiBold.ttf')
 *
 * It is inlined into this lazily loaded module, so the page reads it without a request (a `file:` page cannot fetch).
 */
import fontData from './fonts/Inter-SemiBold.ttf?inline';

export function noteFontBytes(): Uint8Array {
  const base64 = fontData.slice(fontData.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
