import { DEFAULT_ACCENT_COLOR } from './accent';

export const ALL_MENTION = 'all';

/** The colour a mention tag is drawn in when the user has not picked one (user, 2026-09-19: this is theirs to change). */
export const DEFAULT_MENTION_COLOR = DEFAULT_ACCENT_COLOR;

export type MentionPerson = { id: string; name: string };
export type MentionKind = 'worker' | 'all';
export type MentionHit = { start: number; end: number; id: string; name: string; kind: MentionKind };
export type MentionOption = { id: string; name: string; kind: MentionKind };
export type MentionQuery = { start: number; query: string };

const ALL_ALIASES = ['all', 'everyone', 'tất cả'];

function isMentionBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  return /[\s([{"'>]/.test(previous);
}

function isNameEnd(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !/[\p{L}\p{N}_]/u.test(text[index]!);
}

function aliases(allNames: readonly string[] = []): { id: string; name: string; kind: 'all' }[] {
  return [...ALL_ALIASES, ...allNames].map(name => ({ id: ALL_MENTION, name, kind: 'all' as const }));
}

/** `@name` spans in `text` that match a worker, `@all` / `@everyone` / `@tất cả`, or a team name. Longest name wins. */
export function parseMentions(text: string, people: readonly MentionPerson[], allNames: readonly string[] = []): MentionHit[] {
  const candidates = [
    ...people.map(person => ({ id: person.id, name: person.name, kind: 'worker' as const })),
    ...aliases(allNames),
  ].sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));
  const hits: MentionHit[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '@' || !isMentionBoundary(text, index)) continue;
    const rest = text.slice(index + 1);
    const lower = rest.toLocaleLowerCase();
    const match = candidates.find(candidate => lower.startsWith(candidate.name.toLocaleLowerCase()) && isNameEnd(text, index + 1 + candidate.name.length));
    if (!match) continue;
    hits.push({ start: index, end: index + 1 + match.name.length, id: match.id, name: match.name, kind: match.kind });
    index += match.name.length;
  }
  return hits;
}

/**
 * People this turn should address. `undefined` means everyone: no `@`, `@all`, a team name, or only unknown tags.
 */
export function mentionedPeople<T extends MentionPerson>(text: string, people: readonly T[], allNames: readonly string[] = []): T[] | undefined {
  const hits = parseMentions(text, people, allNames);
  if (!hits.length || hits.some(hit => hit.kind === 'all')) return undefined;
  const ids = new Set(hits.filter(hit => hit.kind === 'worker').map(hit => hit.id));
  if (!ids.size) return undefined;
  const tagged = people.filter(person => ids.has(person.id));
  return tagged.length ? tagged : undefined;
}

/** Incomplete `@query` at `cursor`, if the user is typing a tag. */
export function mentionQueryAt(text: string, cursor: number): MentionQuery | undefined {
  if (cursor < 0 || cursor > text.length) return undefined;
  const at = text.lastIndexOf('@', Math.max(0, cursor - 1));
  if (at < 0 || at >= cursor || !isMentionBoundary(text, at)) return undefined;
  const query = text.slice(at + 1, cursor);
  if (query.includes('\n')) return undefined;
  return { start: at, query };
}

/**
 * What the `@` menu offers: everyone, then each member.
 *
 * The team's own name is deliberately not on the list (user, 2026-09-19). Tagging it means exactly what `@all`
 * means, so offering both put two entries that do the same thing next to each other. `parseMentions` still accepts
 * it, because messages already written that way must keep their meaning.
 */
export function mentionOptions(query: string, people: readonly MentionPerson[]): MentionOption[] {
  const needle = query.trim().toLocaleLowerCase();
  const options: MentionOption[] = [];
  if (!needle || ALL_ALIASES.some(alias => alias.toLocaleLowerCase().startsWith(needle))) {
    options.push({ id: ALL_MENTION, name: 'all', kind: 'all' });
  }
  for (const person of people) {
    if (!needle || person.name.toLocaleLowerCase().includes(needle)) options.push({ id: person.id, name: person.name, kind: 'worker' });
  }
  return options;
}

export function insertMention(text: string, cursor: number, name: string): { text: string; cursor: number } {
  const query = mentionQueryAt(text, cursor);
  const start = query?.start ?? cursor;
  const trailing = text.slice(cursor).startsWith(' ') ? '' : ' ';
  const insert = `@${name}${trailing}`;
  return { text: text.slice(0, start) + insert + text.slice(cursor), cursor: start + insert.length };
}
