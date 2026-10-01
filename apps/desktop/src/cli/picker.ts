import { normalizeRoleText } from '../shared/role-words';
import { renderMiniFace, MINI_FACE_WIDTH } from './faces';
import type { ChatKind, ListValue } from './protocol';
import { displayWidth, isHexColor, layoutShortcutHint, muted, NEUTRAL_COLOR, padEnd, paint, truncate, type ColorMode } from './terminal';

/** The list `orglet chat` opens on: every orglet and crew, filtered as the person types (COD-236). */

export type ChatEntry = {
  kind: ChatKind;
  name: string;
  /** Provider and model for an orglet, the lead for a crew. */
  detail: string;
  /** The orglet's colour, or a crew's lead's: the waiting face and the prompt use it. */
  color: string;
  /** One face per orglet: the orglet itself, or a crew's members then its lead. */
  colors: string[];
  provider?: string;
  providerId?: string;
  model?: string;
  billing?: string;
  description?: string;
  members?: string[];
  /** Set for a chat opened by its id (`/to #id`, COD-354): `#` and the id, which every request then names. */
  target?: string;
};

function validColor(color: string | undefined): string {
  return isHexColor(color) ? color : NEUTRAL_COLOR;
}

/** Turns `list` into picker entries. An app that sends no colours gets neutral faces; a crew then borrows its members'. */
export function entriesFromList(list: ListValue): ChatEntry[] {
  const colorByName = new Map(list.orglets.map(orglet => [orglet.name, validColor(orglet.color)]));
  const orglets = list.orglets.map(orglet => {
    const color = validColor(orglet.color);
    const detail = orglet.model ? `${orglet.provider}/${orglet.model}` : orglet.provider;
    return {
      kind: 'worker' as const,
      name: orglet.name,
      detail,
      color,
      colors: [color],
      provider: orglet.provider,
      providerId: orglet.providerId ?? orglet.provider,
      model: orglet.model,
      billing: orglet.billing,
      description: orglet.description,
    };
  });
  const crews = list.crews.map(crew => {
    const roster = [...new Set([...crew.members, crew.lead])];
    const colors = crew.colors?.length ? crew.colors.map(validColor) : roster.map(name => colorByName.get(name) ?? NEUTRAL_COLOR);
    const color = colorByName.get(crew.lead) ?? colors[colors.length - 1] ?? NEUTRAL_COLOR;
    const lead = orglets.find(orglet => orglet.name === crew.lead);
    return {
      kind: 'team' as const,
      name: crew.name,
      detail: `crew · lead ${crew.lead}`,
      color,
      colors,
      provider: lead?.provider,
      providerId: lead?.providerId,
      model: lead?.model,
      billing: lead?.billing,
      members: roster,
    };
  });
  return [...orglets, ...crews];
}

export type ChatMatch = { entry: ChatEntry } | { candidates: ChatEntry[] };

/** The same rule as the app's `matchChat`: a case-insensitive exact name, then a unique start of a name. */
export function findChat(entries: readonly ChatEntry[], query: string): ChatMatch {
  const wanted = query.trim().toLocaleLowerCase();
  const exact = entries.filter(entry => entry.name.toLocaleLowerCase() === wanted);
  if (exact.length === 1) return { entry: exact[0] };
  if (exact.length > 1) return { candidates: exact };
  const prefixed = entries.filter(entry => entry.name.toLocaleLowerCase().startsWith(wanted));
  if (prefixed.length === 1) return { entry: prefixed[0] };
  return { candidates: prefixed };
}

export type PickerState = { entries: readonly ChatEntry[]; filter: string; selected: number };

export function createPicker(entries: readonly ChatEntry[], filter = ''): PickerState {
  return { entries, filter, selected: 0 };
}

/** How well a name fits the filter: 0 starts with it, 1 has a word starting with it, 2 contains it, -1 not at all. */
function matchRank(name: string, filter: string): number {
  const normalizedName = normalizeRoleText(name);
  if (normalizedName.startsWith(filter)) return 0;
  if (normalizedName.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(filter))) return 1;
  if (normalizedName.includes(filter)) return 2;
  return -1;
}

/** Orglets then crews, best fit within each group. Case and Vietnamese diacritics are ignored: "nghien" finds "Nghiên". */
export function visibleEntries(state: PickerState): ChatEntry[] {
  const filter = normalizeRoleText(state.filter.trim());
  if (filter === '') return [...state.entries];
  const ranked = state.entries.map(entry => ({ entry, rank: matchRank(entry.name, filter) })).filter(item => item.rank >= 0);
  // The keyboard follows the same groups as the screen; stable ranks retain the app's order within a group.
  return ranked.sort((first, second) => {
    if (first.entry.kind !== second.entry.kind) return first.entry.kind === 'worker' ? -1 : 1;
    return first.rank - second.rank;
  }).map(item => item.entry);
}

/** A new filter starts the selection over at the best fit. */
export function setFilter(state: PickerState, filter: string): PickerState {
  if (filter === state.filter) return state;
  return { ...state, filter, selected: 0 };
}

/** Moves the selection, wrapping from the last entry to the first and back. */
export function moveSelection(state: PickerState, by: number): PickerState {
  const count = visibleEntries(state).length;
  if (count === 0) return state;
  const selected = (((state.selected + by) % count) + count) % count;
  return { ...state, selected };
}

export function chosenEntry(state: PickerState): ChatEntry | undefined {
  return visibleEntries(state)[state.selected];
}

export type PickerLayout = { width: number; mode: ColorMode; maxRows: number; maxLines?: number; grouped?: boolean; showFaces?: boolean };

/** The first visible entry when more match than fit: a window that keeps the selection in view. */
function windowStart(count: number, selected: number, maxRows: number): number {
  if (count <= maxRows) return 0;
  const centred = selected - Math.floor(maxRows / 2);
  return Math.max(0, Math.min(centred, count - maxRows));
}

export function entryLine(entry: ChatEntry, selected: boolean, layout: PickerLayout, facesWidth: number, nameWidth: number): string {
  const marker = selected ? paint('›', { foreground: entry.color, bold: true }, layout.mode) : ' ';
  const showFaces = layout.showFaces ?? layout.mode !== 'none';
  const face = entry.kind === 'team' ? paint('▦', { foreground: entry.color, bold: true }, layout.mode) : renderMiniFace(entry.color, layout.mode);
  const faces = showFaces ? `${padEnd(face, facesWidth)} ` : '';
  const name = truncate(entry.name, nameWidth);
  const paddedName = padEnd(selected ? paint(name, { bold: true }, layout.mode) : name, nameWidth);
  const used = 2 + displayWidth(faces) + nameWidth + 2;
  const detail = muted(truncate(entry.detail, Math.max(0, layout.width - used)), layout.mode);
  return `${marker} ${faces}${paddedName}  ${detail}`.trimEnd();
}

/** Column widths shared by every line of one list, so names and details line up. */
export function columnWidths(entries: readonly ChatEntry[], width: number): { facesWidth: number; nameWidth: number } {
  const facesWidth = MINI_FACE_WIDTH;
  const longestName = Math.max(0, ...entries.map(entry => displayWidth(entry.name)));
  const nameWidth = Math.min(longestName, Math.max(8, Math.floor(width / 2)));
  return { facesWidth, nameWidth };
}

export const PICKER_HINT = '↑↓ move · type to filter · Enter opens · Ctrl+C exit';

/** At most `maxRows` entries; `maxLines` also budgets group headings, spacing and the hint. */
export function renderPickerLines(state: PickerState, layout: PickerLayout): string[] {
  const visible = visibleEntries(state);
  const maxLines = Math.max(0, layout.maxLines ?? Infinity);
  if (maxLines === 0) return [];
  const maximumHintLines = maxLines >= 10 ? 2 : 1;
  const hintLines = layoutShortcutHint(PICKER_HINT, layout.width - 2, maximumHintLines);
  if (visible.length === 0) return [muted(`  Nothing matches "${state.filter.trim()}".`, layout.mode), ...hintLines.map(line => muted(`  ${line}`, layout.mode))].slice(0, maxLines);
  let start = windowStart(visible.length, state.selected, Math.max(1, layout.maxRows));
  let end = Math.min(visible.length, start + Math.max(1, layout.maxRows));
  const showHeadings = layout.grouped && maxLines >= 2;
  const showHint = maxLines >= 3;
  const available = maxLines - (showHint ? hintLines.length : 0);
  // Headings and their gap count as real rows. Trim the farthest edge, never the selected entry.
  const lineCount = () => {
    const groups = visible[start].kind === visible[end - 1].kind ? 1 : 2;
    return end - start + (showHeadings ? groups * 2 - 1 : 0);
  };
  while (end - start > 1 && lineCount() > available) {
    if (state.selected - start >= end - 1 - state.selected) start += 1;
    else end -= 1;
  }
  const shown = visible.slice(start, end);
  const { nameWidth, facesWidth } = columnWidths(state.entries, layout.width);
  const lines: string[] = [];
  for (const [index, entry] of shown.entries()) {
    if (showHeadings && (index === 0 || entry.kind !== shown[index - 1].kind)) {
      if (index > 0) lines.push('');
      const count = visible.filter(candidate => candidate.kind === entry.kind).length;
      const total = state.entries.filter(candidate => candidate.kind === entry.kind).length;
      const countLabel = count === total ? `${count}` : `${count}/${total}`;
      const title = entry.kind === 'worker' ? 'Orglets' : 'Channels';
      lines.push(paint(`  [ ${title} · ${countLabel} ]`, { bold: true }, layout.mode));
    }
    lines.push(entryLine(entry, start + index === state.selected, layout, facesWidth, nameWidth));
  }
  const more = visible.length - shown.length;
  const hint = more > 0 ? `${more} more · ${PICKER_HINT}` : PICKER_HINT;
  if (showHint) lines.push(...layoutShortcutHint(hint, layout.width - 2, maximumHintLines).map(line => muted(`  ${line}`, layout.mode)));
  return lines;
}
