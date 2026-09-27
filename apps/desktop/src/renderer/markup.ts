/**
 * The model behind marking up a picture in the viewer (COD-280): the marks drawn on it, the crop, undo and redo, and
 * how both are painted. Every coordinate is in the picture's own pixels, so the same marks paint the screen at any
 * zoom and the saved PNG at full size. Nothing here touches the DOM beyond a canvas context handed in. A PDF page uses
 * the same marks in page units (COD-302, `pdfMarkup.ts`).
 */

export type MarkupTool = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'crop';
export type StrokeLevel = 'thin' | 'medium' | 'thick';
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export type StrokeMark = { kind: 'pen' | 'highlighter'; points: Point[]; color: string; width: number };
export type ShapeMark = { kind: 'arrow' | 'rectangle' | 'ellipse'; from: Point; to: Point; color: string; width: number };
/**
 * A label. `at` is its top-left corner. A `plain` label is a note typed on a PDF page (COD-302): no halo, and its first
 * line sits on the baseline the saved PDF's text uses, `NOTE_ASCENT` of the size below `at`, so the page on screen and
 * the saved page agree.
 */
export type TextMark = { kind: 'text'; at: Point; text: string; color: string; size: number; plain?: boolean };
export type Mark = StrokeMark | ShapeMark | TextMark;

/** Everything drawn on one picture. `crop` is kept apart from the marks, so a crop never cuts a mark. */
export type Markup = { marks: Mark[]; crop?: Rect };
/** Undo and redo over any kind of markup: one picture's, or a whole PDF's pages. */
export type History<Value> = { past: Value[]; present: Value; future: Value[] };
export type MarkupHistory = History<Markup>;

/**
 * How far a note's baseline sits below its top, as a share of its size: the ascender of Inter, the face the canvas
 * draws notes in and the PDF embeds (2048 units per em, ascender 1984).
 */
export const NOTE_ASCENT = 1984 / 2048;
/** Lines of a label sit this many sizes apart. */
const LINE_HEIGHT = 1.25;

/** How many steps undo reaches back. */
const HISTORY_DEPTH = 200;
/** A crop smaller than this on either side is taken as a click and clears the crop. */
const MINIMUM_CROP = 8;
/** A highlighter is this much wider than a pen of the same level, and this transparent. */
const HIGHLIGHTER_WIDTH_FACTOR = 4;
const HIGHLIGHTER_OPACITY = 0.35;

export const emptyMarkup: Markup = { marks: [] };
export const startHistory = (): MarkupHistory => ({ past: [], present: emptyMarkup, future: [] });

/** Makes `next` the current markup; what was current can be undone back to, and what was undone is dropped. */
export function commit<Value>(history: History<Value>, next: Value): History<Value> {
  const past = [...history.past, history.present].slice(-HISTORY_DEPTH);
  return { past, present: next, future: [] };
}

export function undo<Value>(history: History<Value>): History<Value> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo<Value>(history: History<Value>): History<Value> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** Whether the markup differs from the untouched picture: something drawn or a crop set. */
export function isChanged(markup: Markup): boolean {
  return markup.marks.length > 0 || markup.crop !== undefined;
}

/** The rectangle two corners span, whichever way the pointer was dragged. */
export function rectFrom(first: Point, second: Point): Rect {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

/**
 * A crop dragged from `first` to `second`, kept inside the picture and on whole pixels, or undefined when it is too
 * small to mean anything (a click), which clears the crop.
 */
export function cropFrom(first: Point, second: Point, size: Size): Rect | undefined {
  const left = clamp(Math.round(Math.min(first.x, second.x)), 0, size.width);
  const top = clamp(Math.round(Math.min(first.y, second.y)), 0, size.height);
  const right = clamp(Math.round(Math.max(first.x, second.x)), 0, size.width);
  const bottom = clamp(Math.round(Math.max(first.y, second.y)), 0, size.height);
  if (right - left < MINIMUM_CROP || bottom - top < MINIMUM_CROP) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The part of the picture the saved PNG holds: the crop, or all of it. Always whole pixels. */
export function exportFrame(size: Size, crop?: Rect): Rect {
  if (!crop) return { x: 0, y: 0, width: size.width, height: size.height };
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * A stroke width in picture pixels. Marks are sized to the picture, not the screen, so a line on a 4000-pixel photo is
 * as visible as the same line on a small screenshot.
 */
export function strokeWidth(level: StrokeLevel, size: Size): number {
  const base = level === 'thin' ? 2 : level === 'medium' ? 4 : 8;
  return base * pictureScale(size);
}

/** The text size for a label at a stroke level, in picture pixels. */
export function textSize(level: StrokeLevel, size: Size): number {
  const base = level === 'thin' ? 16 : level === 'medium' ? 24 : 36;
  return base * pictureScale(size);
}

function pictureScale(size: Size): number {
  return Math.max(1, Math.max(size.width, size.height) / 1000);
}

/** The two ends of an arrow's head: short strokes back from the tip, 28 degrees either side of the shaft. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(10, width * 4);
  const spread = (28 * Math.PI) / 180;
  return [
    { x: to.x - length * Math.cos(angle - spread), y: to.y - length * Math.sin(angle - spread) },
    { x: to.x - length * Math.cos(angle + spread), y: to.y - length * Math.sin(angle + spread) },
  ];
}

/** Adds a point to a stroke being drawn, skipping one too close to the last to change the line. */
export function extendStroke(mark: StrokeMark, point: Point, minimumStep: number): StrokeMark {
  const last = mark.points.at(-1);
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumStep) return mark;
  return { ...mark, points: [...mark.points, point] };
}

/** Whether a colour is light enough that its text needs a dark halo rather than a white one. */
function isLight(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return false;
  const value = Number.parseInt(hex[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 170;
}

/** The label font: the interface face, heavy enough to read over a photo. */
export function labelFont(size: number): string {
  return `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
}

export function isStroke(mark: Mark): mark is StrokeMark {
  return mark.kind === 'pen' || mark.kind === 'highlighter';
}

export function isShape(mark: Mark): mark is ShapeMark {
  return mark.kind === 'arrow' || mark.kind === 'rectangle' || mark.kind === 'ellipse';
}

/** Paints one mark. Lines are round-ended; a pen stroke is smoothed through the midpoints of its samples. */
export function drawMark(context: CanvasRenderingContext2D, mark: Mark) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (isStroke(mark)) drawStroke(context, mark);
  else if (isShape(mark)) drawShape(context, mark);
  else drawText(context, mark);
  context.restore();
}

function drawStroke(context: CanvasRenderingContext2D, mark: StrokeMark) {
  const highlighter = mark.kind === 'highlighter';
  context.strokeStyle = mark.color;
  context.lineWidth = highlighter ? mark.width * HIGHLIGHTER_WIDTH_FACTOR : mark.width;
  if (highlighter) context.globalAlpha = HIGHLIGHTER_OPACITY;
  const [first, ...rest] = mark.points;
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  if (rest.length === 0) context.lineTo(first.x + 0.01, first.y);
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    const next = rest[index + 1];
    if (!next) { context.lineTo(current.x, current.y); break; }
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  context.stroke();
}

function drawShape(context: CanvasRenderingContext2D, mark: ShapeMark) {
  context.strokeStyle = mark.color;
  context.lineWidth = mark.width;
  context.beginPath();
  if (mark.kind === 'arrow') {
    const [left, right] = arrowHead(mark.from, mark.to, mark.width);
    context.moveTo(mark.from.x, mark.from.y);
    context.lineTo(mark.to.x, mark.to.y);
    context.moveTo(left.x, left.y);
    context.lineTo(mark.to.x, mark.to.y);
    context.lineTo(right.x, right.y);
  } else if (mark.kind === 'rectangle') {
    const rect = rectFrom(mark.from, mark.to);
    context.roundRect(rect.x, rect.y, rect.width, rect.height, Math.min(mark.width * 1.5, rect.width / 2, rect.height / 2));
  } else {
    const rect = rectFrom(mark.from, mark.to);
    context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
  }
  context.stroke();
}

function drawText(context: CanvasRenderingContext2D, mark: TextMark) {
  context.font = labelFont(mark.size);
  if (mark.plain) {
    drawNote(context, mark);
    return;
  }
  context.textBaseline = 'top';
  // A soft halo in the opposite tone keeps the label legible over any part of the picture.
  context.lineWidth = Math.max(2, mark.size / 6);
  context.strokeStyle = isLight(mark.color) ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.9)';
  const lines = mark.text.split('\n');
  lines.forEach((line, index) => {
    const y = mark.at.y + index * mark.size * LINE_HEIGHT;
    context.strokeText(line, mark.at.x, y);
    context.fillStyle = mark.color;
    context.fillText(line, mark.at.x, y);
  });
}

/**
 * A note on a PDF page, drawn the way the saved PDF draws it: filled only, on its baseline, without kerning (the PDF
 * places each glyph at its own advance).
 */
function drawNote(context: CanvasRenderingContext2D, mark: TextMark) {
  context.textBaseline = 'alphabetic';
  context.fontKerning = 'none';
  context.fillStyle = mark.color;
  noteLines(mark).forEach(line => context.fillText(line.text, mark.at.x, line.baseline));
}

/** Each line of a note with the y of its baseline, for the screen and the saved PDF alike. */
export function noteLines(mark: TextMark): { text: string; baseline: number }[] {
  return mark.text.split('\n').map((text, index) => ({
    text,
    baseline: mark.at.y + NOTE_ASCENT * mark.size + index * mark.size * LINE_HEIGHT,
  }));
}

/**
 * Paints the picture and its marks into `context`, which is already scaled so one unit is one picture pixel. `frame`
 * shifts the drawing so the frame's corner lands at the origin: the whole picture on screen, the crop in a saved PNG.
 */
export function paintMarkup(context: CanvasRenderingContext2D, picture: CanvasImageSource, size: Size, markup: Markup, frame: Rect = { x: 0, y: 0, ...size }) {
  context.save();
  context.translate(-frame.x, -frame.y);
  context.drawImage(picture, 0, 0, size.width, size.height);
  for (const mark of markup.marks) drawMark(context, mark);
  context.restore();
}
