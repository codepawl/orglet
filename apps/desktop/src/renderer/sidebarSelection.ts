/**
 * Selecting several rows in one sidebar section (COD-214). Pure: the ids come in list order, and the selection is
 * kept in that order too. The selection belongs to one section at a time; picking in the other section starts over
 * there. The anchor is the row the next Shift-click ranges from.
 */
export type SidebarSelectionSection = 'teams' | 'workers';
export type SidebarSelection = { section: SidebarSelectionSection | null; ids: string[]; anchor: string | null };
export type SelectionPickMode = 'toggle' | 'range';

export const noSelection: SidebarSelection = { section: null, ids: [], anchor: null };

/** Which selection gesture a click carries: Shift ranges, Ctrl (Cmd on macOS) toggles, a plain click neither. */
export function selectionPickMode(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectionPickMode | null {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return null;
}

function inListOrder(order: string[], ids: string[]): string[] {
  return order.filter(id => ids.includes(id));
}

/** Adds the row to the selection or takes it out; it becomes the anchor when added. */
export function toggleSelection(current: SidebarSelection, section: SidebarSelectionSection, order: string[], id: string): SidebarSelection {
  if (current.section !== section) return { section, ids: [id], anchor: id };
  if (!current.ids.includes(id)) return { section, ids: inListOrder(order, [...current.ids, id]), anchor: id };
  const ids = current.ids.filter(other => other !== id);
  if (!ids.length) return noSelection;
  const anchor = current.anchor === id ? ids[ids.length - 1] : current.anchor;
  return { section, ids, anchor };
}

/**
 * Selects exactly the rows from the anchor to this one, dropping earlier picks, the way a file list does (user,
 * 2026-09-23). The anchor stays where it is, so a second Shift-click ranges from the same place. Without an anchor
 * in this section it selects the row.
 */
export function selectRange(current: SidebarSelection, section: SidebarSelectionSection, order: string[], id: string): SidebarSelection {
  const targetIndex = order.indexOf(id);
  if (targetIndex < 0) return current;
  const anchorIndex = current.section === section && current.anchor ? order.indexOf(current.anchor) : -1;
  if (anchorIndex < 0) return { section, ids: [id], anchor: id };
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const ids = order.slice(start, end + 1);
  return { section, ids, anchor: current.anchor };
}

/** Drops rows that left the list (archived, deleted, another workspace). Returns the same object when nothing changed. */
export function pruneSelection(current: SidebarSelection, order: string[]): SidebarSelection {
  if (!current.section) return current;
  const ids = current.ids.filter(id => order.includes(id));
  if (ids.length === current.ids.length) return current;
  if (!ids.length) return noSelection;
  const anchor = current.anchor && ids.includes(current.anchor) ? current.anchor : ids[ids.length - 1];
  return { section: current.section, ids, anchor };
}
