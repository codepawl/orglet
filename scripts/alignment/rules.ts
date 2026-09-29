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

export type FindingKind = 'centre-line' | 'column-start' | 'icon-slot' | 'uneven-gap' | 'wrap' | 'clip' | 'overflow';

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
    if (isFlexRow(style)) findings.push(...checkCentreLines(element, tolerances));
    const isList = element.matches(LIST_SELECTOR);
    const isGrid = style.display === 'grid' || style.display === 'inline-grid';
    const isFlexColumn = (style.display === 'flex' || style.display === 'inline-flex') && style.flexDirection.startsWith('column');
    if (isList || isGrid || isFlexColumn) columns.push(...columnItems(element));
    if (style.display === 'flex' || style.display === 'inline-flex') findings.push(...checkGaps(element, tolerances));
    findings.push(...checkSingleLine(element));
    findings.push(...checkOverflow(element));
  }
  findings.push(...checkColumns(columns, tolerances));
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
  const colours: Record<string, string> = { 'centre-line': '#e5484d', 'column-start': '#f76b15', 'icon-slot': '#f76b15', 'uneven-gap': '#8e4ec6', wrap: '#0090ff', clip: '#0090ff', overflow: '#e54666' };
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