/**
 * Reading Playwright's accessibility snapshot (the `ai` mode) line by line, for acting on pages (COD-261). A line is
 * `- role "name" [attribute] [ref=e5]`, with `[active]` on the focused element and its frames. The host takes a fresh
 * snapshot before every step and finds the worker's ref in it: an element whose role or name changed gets a new ref
 * there, so the old one no longer answers.
 */

export type SnapshotElement = { ref: string; role: string; name: string };

const ELEMENT_LINE = /^\s*- ([a-z][a-z-]*)(?: "((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=((?:f\d+)?e\d+)\]/;

function unescapeName(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function elementOf(line: string): SnapshotElement | undefined {
  const match = ELEMENT_LINE.exec(line);
  if (!match) return undefined;
  return { role: match[1], name: unescapeName(match[2] ?? ''), ref: match[3] };
}

/** The element a ref names in this snapshot, or undefined when the page no longer has it. */
export function snapshotElement(snapshot: string, ref: string): SnapshotElement | undefined {
  for (const line of snapshot.split('\n')) {
    if (!line.includes(`[ref=${ref}]`)) continue;
    const element = elementOf(line);
    if (element?.ref === ref) return element;
  }
  return undefined;
}

/** The focused element: the deepest line marked active, since the frame holding it is marked too. */
export function focusedElement(snapshot: string): SnapshotElement | undefined {
  let focused: SnapshotElement | undefined;
  for (const line of snapshot.split('\n')) {
    if (!line.includes('[active]')) continue;
    focused = elementOf(line) ?? focused;
  }
  return focused;
}

/** A line with the marks that change between snapshots (refs, focus, pointer) taken out, so equal content compares equal. */
function steadyLine(line: string): string {
  return line.replace(/ ?\[(?:ref=[a-z0-9]+|active|cursor=[a-z]+)\]/g, '').trim();
}

/**
 * The lines of `after` that `before` did not have, cut at `limit` characters: what a step changed on the page, such
 * as suggestions that appeared under a search box, or the whole of a new page.
 */
export function newSnapshotLines(before: string, after: string, limit: number): { text: string; cut: boolean } {
  const seen = new Set(before.split('\n').map(steadyLine));
  const added = after.split('\n').filter(line => line.trim() && !seen.has(steadyLine(line)));
  const text = added.join('\n');
  const characters = Array.from(text);
  if (characters.length <= limit) return { text, cut: false };
  return { text: characters.slice(0, limit).join(''), cut: true };
}
