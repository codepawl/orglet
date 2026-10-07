/**
 * Alignment measurements for `scripts/alignment-check.mjs` (COD-333).
 *
 * Every function here is plain TypeScript with erasable types only: Node imports this file as it is, and the check
 * sends each function's source into the app's window, where `measurePage` runs against the live DOM. The pure
 * functions at the top take rectangles and numbers, so `tests/integration/alignment-rules.test.ts` covers the maths
 * without a browser. Everything is exported because the check sends exactly the exports into the window, where they
 * are declared side by side in one scope and call each other by name; so no function may read unexported state.
 */

export type Box = { left: number; top: number; right: number; bottom: number };

export type FindingKind =
  | 'centre-line' | 'column-start' | 'icon-slot' | 'uneven-gap' | 'wrap' | 'clip' | 'overflow' | 'heading-action' | 'heading-wrap'
  | 'family-heading' | 'family-edge' | 'family-lead' | 'island-seam' | 'near-miss' | 'baseline' | 'stranded';

export type Finding = {
  kind: FindingKind;
  selector: string;
  text: string;
  message: string;
  offset: number;
  boxes: Box[];
};

/** Differences at or below these are rounding, not a slip. */
export type Tolerances = { centre: number; column: number; gap: number };

export const DEFAULT_TOLERANCES: Tolerances = { centre: 1, column: 1, gap: 2 };

/** A gap this much larger than its siblings' is a deliberate push (an auto margin), not an uneven gap. */
export const DELIBERATE_GAP_EXTRA = 24;

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function verticalCentre(box: Box): number {
  return (box.top + box.bottom) / 2;
}

export function horizontalCentre(box: Box): number {
  return (box.left + box.right) / 2;
}

export function boxWidth(box: Box): number {
  return box.right - box.left;
}

export function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map(box => box.left)),
    top: Math.min(...boxes.map(box => box.top)),
    right: Math.max(...boxes.map(box => box.right)),
    bottom: Math.max(...boxes.map(box => box.bottom)),
  };
}

export function overlapsVertically(first: Box, second: Box): boolean {
  return first.top < second.bottom && second.top < first.bottom;
}

/**
 * Groups the client rectangles of a text run into lines: rectangles whose vertical centres sit within half the
 * shorter one's height of each other share a line. Returns the lines top to bottom.
 */
export function groupLines(rectangles: Box[]): Box[] {
  const lines: Box[] = [];
  const sorted = rectangles
    .filter(rectangle => rectangle.right > rectangle.left && rectangle.bottom > rectangle.top)
    .sort((first, second) => first.top - second.top);
  for (const rectangle of sorted) {
    const line = lines.find(candidate => {
      const shorter = Math.min(candidate.bottom - candidate.top, rectangle.bottom - rectangle.top);
      return Math.abs(verticalCentre(candidate) - verticalCentre(rectangle)) <= shorter / 2;
    });
    if (line) Object.assign(line, union([line, rectangle]));
    else lines.push({ ...rectangle });
  }
  return lines;
}

/**
 * How far a mark (icon, avatar, switch, icon button) sits from the text beside it, in pixels, positive when the mark
 * is lower. A mark may line up with the first line of the text, with the whole text block, or, beside a text of two or
 * more lines, with its top edge; the smallest of those differences is the one that counts.
 */
export function centreOffset(mark: Box, firstLine: Box, lines: Box[]): number {
  const block = union([firstLine, ...lines]);
  const candidates = [verticalCentre(mark) - verticalCentre(firstLine), verticalCentre(mark) - verticalCentre(block)];
  if (lines.length > 1) candidates.push(mark.top - block.top);
  return candidates.reduce((smallest, candidate) => Math.abs(candidate) < Math.abs(smallest) ? candidate : smallest);
}

/** Splits values into groups whose members are within `tolerance` of the group's first value. */
export function clusterValues<Item>(items: Item[], valueOf: (item: Item) => number, tolerance: number): Item[][] {
  const clusters: { value: number; members: Item[] }[] = [];
  for (const item of [...items].sort((first, second) => valueOf(first) - valueOf(second))) {
    const cluster = clusters.find(candidate => Math.abs(candidate.value - valueOf(item)) <= tolerance);
    if (cluster) cluster.members.push(item);
    else clusters.push({ value: valueOf(item), members: [item] });
  }
  return clusters.map(cluster => cluster.members);
}

/**
 * The members of one column that disagree with the rest: the value most members share is the reference, and each
 * member further than `tolerance` from it is returned with its offset. A two-member column has no majority, so the
 * second member is measured against the first.
 */
export function outliers<Item>(members: Item[], valueOf: (item: Item) => number, tolerance: number): { item: Item; offset: number }[] {
  if (members.length < 2) return [];
  const counts = new Map<number, number>();
  for (const member of members) {
    const key = Math.round(valueOf(member));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const firstKey = Math.round(valueOf(members[0]));
  let reference = firstKey;
  for (const [key, count] of counts) {
    if (count > (counts.get(reference) ?? 0)) reference = key;
  }
  const referenceMember = members.find(member => Math.round(valueOf(member)) === reference) ?? members[0];
  const referenceValue = valueOf(referenceMember);
  return members
    .map(item => ({ item, offset: valueOf(item) - referenceValue }))
    .filter(entry => Math.abs(entry.offset) > tolerance);
}

/** A step smaller than this between two left edges is not an indent anyone meant; it is two rows that missed each other. */
export const SMALLEST_INDENT = 12;

/**
 * Members that almost share a left edge with the rest: further than `tolerance` from the edge most members start at,
 * but nearer than `indent`. A real indent is at least `indent`, so anything between the two is a slip. With no
 * majority, the member further right is measured against the one further left.
 */
export function nearMisses<Item>(members: Item[], valueOf: (item: Item) => number, tolerance: number, indent = SMALLEST_INDENT): { item: Item; offset: number }[] {
  const clusters = clusterValues(members, valueOf, tolerance);
  if (clusters.length < 2) return [];
  let reference = clusters[0];
  for (const cluster of clusters) {
    if (cluster.length > reference.length) reference = cluster;
  }
  const referenceValue = valueOf(reference[0]);
  return clusters
    .filter(cluster => cluster !== reference)
    .flatMap(cluster => cluster.map(item => ({ item, offset: valueOf(item) - referenceValue })))
    .filter(entry => Math.abs(entry.offset) > tolerance && Math.abs(entry.offset) < indent);
}

/** Gaps between neighbouring boxes along one axis, in the order given. */
export function gapsBetween(boxes: Box[], axis: 'row' | 'column'): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < boxes.length; index++) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    gaps.push(axis === 'row' ? current.left - previous.right : current.top - previous.bottom);
  }
  return gaps;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Indexes of gaps that differ from the group's usual gap by more than `tolerance`. Needs three gaps to know what
 * usual is; a much larger gap is a deliberate push and a negative one an overlap on purpose (stacked faces).
 */
export function unevenGaps(gaps: number[], tolerance: number): number[] {
  if (gaps.length < 3) return [];
  const usual = median(gaps);
  if (usual < 0) return [];
  return gaps
    .map((gap, index) => ({ gap, index }))
    .filter(entry => entry.gap >= 0 && Math.abs(entry.gap - usual) > tolerance && entry.gap < usual + DELIBERATE_GAP_EXTRA)
    .map(entry => entry.index);
}

/** Text cut off at its box's edge with no ellipsis to say so. */
export function isClippedWithoutEllipsis(metrics: { scrollWidth: number; clientWidth: number; overflowX: string; textOverflow: string }): boolean {
  if (metrics.scrollWidth <= metrics.clientWidth + 1) return false;
  if (metrics.overflowX === 'visible') return false;
  return metrics.textOverflow !== 'ellipsis';
}

/** A short label: the kind of text that is meant to sit on one line. */
export function isShortLabel(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && trimmed.split(/\s+/).length <= 5;
}

/**
 * How far the visible end of a heading's last action stops short of the content's right edge: positive when it stops
 * short, negative when it runs past. The visible end of a transparent button is its label, not its box.
 */
export function trailingShortfall(contentRight: number, paintedRight: number): number {
  return round(contentRight - paintedRight);
}

/**
 * Whether a wrapped heading description would keep its next word on the first line if the actions beside it were only
 * as wide as they look: the room is what is left at the end of the first line plus the part of the actions' boxes that
 * shows nothing (a transparent button as wide as a longer label it is not showing).
 */
export function nextWordWouldFit(lineSlack: number, emptyActionWidth: number, nextWordWidth: number): boolean {
  if (emptyActionWidth <= 0) return false;
  return lineSlack + emptyActionWidth >= nextWordWidth;
}

/**
 * What one screen of a family (every Settings tab) measures, relative to its panel's left and top edges, so screens
 * that share a panel can be compared. `leadMark` is the centre of the mark that starts the panel's list rows and
 * `leadText` where their text starts; both are absent on a screen without such rows.
 */
export type ScreenMetrics = {
  headingTop?: number;
  contentLeft: number;
  contentRight: number;
  leadMark?: number;
  leadText?: number;
  /** Absolute boxes for the outlines: the heading's first line, the content box, the first lead row's mark and text. */
  headingBox?: Box;
  contentBox: Box;
  leadBoxes?: Box[];
};

export type FamilyFinding = { kind: FindingKind; screen: string; message: string; offset: number; boxes: Box[] };

/**
 * The screens of one family that disagree with the rest on the heading's top, the content's left and right edges, or
 * the lead column of list rows. Each value is compared the way a column is: the value most screens share is the
 * reference.
 */
export function familyFindings(screens: { screen: string; metrics: ScreenMetrics }[], tolerance: number): FamilyFinding[] {
  const findings: FamilyFinding[] = [];
  const compare = (kind: FindingKind, valueOf: (metrics: ScreenMetrics) => number | undefined, describeOffset: (offset: number) => string, boxesOf: (metrics: ScreenMetrics) => Box[]) => {
    const measured = screens.filter(entry => valueOf(entry.metrics) !== undefined);
    for (const { item, offset } of outliers(measured, entry => valueOf(entry.metrics) as number, tolerance)) {
      findings.push({ kind, screen: item.screen, message: describeOffset(round(offset)), offset: round(offset), boxes: boxesOf(item.metrics) });
    }
  };
  const side = (offset: number, positive: string, negative: string) => `${Math.abs(offset)}px ${offset > 0 ? positive : negative}`;
  compare('family-heading', metrics => metrics.headingTop,
    offset => `heading starts ${side(offset, 'lower', 'higher')} than on the other screens of its family`,
    metrics => metrics.headingBox ? [metrics.headingBox] : []);
  compare('family-edge', metrics => metrics.contentLeft,
    offset => `content starts ${side(offset, 'right', 'left')} of the other screens of its family`,
    metrics => [metrics.contentBox]);
  compare('family-edge', metrics => metrics.contentRight,
    offset => `content ends ${side(offset, 'right', 'left')} of the other screens of its family`,
    metrics => [metrics.contentBox]);
  compare('family-lead', metrics => metrics.leadMark,
    offset => `list rows centre their leading mark ${side(offset, 'right', 'left')} of the other screens of its family`,
    metrics => metrics.leadBoxes ?? []);
  compare('family-lead', metrics => metrics.leadText,
    offset => `list rows start their text ${side(offset, 'right', 'left')} of the other screens of its family`,
    metrics => metrics.leadBoxes ?? []);
  return findings;
}

/** Letters a whole pixel off their neighbours' line already read as uneven, so baselines get half the centre tolerance. */
export const BASELINE_TOLERANCE = 0.5;

/**
 * Pieces of text side by side on one line read as one line only when their letters stand on the same baseline. Each
 * piece is measured against the first (the row's lead, usually a name), and returned with how far it sits below it
 * when that is more than the tolerance. Centring text of two sizes left the smaller ones a pixel above the name's
 * line (user, 2026-10-07: a chat header's connection and time next to the orglet's name).
 */
export function baselineOffsets(baselines: number[], tolerance: number): { index: number; offset: number }[] {
  if (baselines.length < 2) return [];
  const lead = baselines[0];
  return baselines.flatMap((baseline, index) => {
    const offset = round(baseline - lead);
    return index > 0 && Math.abs(offset) > tolerance ? [{ index, offset }] : [];
  });
}

/** How far past the nearest text's end a picture-only piece may sit before it reads as left behind on its own. */
export const STRANDED_GAP = 64;

/**
 * How far a picture-only piece (a row of read faces, a lone icon) sits to the right of the text above it: the gap from
 * the end of the widest of those lines to its left edge, or undefined when there is no text above or it is within
 * `STRANDED_GAP`. A face pushed to the end of an 80-character box under a one-line message floated in empty space
 * (user, 2026-10-07).
 */
export function strandedGap(piece: Box, linesAbove: Box[]): number | undefined {
  if (linesAbove.length === 0) return undefined;
  const textEnd = Math.max(...linesAbove.map(line => line.right));
  const gap = round(piece.left - textEnd);
  return gap > STRANDED_GAP ? gap : undefined;
}

/* ---------- In the window: reading the DOM ---------- */

export const MARK_TAGS = ['svg', 'img', 'canvas', 'video'];
export const SINGLE_LINE_SELECTOR = 'button, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=switch], .badge, h1, h2, h3, h4, th, label';
export const LIST_SELECTOR = 'ul, ol, menu, [role=list], [role=menu], [role=listbox], [role=tablist], [role=radiogroup], [role=tree]';

export function toBox(rectangle: DOMRect | Box): Box {
  return { left: round(rectangle.left), top: round(rectangle.top), right: round(rectangle.right), bottom: round(rectangle.bottom) };
}

/** Whether `kind` is switched off for this element by a `data-align-ignore` on it or an ancestor. */
export function ignoredFor(element: Element, kind: FindingKind): boolean {
  const opted = element.closest('[data-align-ignore]');
  if (!opted) return false;
  const value = opted.getAttribute('data-align-ignore')?.trim() ?? '';
  return value === '' || value.split(/\s+/).includes(kind);
}

export function isRendered(element: Element): boolean {
  const rectangle = element.getBoundingClientRect();
  // Under 2px is a visually hidden label for screen readers, not something on screen.
  if (rectangle.width < 2 || rectangle.height < 2) return false;
  if (rectangle.bottom <= 0 || rectangle.top >= innerHeight || rectangle.right <= 0 || rectangle.left >= innerWidth) return false;
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

/** Decorative duplicates (the composer's highlight layer, a hidden measuring copy) are skipped as text. */
export function inHiddenLayer(element: Element): boolean {
  const hidden = element.closest('[aria-hidden="true"]');
  if (!hidden) return false;
  return !isMark(hidden);
}

export function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim();
}

/**
 * A mark is anything drawn beside text rather than read: an icon, an avatar, a status dot, a switch, an icon-only
 * button. Small, roughly square boxes with at most a couple of letters count too (a crew's letter avatar, the
 * Orglet mark).
 */
export function isMark(element: Element): boolean {
  if (MARK_TAGS.includes(element.tagName.toLowerCase())) return true;
  if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') return false;
  if (element.matches('.avatar, [role=img], [role=switch], .org-switch')) return true;
  if (element.matches('input, textarea, select')) return false;
  const rectangle = element.getBoundingClientRect();
  if (rectangle.width < 6 || rectangle.height < 6 || rectangle.width > 44 || rectangle.height > 44) return false;
  const ratio = rectangle.width / rectangle.height;
  if (ratio < 0.5 || ratio > 2.2) return false;
  return (element.textContent ?? '').trim().length <= 2;
}

/** A readable selector: up to four levels of tag, id or classes, and an accessible name where there is one. */
export function describe(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 4) {
    let part = current.tagName.toLowerCase();
    if (current.id) part += `#${current.id}`;
    const classes = [...current.classList].filter(name => !name.startsWith('lucide')).slice(0, 2);
    if (classes.length > 0) part += `.${classes.join('.')}`;
    const name = current.getAttribute('aria-label');
    if (name) part += `[aria-label="${name.slice(0, 40)}"]`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function snippet(element: Element): string {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  return element.getAttribute('aria-label')?.slice(0, 60) ?? '';
}

/** Visible, non-empty text nodes under `element`, in document order, skipping decorative layers. */
export function textNodesIn(element: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !(node.textContent ?? '').trim()) continue;
    if (parent.closest('svg, script, style') || inHiddenLayer(parent)) continue;
    if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    nodes.push(node as Text);
  }
  return nodes;
}

export function textLines(node: Text): Box[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  return groupLines([...range.getClientRects()].map(toBox));
}

/** The lines of the first text inside `element`, then every line of all its text for the block. */
export function textShape(element: Element): { first: Box[]; all: Box[] } | undefined {
  const nodes = textNodesIn(element);
  if (nodes.length === 0) return undefined;
  const first = textLines(nodes[0]);
  const all = groupLines(nodes.flatMap(node => textLines(node)));
  if (first.length === 0) return undefined;
  return { first, all };
}

export function isFlexRow(style: CSSStyleDeclaration): boolean {
  return (style.display === 'flex' || style.display === 'inline-flex') && style.flexDirection.startsWith('row');
}

export function inFlowChildren(element: Element): Element[] {
  return [...element.children].filter(child => {
    const position = getComputedStyle(child).position;
    return position !== 'absolute' && position !== 'fixed' && isRendered(child);
  });
}

/** Marks in a flex row against the text next to them. */
export function checkCentreLines(row: Element, tolerances: Tolerances): Finding[] {
  if (ignoredFor(row, 'centre-line') || inHiddenLayer(row)) return [];
  const children = inFlowChildren(row);
  const texts = children.filter(child => !isMark(child) && textNodesIn(child).length > 0);
  const hasOwnText = ownText(row).length > 0;
  if (texts.length === 0 && !hasOwnText) return [];
  const findings: Finding[] = [];
  for (const mark of children.filter(isMark)) {
    if (ignoredFor(mark, 'centre-line')) continue;
    const markBox = toBox(mark.getBoundingClientRect());
    const index = children.indexOf(mark);
    const neighbour = children.slice(index + 1).find(child => texts.includes(child)) ?? children.slice(0, index).reverse().find(child => texts.includes(child));
    const shape = neighbour ? textShape(neighbour) : ownTextShape(row);
    if (!shape || !shape.all.some(line => overlapsVertically(line, markBox))) continue;
    const offset = round(centreOffset(markBox, shape.first[0], shape.all));
    if (Math.abs(offset) <= tolerances.centre) continue;
    findings.push({
      kind: 'centre-line',
      selector: describe(mark),
      text: snippet(neighbour ?? row),
      message: `mark centre is ${offset > 0 ? 'below' : 'above'} the text centre by ${Math.abs(offset)}px`,
      offset,
      boxes: [markBox, union(shape.all)],
    });
  }
  return findings;
}

/** Whether the element is one piece of plain text: only inline content, at least some text, and on one line. */
export function isPlainTextPiece(element: Element): boolean {
  if (isMark(element) || element.matches('button, input, select, textarea, [role=button]')) return false;
  const display = getComputedStyle(element).display;
  if (display.includes('flex') || display.includes('grid')) return false;
  if ([...element.querySelectorAll('*')].some(child => getComputedStyle(child).display !== 'inline' || isMark(child))) return false;
  const shape = textShape(element);
  return shape !== undefined && shape.all.length === 1;
}

/** Where the element's letters stand: a zero-size probe at the end of its text sits on its baseline. */
export function baselineOf(element: Element): number {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
  element.append(probe);
  const baseline = probe.getBoundingClientRect().top;
  probe.remove();
  return baseline;
}

/** Pieces of text side by side in a flex row, each against the first one's baseline. */
export function checkBaselines(row: Element, tolerances: Tolerances): Finding[] {
  if (ignoredFor(row, 'baseline') || inHiddenLayer(row)) return [];
  const pieces = inFlowChildren(row).filter(isPlainTextPiece);
  if (pieces.length < 2) return [];
  // Only pieces on the same line: a row that wraps measures each line on its own terms elsewhere.
  const lead = toBox(pieces[0].getBoundingClientRect());
  const sameLine = pieces.filter(piece => overlapsVertically(toBox(piece.getBoundingClientRect()), lead));
  return baselineOffsets(sameLine.map(baselineOf), Math.min(tolerances.centre, BASELINE_TOLERANCE)).map(({ index, offset }) => ({
    kind: 'baseline',
    selector: describe(sameLine[index]),
    text: snippet(sameLine[index]),
    message: `text stands ${offset > 0 ? 'below' : 'above'} the baseline of "${snippet(sameLine[0])}" by ${Math.abs(offset)}px`,
    offset,
    boxes: [toBox(sameLine[index].getBoundingClientRect()), lead],
  }));
}

/** A chat turn: what a person said and the answers under it, read top to bottom as one column. */
export const TURN_SELECTOR = '.chat-turn';

/**
 * Picture-only pieces in a turn (the outermost element with a mark and no text) that sit far to the right of every line
 * of text above them in the same turn.
 */
export function checkStranded(turn: Element): Finding[] {
  if (ignoredFor(turn, 'stranded')) return [];
  const textLinesInTurn = textNodesIn(turn).flatMap(textLines);
  const findings: Finding[] = [];
  for (const element of turn.querySelectorAll('*')) {
    if (isMark(element) || element.closest('svg') || !isRendered(element) || ignoredFor(element, 'stranded')) continue;
    if ((element.textContent ?? '').trim() !== '' || !element.querySelector(MARK_TAGS.join(','))) continue;
    if (element.matches('button, [role=button]') || element.closest('button, [role=button], .message-gutter, .message-actions')) continue;
    // Only the outermost such wrapper: its parent carries text or is the turn.
    const parent = element.parentElement;
    if (parent && parent !== turn && (parent.textContent ?? '').trim() === '') continue;
    // The pictures themselves: a wrapper may stretch across the column with them pushed to its end.
    const piece = union([...element.querySelectorAll(MARK_TAGS.join(','))].filter(isRendered).map(mark => toBox(mark.getBoundingClientRect())));
    const gap = strandedGap(piece, textLinesInTurn.filter(line => line.bottom <= piece.top + 1));
    if (gap === undefined) continue;
    findings.push({ kind: 'stranded', selector: describe(element), text: snippet(element.querySelector('[aria-label]') ?? element), message: `sits alone ${gap}px past the end of the text above it`, offset: gap, boxes: [piece] });
  }
  return findings;
}

/** The text written straight into a row (a button's label beside its icon), shaped like `textShape`. */
export function ownTextShape(element: Element): { first: Box[]; all: Box[] } | undefined {
  const nodes = [...element.childNodes].filter((node): node is Text => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
  if (nodes.length === 0) return undefined;
  const first = textLines(nodes[0]);
  if (first.length === 0) return undefined;
  return { first, all: groupLines(nodes.flatMap(node => textLines(node))) };
}

export type LeadingParts = { textStart: number; mark?: Box; textBox: Box; faces: number };

/**
 * The first text in an item and the mark in front of it on the same line, if any. `faces` counts the avatars in
 * front of the text: a crew's stacked faces are a wider shape than one face or icon by design, so they are compared
 * only with other stacks.
 */
export function leadingParts(item: Element): LeadingParts | undefined {
  const nodes = textNodesIn(item);
  if (nodes.length === 0) return undefined;
  const lines = textLines(nodes[0]);
  if (lines.length === 0) return undefined;
  const textBox = lines[0];
  let mark: Box | undefined;
  let faces = 0;
  for (const candidate of item.querySelectorAll('*')) {
    if (candidate.compareDocumentPosition(nodes[0]) & Node.DOCUMENT_POSITION_PRECEDING) break;
    if (!isRendered(candidate)) continue;
    if (candidate.matches('.avatar')) faces += 1;
    if (mark || !isMark(candidate)) continue;
    const box = toBox(candidate.getBoundingClientRect());
    if (box.right <= textBox.left + 1 && overlapsVertically(box, textBox)) mark = box;
  }
  return { textStart: textBox.left, mark, textBox, faces };
}

export function kindOf(element: Element): string {
  return `${element.tagName}.${element.classList[0] ?? ''}[${element.getAttribute('role') ?? ''}]`;
}

export type ColumnItem = { element: Element; group: string; left: number; parts: LeadingParts };

export function leadingShape(parts: LeadingParts): string {
  if (!parts.mark) return 'text';
  return parts.faces > 1 ? 'faces' : 'mark';
}

/**
 * The items of one list, grid or stacked column, keyed so that items of the same kind in containers of the same kind
 * are compared together: the meta grids of three schedule cards form one set of columns, as they do on screen.
 */
export function columnItems(container: Element): ColumnItem[] {
  if (inHiddenLayer(container)) return [];
  const items: ColumnItem[] = [];
  for (const element of inFlowChildren(container)) {
    const parts = leadingParts(element);
    if (!parts) continue;
    const group = `${kindOf(container)}>${kindOf(element)}|${leadingShape(parts)}`;
    items.push({ element, group, left: round(element.getBoundingClientRect().left), parts });
  }
  return items;
}

/** Items of one kind stacked in one column should start their text, and centre their marks, at the same x. */
export function checkColumns(items: ColumnItem[], tolerances: Tolerances): Finding[] {
  const findings: Finding[] = [];
  const byGroup = new Map<string, ColumnItem[]>();
  for (const item of items) byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
  for (const group of byGroup.values()) {
    for (const column of clusterValues(group, item => item.left, tolerances.column)) {
      findings.push(...columnStartFindings(column, tolerances));
      findings.push(...iconSlotFindings(column, tolerances));
    }
  }
  return findings;
}

export function columnStartFindings(column: ColumnItem[], tolerances: Tolerances): Finding[] {
  const measured = column.filter(item => !ignoredFor(item.element, 'column-start'));
  return outliers(measured, item => item.parts.textStart, tolerances.column).map(({ item, offset }) => ({
    kind: 'column-start' as const,
    selector: describe(item.element),
    text: snippet(item.element),
    message: `text starts ${round(Math.abs(offset))}px ${offset > 0 ? 'right' : 'left'} of the other items in its column`,
    offset: round(offset),
    boxes: [item.parts.textBox, ...(item.parts.mark ? [item.parts.mark] : [])],
  }));
}

export function iconSlotFindings(column: ColumnItem[], tolerances: Tolerances): Finding[] {
  const marked = column.filter(item => item.parts.mark && !ignoredFor(item.element, 'icon-slot'));
  return outliers(marked, item => horizontalCentre(item.parts.mark as Box), tolerances.column).map(({ item, offset }) => {
    const mark = item.parts.mark as Box;
    return {
      kind: 'icon-slot' as const,
      selector: describe(item.element),
      text: snippet(item.element),
      message: `mark (${round(boxWidth(mark))}px wide) is centred ${round(Math.abs(offset))}px ${offset > 0 ? 'right' : 'left'} of the other marks in its column`,
      offset: round(offset),
      boxes: [mark],
    };
  });
}


/** One block a person reads top to bottom: a message, a card, a page's body. Rows in it are compared across containers. */
export const READING_BLOCK_SELECTOR = '.message-main, .page-body, .org-drawer-scroll, .details-pane, [data-align-block]';
/** A row that opens something or names a step: it leads with a mark, and the marks of such rows form one edge. */
export const LED_ROW_SELECTOR = 'summary, .activity-summary, .team-job-line';

/**
 * Rows led by a mark anywhere in one reading block start their marks on one edge, or a clear indent apart. The
 * column check compares only the children of one container, so two rows from different components stacked in one
 * message (a crew job above the trace) could sit 4px apart and pass (user, 2026-10-04).
 */
export function checkNearMisses(block: Element, tolerances: Tolerances): Finding[] {
  const rows: { element: Element; mark: Box }[] = [];
  for (const element of block.querySelectorAll(LED_ROW_SELECTOR)) {
    if (!isRendered(element) || inHiddenLayer(element) || ignoredFor(element, 'near-miss')) continue;
    if (element.closest(READING_BLOCK_SELECTOR) !== block) continue;
    const mark = leadingParts(element)?.mark;
    if (mark) rows.push({ element, mark });
  }
  return nearMisses(rows, row => row.mark.left, tolerances.column).map(({ item, offset }) => ({
    kind: 'near-miss' as const,
    selector: describe(item.element),
    text: snippet(item.element),
    message: `mark starts ${round(Math.abs(offset))}px ${offset > 0 ? 'right' : 'left'} of the other rows' marks in this block; line them up or indent by at least ${SMALLEST_INDENT}px`,
    offset: round(offset),
    boxes: [item.mark],
  }));
}

/** Siblings of one kind in a flex row or column should sit the same distance apart. */
export function checkGaps(container: Element, tolerances: Tolerances): Finding[] {
  if (ignoredFor(container, 'uneven-gap') || inHiddenLayer(container)) return [];
  const style = getComputedStyle(container);
  const axis = style.flexDirection.startsWith('row') ? 'row' : 'column';
  const children = inFlowChildren(container);
  const findings: Finding[] = [];
  const runs: Element[][] = [];
  for (const child of children) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    const sameLine = previous && (axis === 'column' || overlapsVertically(toBox(previous.getBoundingClientRect()), toBox(child.getBoundingClientRect())));
    if (run && previous && kindOf(previous) === kindOf(child) && sameLine) run.push(child);
    else runs.push([child]);
  }
  for (const run of runs) {
    const boxes = run.map(child => toBox(child.getBoundingClientRect()));
    const gaps = gapsBetween(boxes, axis);
    const usual = gaps.length >= 3 ? median(gaps) : 0;
    for (const index of unevenGaps(gaps, tolerances.gap)) {
      findings.push({
        kind: 'uneven-gap',
        selector: describe(run[index + 1]),
        text: snippet(run[index + 1]),
        message: `gap before this item is ${round(gaps[index])}px where its siblings use ${round(usual)}px`,
        offset: round(gaps[index] - usual),
        boxes: [boxes[index], boxes[index + 1]],
      });
    }
  }
  return findings;
}

/** Short labels that wrap onto a second line, and single-line text cut off with no ellipsis. */
export function checkSingleLine(element: Element): Finding[] {
  if (inHiddenLayer(element)) return [];
  const findings: Finding[] = [];
  const style = getComputedStyle(element);
  const nowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
  if (nowrap && ownText(element) && !ignoredFor(element, 'clip')) {
    const metrics = { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflowX: style.overflowX, textOverflow: style.textOverflow };
    if (isClippedWithoutEllipsis(metrics)) {
      findings.push({
        kind: 'clip',
        selector: describe(element),
        text: snippet(element),
        message: `one-line text is cut by ${metrics.scrollWidth - metrics.clientWidth}px with no ellipsis`,
        offset: metrics.scrollWidth - metrics.clientWidth,
        boxes: [toBox(element.getBoundingClientRect())],
      });
    }
  }
  if (!element.matches(SINGLE_LINE_SELECTOR) || ignoredFor(element, 'wrap')) return findings;
  for (const node of textNodesIn(element)) {
    if (node.parentElement?.closest(SINGLE_LINE_SELECTOR) !== element) continue;
    if (!isShortLabel(node.textContent ?? '')) continue;
    const lines = textLines(node);
    if (lines.length < 2) continue;
    findings.push({
      kind: 'wrap',
      selector: describe(node.parentElement as Element),
      text: (node.textContent ?? '').trim().slice(0, 60),
      message: `short label wraps onto ${lines.length} lines`,
      offset: lines.length,
      boxes: lines,
    });
  }
  return findings;
}

/** A panel scrolling sideways, or something sticking out past the window's right edge. */
export function checkOverflow(element: Element): Finding[] {
  if (ignoredFor(element, 'overflow') || inHiddenLayer(element)) return [];
  const style = getComputedStyle(element);
  const scrollsSideways = (style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1;
  if (scrollsSideways) {
    return [{
      kind: 'overflow',
      selector: describe(element),
      text: snippet(element),
      message: `scrolls sideways: content is ${element.scrollWidth}px in a ${element.clientWidth}px box`,
      offset: element.scrollWidth - element.clientWidth,
      boxes: [toBox(element.getBoundingClientRect())],
    }];
  }
  const box = element.getBoundingClientRect();
  const leaf = element.children.length === 0 || isMark(element);
  if (!leaf || box.right <= innerWidth + 1) return [];
  // Inside a clipping or scrolling ancestor the part past the edge is hidden or reachable; only a free spill counts.
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.documentElement) {
    if (getComputedStyle(ancestor).overflowX !== 'visible') return [];
    ancestor = ancestor.parentElement;
  }
  return [{
    kind: 'overflow',
    selector: describe(element),
    text: snippet(element),
    message: `sticks out ${round(box.right - innerWidth)}px past the window's right edge`,
    offset: round(box.right - innerWidth),
    boxes: [toBox(box)],
  }];
}

/** A section heading with its title and description on the left and its actions on the right (the kit's `PanelHeading`). */
export const PANEL_HEADING_SELECTOR = '.org-panel-heading';
export const PANEL_HEADING_ACTIONS_SELECTOR = '.org-panel-heading-actions';
/** The panel every screen of a family shares: a tab's panel. */
export const FAMILY_PANEL_SELECTOR = '[role=tabpanel]';

/** Whether a colour string paints anything: not `transparent` and not fully see-through. */
export function paintsColour(colour: string): boolean {
  if (!colour || colour === 'transparent') return false;
  const inside = colour.match(/\(([^)]*)\)/)?.[1];
  if (!inside) return true;
  // The alpha is after a slash (`rgb(0 0 0 / 0)`, `color(srgb 0 0 0 / 0)`) or the fourth comma value (`rgba(0, 0, 0, 0)`).
  const commaValues = inside.split(',');
  const alpha = inside.includes('/') ? inside.split('/').at(-1) : commaValues.length === 4 ? commaValues[3] : undefined;
  if (alpha === undefined) return true;
  return parseFloat(alpha) > 0;
}

/** Whether the element draws a surface of its own: a background, a border or a shadow. */
export function paintsSurface(element: Element): boolean {
  const style = getComputedStyle(element);
  if (paintsColour(style.backgroundColor) || style.backgroundImage !== 'none') return true;
  if (style.boxShadow !== 'none') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some(side => {
    const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
    return width > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' && paintsColour(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
  });
}

/**
 * What the eye reads as the element's extent: its box when it draws a surface, or when it is an icon-only control (a
 * square hit target lines up by its box); otherwise the union of the visible text and marks inside it. A transparent
 * button as wide as a longer label it is not showing reads as its shown label only.
 */
export function paintedBox(element: Element): Box | undefined {
  if (!isRendered(element)) return undefined;
  const box = toBox(element.getBoundingClientRect());
  if (paintsSurface(element) || isMark(element)) return box;
  const parts: Box[] = [];
  for (const node of textNodesIn(element)) parts.push(...textLines(node));
  for (const mark of element.querySelectorAll(MARK_TAGS.join(','))) {
    if (isRendered(mark) && !mark.parentElement?.closest('svg')) parts.push(toBox(mark.getBoundingClientRect()));
  }
  for (const child of element.querySelectorAll('*')) {
    if (child.closest('svg') || !isRendered(child) || !paintsSurface(child)) continue;
    parts.push(toBox(child.getBoundingClientRect()));
  }
  if (parts.length === 0) return textNodesIn(element).length === 0 && element.matches('button, [role=button]') ? box : undefined;
  return union(parts);
}

/** The content box of an element: inside its border, padding and scrollbar. */
export function contentBoxOf(element: Element): Box {
  const rectangle = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const left = rectangle.left + element.clientLeft + parseFloat(style.paddingLeft);
  const top = rectangle.top + element.clientTop + parseFloat(style.paddingTop);
  const right = rectangle.left + element.clientLeft + element.clientWidth - parseFloat(style.paddingRight);
  const bottom = rectangle.top + element.clientTop + element.clientHeight - parseFloat(style.paddingBottom);
  return toBox({ left, top, right, bottom });
}

/** The actions of a panel heading that are on screen, each with the part of it the eye reads. */
export function headingActions(heading: Element): { element: Element; box: Box; painted: Box }[] {
  const group = heading.querySelector(PANEL_HEADING_ACTIONS_SELECTOR);
  if (!group) return [];
  return inFlowChildren(group).flatMap(element => {
    const painted = paintedBox(element);
    return painted ? [{ element, box: toBox(element.getBoundingClientRect()), painted }] : [];
  });
}

/**
 * A panel heading's last action ends where the content it heads ends. Measured on what is painted, so a transparent
 * button whose label stops early reads as shifted left even when its box is flush.
 */
export function checkHeadingAction(heading: Element, tolerances: Tolerances): Finding[] {
  if (ignoredFor(heading, 'heading-action') || !heading.parentElement) return [];
  const actions = headingActions(heading);
  if (actions.length === 0) return [];
  const last = actions.reduce((furthest, action) => action.painted.right > furthest.painted.right ? action : furthest);
  const content = contentBoxOf(heading.parentElement);
  const shortfall = trailingShortfall(content.right, last.painted.right);
  if (Math.abs(shortfall) <= tolerances.column) return [];
  const where = shortfall > 0 ? 'short of' : 'past';
  return [{
    kind: 'heading-action',
    selector: describe(last.element),
    text: snippet(last.element),
    message: `heading action's visible edge ends ${Math.abs(shortfall)}px ${where} the content's right edge${last.painted.right < last.box.right - 1 ? ' (its box is wider than what it shows)' : ''}`,
    offset: shortfall,
    boxes: [last.painted, { left: content.right - 1, top: last.box.top, right: content.right, bottom: last.box.bottom }],
  }];
}

/** The description's words with their boxes, in reading order. */
export function wordBoxes(nodes: Text[]): { word: string; box: Box }[] {
  const words: { word: string; box: Box }[] = [];
  const range = document.createRange();
  for (const node of nodes) {
    const text = node.textContent ?? '';
    for (const match of text.matchAll(/\S+/g)) {
      range.setStart(node, match.index ?? 0);
      range.setEnd(node, (match.index ?? 0) + match[0].length);
      const rectangles = [...range.getClientRects()].filter(rectangle => rectangle.width > 0);
      if (rectangles.length > 0) words.push({ word: match[0], box: toBox(rectangles[0]) });
    }
  }
  return words;
}

/**
 * A heading description that wraps while the actions beside it leave room: its next word would fit on the first line
 * if the actions were only as wide as they look.
 */
export function checkHeadingWrap(heading: Element): Finding[] {
  if (ignoredFor(heading, 'heading-wrap')) return [];
  const actions = headingActions(heading);
  if (actions.length === 0) return [];
  const group = heading.querySelector(PANEL_HEADING_ACTIONS_SELECTOR) as Element;
  const nodes = textNodesIn(heading).filter(node => !node.parentElement?.closest('h1, h2, h3, h4') && !group.contains(node));
  if (nodes.length === 0) return [];
  const lines = groupLines(nodes.flatMap(node => textLines(node)));
  if (lines.length < 2) return [];
  const next = wordBoxes(nodes).find(entry => entry.box.top >= lines[0].bottom - 1);
  if (!next) return [];
  const container = toBox((nodes[0].parentElement as Element).getBoundingClientRect());
  const slack = container.right - lines[0].right;
  const groupBox = toBox(group.getBoundingClientRect());
  const shown = union(actions.map(action => action.painted));
  const empty = round(boxWidth(groupBox) - boxWidth(shown));
  // The word needs a space before it on the line it would join; a third of the text's height is about one.
  const needed = round(boxWidth(next.box) + (lines[0].bottom - lines[0].top) / 3);
  if (!nextWordWouldFit(slack, empty, needed)) return [];
  return [{
    kind: 'heading-wrap',
    selector: describe(nodes[0].parentElement as Element),
    text: snippet(nodes[0].parentElement as Element),
    message: `heading description wraps onto ${lines.length} lines while ${empty}px of the actions beside it show nothing; "${next.word}" (${needed}px) would fit`,
    offset: empty,
    boxes: [lines[0], groupBox],
  }];
}

/** The most common value among `values`, rounded to whole pixels, or undefined for none. */
export function commonValue(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(Math.round(value), (counts.get(Math.round(value)) ?? 0) + 1);
  let best = Math.round(values[0]);
  for (const [value, count] of counts) if (count > (counts.get(best) ?? 0)) best = value;
  return best;
}

/**
 * What a family screen measures for `familyFindings`: the heading's first line, the panel's content box, and the lead
 * column of its list rows (flex rows that start at the content's left edge with a mark followed by text). Undefined
 * when the screen has no family panel.
 */
export function measureFamily(): ScreenMetrics | undefined {
  const panel = [...document.querySelectorAll(FAMILY_PANEL_SELECTOR)].find(isRendered);
  if (!panel) return undefined;
  const panelBox = toBox(panel.getBoundingClientRect());
  const content = contentBoxOf(panel);
  const metrics: ScreenMetrics = { contentLeft: round(content.left - panelBox.left), contentRight: round(content.right - panelBox.left), contentBox: content };
  const heading = [...panel.querySelectorAll('h1, h2, h3')].find(isRendered);
  const headingShape = heading ? textShape(heading) : undefined;
  if (headingShape) {
    metrics.headingBox = headingShape.first[0];
    metrics.headingTop = round(headingShape.first[0].top - panelBox.top);
  }
  const marks: number[] = [];
  const texts: number[] = [];
  for (const row of panel.querySelectorAll('*')) {
    if (row.closest('svg') || !isRendered(row) || ignoredFor(row, 'family-lead')) continue;
    if (!isFlexRow(getComputedStyle(row))) continue;
    const children = inFlowChildren(row);
    if (children.length < 2 || !isMark(children[0])) continue;
    const markBox = toBox(children[0].getBoundingClientRect());
    if (Math.abs(markBox.left - content.left) > 2) continue;
    const shape = textShape(children[1]);
    if (!shape) continue;
    marks.push(horizontalCentre(markBox) - panelBox.left);
    texts.push(shape.first[0].left - panelBox.left);
    if (!metrics.leadBoxes) metrics.leadBoxes = [markBox, shape.first[0]];
  }
  metrics.leadMark = commonValue(marks);
  metrics.leadText = commonValue(texts);
  return metrics;
}

/**
 * One bottom corner of the live island and the prompt bar under it, in CSS pixels as the window lays them out. The
 * corner is the tab's `::before` (left) or `::after` (right).
 */
export type IslandCornerMetrics = {
  side: 'left' | 'right';
  /** The bottom edge of the corner's bottom border, and of the bar's top border. */
  cornerLineBottom: number;
  barLineBottom: number;
  /** The corner's bottom border, the bar's top border, the corner's side border and the tab's side border. */
  cornerLineWidth: number;
  barLineWidth: number;
  cornerSideWidth: number;
  tabSideWidth: number;
  /** The corner's edge against the tab, and the inner edge of the tab's side border it should meet. */
  cornerInnerEdge: number;
  tabPaddingEdge: number;
  /** How far the tab reaches below the bar's top edge. */
  tabReach: number;
};

/**
 * The seam between the live island and the prompt bar (COD-167, COD-228): each corner's bottom border is the bar's
 * top border, with the same bottom edge and width, and its side border is the tab's side border, and the tab reaches
 * past the bar's line so none of it shows under the tab. Chromium rounds a border down to whole device pixels, so equal
 * edges and widths here are what keeps the three lines on the same device pixels at 125% and 150%.
 */
export function islandSeamFindings(corners: IslandCornerMetrics[], tolerance = 0.05): { side: string; message: string; offset: number }[] {
  const findings: { side: string; message: string; offset: number }[] = [];
  for (const corner of corners) {
    const lineOffset = corner.cornerLineBottom - corner.barLineBottom;
    if (Math.abs(lineOffset) > tolerance) findings.push({ side: corner.side, message: `the ${corner.side} corner's line ends ${round(Math.abs(lineOffset))}px ${lineOffset > 0 ? 'below' : 'above'} the bar's top line`, offset: round(lineOffset) });
    if (Math.abs(corner.cornerLineWidth - corner.barLineWidth) > tolerance) findings.push({ side: corner.side, message: `the ${corner.side} corner's line is ${round(corner.cornerLineWidth)}px where the bar's top line is ${round(corner.barLineWidth)}px`, offset: round(corner.cornerLineWidth - corner.barLineWidth) });
    if (Math.abs(corner.cornerSideWidth - corner.tabSideWidth) > tolerance) findings.push({ side: corner.side, message: `the ${corner.side} corner's side is ${round(corner.cornerSideWidth)}px where the tab's side is ${round(corner.tabSideWidth)}px`, offset: round(corner.cornerSideWidth - corner.tabSideWidth) });
    const edgeOffset = corner.cornerInnerEdge - corner.tabPaddingEdge;
    if (Math.abs(edgeOffset) > tolerance) findings.push({ side: corner.side, message: `the ${corner.side} corner meets the tab's side ${round(Math.abs(edgeOffset))}px off its border`, offset: round(edgeOffset) });
    if (corner.tabReach < corner.barLineWidth + 1) findings.push({ side: corner.side, message: `the tab reaches ${round(corner.tabReach)}px into the bar, so the bar's line or its typing ring shows under it`, offset: round(corner.tabReach) });
  }
  return findings;
}

/** Measures the docked island's two corners against the bar, when an island is on screen. */
export function checkIslandSeam(): Finding[] {
  const island = document.querySelector('.live-island:not(.leaving)');
  const bar = island?.parentElement?.querySelector('.composer');
  if (!island || !bar || ignoredFor(island, 'island-seam')) return [];
  const islandBox = island.getBoundingClientRect();
  const islandStyle = getComputedStyle(island);
  const barBox = bar.getBoundingClientRect();
  const barStyle = getComputedStyle(bar);
  const barLineWidth = parseFloat(barStyle.borderTopWidth);
  const paddingLeft = islandBox.left + parseFloat(islandStyle.borderLeftWidth);
  const paddingRight = islandBox.right - parseFloat(islandStyle.borderRightWidth);
  const paddingTop = islandBox.top + parseFloat(islandStyle.borderTopWidth);
  const corners: IslandCornerMetrics[] = (['left', 'right'] as const).map(side => {
    const corner = getComputedStyle(island, side === 'left' ? '::before' : '::after');
    const cornerLineBottom = paddingTop + parseFloat(corner.top) + parseFloat(corner.paddingTop) + parseFloat(corner.height) + parseFloat(corner.paddingBottom) + parseFloat(corner.borderBottomWidth);
    // The corner is placed in the tab's padding box: `right` counts from its right edge, `left` from its left edge.
    const cornerInnerEdge = side === 'left' ? paddingRight - parseFloat(corner.right) : paddingLeft + parseFloat(corner.left);
    return {
      side,
      cornerLineBottom,
      barLineBottom: barBox.top + barLineWidth,
      cornerLineWidth: parseFloat(corner.borderBottomWidth),
      barLineWidth,
      cornerSideWidth: parseFloat(side === 'left' ? corner.borderRightWidth : corner.borderLeftWidth),
      tabSideWidth: parseFloat(side === 'left' ? islandStyle.borderLeftWidth : islandStyle.borderRightWidth),
      cornerInnerEdge,
      tabPaddingEdge: side === 'left' ? paddingLeft : paddingRight,
      tabReach: islandBox.bottom - barBox.top,
    };
  });
  return islandSeamFindings(corners).map(finding => ({
    kind: 'island-seam' as const,
    selector: describe(island),
    text: finding.side,
    message: finding.message,
    offset: finding.offset,
    boxes: [toBox(islandBox), toBox(barBox)],
  }));
}

/** Runs every check over the rendered page and returns the findings, one per element and kind. */
export function measurePage(tolerances: Tolerances): Finding[] {
  const findings: Finding[] = [];
  const page = document.scrollingElement ?? document.documentElement;
  if (page.scrollWidth > innerWidth + 1) {
    findings.push({ kind: 'overflow', selector: 'html', text: '', message: `the page scrolls sideways by ${page.scrollWidth - innerWidth}px`, offset: page.scrollWidth - innerWidth, boxes: [] });
  }
  const columns: ColumnItem[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
    if (element.closest('[data-align-overlay]') || !isRendered(element)) continue;
    const style = getComputedStyle(element);
    if (isFlexRow(style)) findings.push(...checkCentreLines(element, tolerances), ...checkBaselines(element, tolerances));
    const isList = element.matches(LIST_SELECTOR);
    const isGrid = style.display === 'grid' || style.display === 'inline-grid';
    const isFlexColumn = (style.display === 'flex' || style.display === 'inline-flex') && style.flexDirection.startsWith('column');
    if (isList || isGrid || isFlexColumn) columns.push(...columnItems(element));
    if (style.display === 'flex' || style.display === 'inline-flex') findings.push(...checkGaps(element, tolerances));
    findings.push(...checkSingleLine(element));
    findings.push(...checkOverflow(element));
    if (element.matches(PANEL_HEADING_SELECTOR)) findings.push(...checkHeadingAction(element, tolerances), ...checkHeadingWrap(element));
    if (element.matches(READING_BLOCK_SELECTOR)) findings.push(...checkNearMisses(element, tolerances));
    if (element.matches(TURN_SELECTOR)) findings.push(...checkStranded(element));
  }
  findings.push(...checkColumns(columns, tolerances));
  findings.push(...checkIslandSeam());
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.kind}|${finding.selector}|${finding.text}|${finding.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Draws each finding's boxes over the page for the screenshot; returns nothing, removed by `clearOutlines`. */
export function drawOutlines(findings: Finding[]): void {
  const layer = document.createElement('div');
  layer.setAttribute('data-align-overlay', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const colours: Record<string, string> = {
    'centre-line': '#e5484d', 'column-start': '#f76b15', 'icon-slot': '#f76b15', 'uneven-gap': '#8e4ec6', wrap: '#0090ff', clip: '#0090ff', overflow: '#e54666',
    'heading-action': '#e5484d', 'heading-wrap': '#0090ff', 'family-heading': '#12a594', 'family-edge': '#12a594', 'family-lead': '#12a594', 'island-seam': '#e5484d',
  };
  for (const finding of findings) {
    for (const box of finding.boxes) {
      const outline = document.createElement('div');
      outline.style.cssText = `position:absolute;left:${box.left - 1}px;top:${box.top - 1}px;width:${box.right - box.left + 2}px;height:${box.bottom - box.top + 2}px;outline:2px solid ${colours[finding.kind]};`;
      layer.append(outline);
    }
  }
  document.body.append(layer);
}

export function clearOutlines(): void {
  for (const layer of document.querySelectorAll('[data-align-overlay]')) layer.remove();
}