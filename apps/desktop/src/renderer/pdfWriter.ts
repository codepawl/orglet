/**
 * Writes the marks made on a PDF in the viewer into a new PDF (COD-302). The original bytes are only read: the result
 * is a separate file the core keeps as a new version. Marks go into each page's own content, drawn over what is there,
 * so every reader shows them the same way; typed notes are real text in an embedded font (Inter SemiBold, subset to
 * the characters used), so an orglet reading the saved PDF's text layer reads the notes too.
 *
 * Loaded only when a PDF is being marked up. Nothing here touches the DOM, so tests run it in Node.
 */
import {
  EncryptedPDFError, LineCapStyle, LineJoinStyle, PDFDocument, PDFName, PDFNumber,
  appendBezierCurve, beginText, closePath, concatTransformationMatrix, endText, lineTo, moveTo, popGraphicsState,
  pushGraphicsState, setFillingRgbColor, setFontAndSize, setGraphicsState, setLineCap, setLineJoin, setLineWidth,
  setStrokingRgbColor, setTextMatrix, showText, stroke,
  type PDFFont, type PDFOperator, type PDFPage,
} from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { arrowHead, isShape, isStroke, noteLines, rectFrom, type Mark, type Point, type ShapeMark, type StrokeMark, type TextMark } from './markup';

/** A page's affine transform from PDF user space to its layout at scale 1, as pdf.js gives it: [a, b, c, d, e, f]. */
export type PageTransform = readonly [number, number, number, number, number, number];

/** The marks of one page, with the layout they were drawn in. `page` counts from 1. */
export type MarkedPage = { page: number; transform: PageTransform; marks: readonly Mark[] };

/** How a highlighter stroke looks, matching the canvas (`markup.ts`). */
const HIGHLIGHTER_WIDTH_FACTOR = 4;
const HIGHLIGHTER_OPACITY = 0.35;
/** How far a Bézier control point sits along a quarter circle's tangent, as a share of the radius. */
const KAPPA = 0.5522847498;

/**
 * Opens the PDF for writing, or says in one sentence why it cannot be marked up. A locked or password-protected PDF is
 * refused: writing it again would either fail or silently drop its protection.
 */
export async function openForMarkup(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw new Error('PDF này có mật khẩu hoặc bị khóa nên chưa đánh dấu được.');
    throw new Error('Không đọc được PDF này để đánh dấu.');
  }
}

/** The characters of the notes that the note font cannot draw, each listed once, in the order they first appear. */
export function missingCharacters(fontBytes: Uint8Array, pages: readonly MarkedPage[]): string[] {
  const font = fontkit.create(fontBytes);
  if (!('hasGlyphForCodePoint' in font)) throw new Error('Không đọc được phông chữ cho ghi chú.');
  const missing = new Set<string>();
  for (const page of pages) {
    for (const mark of page.marks) {
      if (mark.kind !== 'text') continue;
      for (const character of mark.text.normalize('NFC')) {
        if (character === '\n') continue;
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && !font.hasGlyphForCodePoint(codePoint)) missing.add(character);
      }
    }
  }
  return [...missing];
}

/**
 * The PDF with every page's marks drawn into it. `fontBytes` is the TrueType font notes are written in. Pages without
 * marks are left as they are. Throws a Vietnamese sentence the viewer shows as is.
 */
export async function writeMarkedPdf(bytes: Uint8Array, pages: readonly MarkedPage[], fontBytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const missing = missingCharacters(fontBytes, pages);
  if (missing.length > 0) throw new Error(`Phông chữ ghi chú chưa có các ký tự: ${missing.join(' ')}. Bỏ chúng đi rồi lưu lại.`);
  const document = await openForMarkup(bytes);
  const hasNotes = pages.some(page => page.marks.some(mark => mark.kind === 'text'));
  let font: PDFFont | undefined;
  if (hasNotes) {
    document.registerFontkit(fontkit);
    font = await document.embedFont(fontBytes, { subset: true });
  }
  const pageCount = document.getPageCount();
  for (const marked of pages) {
    if (marked.marks.length === 0) continue;
    if (marked.page < 1 || marked.page > pageCount) throw new Error('Trang được đánh dấu không có trong PDF này.');
    drawPage(document, document.getPage(marked.page - 1), marked, font);
  }
  const saved = await document.save();
  return new Uint8Array(saved);
}

/** Draws one page's marks, in its layout's coordinates, inside their own graphics state. */
function drawPage(document: PDFDocument, page: PDFPage, marked: MarkedPage, font: PDFFont | undefined) {
  const operators: PDFOperator[] = [pushGraphicsState()];
  const layoutToPage = invert(marked.transform);
  operators.push(concatTransformationMatrix(...layoutToPage));
  operators.push(setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
  let highlighterState: PDFName | undefined;
  let fontKey: PDFName | undefined;
  for (const mark of marked.marks) {
    if (isStroke(mark)) {
      if (mark.kind === 'highlighter' && !highlighterState) {
        const state = document.context.obj({ Type: 'ExtGState', CA: PDFNumber.of(HIGHLIGHTER_OPACITY) });
        highlighterState = page.node.newExtGState('GS', document.context.register(state));
      }
      operators.push(...strokeOperators(mark, highlighterState));
    } else if (isShape(mark)) {
      operators.push(...shapeOperators(mark));
    } else {
      if (!font) throw new Error('Không nạp được phông chữ cho ghi chú.');
      if (!fontKey) fontKey = page.node.newFontDictionary(font.name, font.ref);
      operators.push(...noteOperators(mark, font, fontKey));
    }
  }
  operators.push(popGraphicsState());
  page.pushOperators(...operators);
}

/** The inverse of an affine transform: from a page's layout back to PDF user space. */
export function invert(transform: PageTransform): PageTransform {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (determinant === 0) throw new Error('Trang này có kích thước không hợp lệ.');
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

/** `#rrggbb` or `#rgb` as the 0 to 1 components a PDF colour operator takes. */
export function colorComponents(color: string): [number, number, number] {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  const parts = long ? [long[1], long[2], long[3]] : short ? [short[1] + short[1], short[2] + short[2], short[3] + short[3]] : undefined;
  if (!parts) throw new Error(`Màu ${color} không lưu được vào PDF.`);
  const [red, green, blue] = parts.map(part => Number.parseInt(part, 16) / 255);
  return [red, green, blue];
}

/** A pen or highlighter line, smoothed through the midpoints of its samples as the canvas draws it. */
function strokeOperators(mark: StrokeMark, highlighterState: PDFName | undefined): PDFOperator[] {
  const [first, ...rest] = mark.points;
  if (!first) return [];
  const highlighter = mark.kind === 'highlighter';
  const operators: PDFOperator[] = [pushGraphicsState()];
  if (highlighter && highlighterState) operators.push(setGraphicsState(highlighterState));
  operators.push(setStrokingRgbColor(...colorComponents(mark.color)));
  operators.push(setLineWidth(highlighter ? mark.width * HIGHLIGHTER_WIDTH_FACTOR : mark.width));
  operators.push(moveTo(first.x, first.y));
  // A click without a drag is a dot: a very short line with round ends.
  if (rest.length === 0) operators.push(lineTo(first.x + 0.01, first.y));
  let current = first;
  for (let index = 0; index < rest.length; index += 1) {
    const control = rest[index];
    const next = rest[index + 1];
    if (!next) {
      operators.push(lineTo(control.x, control.y));
      break;
    }
    const end = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    operators.push(quadraticCurve(current, control, end));
    current = end;
  }
  operators.push(stroke(), popGraphicsState());
  return operators;
}

/** A quadratic curve as the cubic Bézier a PDF path takes: both control points two thirds of the way to the quadratic one. */
function quadraticCurve(start: Point, control: Point, end: Point): PDFOperator {
  return appendBezierCurve(
    start.x + (2 / 3) * (control.x - start.x),
    start.y + (2 / 3) * (control.y - start.y),
    end.x + (2 / 3) * (control.x - end.x),
    end.y + (2 / 3) * (control.y - end.y),
    end.x,
    end.y,
  );
}

/** An arrow, a box with rounded corners or an ellipse, as the canvas draws them. */
function shapeOperators(mark: ShapeMark): PDFOperator[] {
  const operators: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingRgbColor(...colorComponents(mark.color)),
    setLineWidth(mark.width),
  ];
  if (mark.kind === 'arrow') {
    const [left, right] = arrowHead(mark.from, mark.to, mark.width);
    operators.push(moveTo(mark.from.x, mark.from.y), lineTo(mark.to.x, mark.to.y));
    operators.push(moveTo(left.x, left.y), lineTo(mark.to.x, mark.to.y), lineTo(right.x, right.y));
  } else if (mark.kind === 'rectangle') {
    const rect = rectFrom(mark.from, mark.to);
    const radius = Math.min(mark.width * 1.5, rect.width / 2, rect.height / 2);
    operators.push(...roundedRectangle(rect.x, rect.y, rect.width, rect.height, radius));
  } else {
    const rect = rectFrom(mark.from, mark.to);
    operators.push(...ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2));
  }
  operators.push(stroke(), popGraphicsState());
  return operators;
}

function roundedRectangle(x: number, y: number, width: number, height: number, radius: number): PDFOperator[] {
  const handle = radius * KAPPA;
  const right = x + width;
  const bottom = y + height;
  return [
    moveTo(x + radius, y),
    lineTo(right - radius, y),
    appendBezierCurve(right - radius + handle, y, right, y + radius - handle, right, y + radius),
    lineTo(right, bottom - radius),
    appendBezierCurve(right, bottom - radius + handle, right - radius + handle, bottom, right - radius, bottom),
    lineTo(x + radius, bottom),
    appendBezierCurve(x + radius - handle, bottom, x, bottom - radius + handle, x, bottom - radius),
    lineTo(x, y + radius),
    appendBezierCurve(x, y + radius - handle, x + radius - handle, y, x + radius, y),
    closePath(),
  ];
}

function ellipse(centerX: number, centerY: number, radiusX: number, radiusY: number): PDFOperator[] {
  const handleX = radiusX * KAPPA;
  const handleY = radiusY * KAPPA;
  return [
    moveTo(centerX + radiusX, centerY),
    appendBezierCurve(centerX + radiusX, centerY + handleY, centerX + handleX, centerY + radiusY, centerX, centerY + radiusY),
    appendBezierCurve(centerX - handleX, centerY + radiusY, centerX - radiusX, centerY + handleY, centerX - radiusX, centerY),
    appendBezierCurve(centerX - radiusX, centerY - handleY, centerX - handleX, centerY - radiusY, centerX, centerY - radiusY),
    appendBezierCurve(centerX + handleX, centerY - radiusY, centerX + radiusX, centerY - handleY, centerX + radiusX, centerY),
    closePath(),
  ];
}

/**
 * A typed note as real text on the page. The layout's y runs down the page, so each line's text matrix flips it back
 * upright; its baseline is where the canvas drew it (`noteLines`).
 */
function noteOperators(mark: TextMark, font: PDFFont, fontKey: PDFName): PDFOperator[] {
  const operators: PDFOperator[] = [pushGraphicsState(), setFillingRgbColor(...colorComponents(mark.color))];
  const note = { ...mark, text: mark.text.normalize('NFC') };
  for (const line of noteLines(note)) {
    if (!line.text) continue;
    operators.push(
      beginText(),
      setFontAndSize(fontKey, mark.size),
      setTextMatrix(1, 0, 0, -1, mark.at.x, line.baseline),
      showText(font.encodeText(line.text)),
      endText(),
    );
  }
  operators.push(popGraphicsState());
  return operators;
}
