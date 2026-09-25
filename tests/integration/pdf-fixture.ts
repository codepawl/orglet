/** A PDF string escapes its own delimiters. */
function pdfString(text: string) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

/** A page's drawing: each line of text in Helvetica, or, for a page with no lines, a grey box and no text at all. */
function pageStream(lines: string[]) {
  if (!lines.length) return '0.5 g 72 72 468 648 re f';
  const shown = lines.map(line => `(${pdfString(line)}) Tj T*`).join(' ');
  return `BT /F1 12 Tf 72 740 Td 16 TL ${shown} ET`;
}

/**
 * A small, valid PDF with one page per entry, built the way a simple text PDF such as an invoice is: a Helvetica text
 * layer, one line per string. An empty entry is a page with no text layer, like a scanned page.
 */
export function pdfWithPages(pages: string[][]): Buffer {
  const objects: string[] = [];
  // Object 1 is the catalog, 2 the page tree, 3 the font; each page then takes a page object and its content stream.
  const pageObjectNumber = (index: number) => 4 + index * 2;
  const kids = pages.map((_, index) => `${pageObjectNumber(index)} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, index) => {
    const pageNumber = pageObjectNumber(index);
    const stream = pageStream(lines);
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNumber + 1} 0 R >>`;
    objects[pageNumber + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number++) {
    offsets[number] = Buffer.byteLength(body, 'latin1');
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number++) body += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** The invoice from the COD-260 report: a one-page text PDF with the total and the due date. */
export const invoicePdf = () => pdfWithPages([[
  'INVOICE #2026-0917',
  'Client: Acme Studio',
  'Design review x3 ........ 1.500.000 VND',
  'Hosting (Sep) ........... 250.000 VND',
  'Total due ............... 1.750.000 VND',
  'Due date: 30 Sep 2026',
]]);
