import type { RunningItem } from '../shared/running';
import { foldForSearch } from './sendTo';

/**
 * The areas on the far-left rail (COD-366), the way Discord's rail has Home and its servers: Home holds the orglets
 * as friends and their DMs, Channels the channels grouped in categories, Activity what needs the person. Library and
 * Schedules sit on the same rail but open their own panels, so they are not areas. Which area is open is UI chrome:
 * it lives in this browser's storage and never in the workspace.
 */
export type Area = 'home' | 'channels' | 'activity';
export const areas: readonly Area[] = ['home', 'channels', 'activity'];

/** The Activity area's views: what waits for the person, what runs, what finished, what was saved for later. */
export type ActivityTab = 'needs' | 'running' | 'done' | 'saved';
export const activityTabs: readonly ActivityTab[] = ['needs', 'running', 'done', 'saved'];

const areaKey = 'orglet.area';

export function readArea(): Area {
  try {
    const stored = localStorage.getItem(areaKey);
    return areas.find(area => area === stored) ?? 'home';
  } catch {
    return 'home';
  }
}

export function writeArea(area: Area) {
  try {
    localStorage.setItem(areaKey, area);
  } catch {
    /* storage unavailable: the area is kept in memory only */
  }
}

const openSpaceKey = 'orglet.space';

/** The space whose channels the Channels area lists (docs/spaces-design.md); none lists the channels outside every space. UI chrome. */
export function readOpenSpace(): string {
  try {
    return localStorage.getItem(openSpaceKey) ?? '';
  } catch {
    return '';
  }
}

export function writeOpenSpace(spaceId: string) {
  try {
    localStorage.setItem(openSpaceKey, spaceId);
  } catch {
    /* storage unavailable: the open space is kept in memory only */
  }
}

/** The orglets that have a run going right now, which the sidebar and the member column mark. */
export function workingOrgletIds(running: readonly RunningItem[]): Set<string> {
  return new Set(running.filter(item => item.state === 'running' || item.state === 'pausing').map(item => item.worker.id));
}

/** A group of channels under one category's name; `name` is undefined for the channels that have none. */
export type ChannelGroup<Entry> = { name: string | undefined; entries: Entry[] };

/**
 * The Channels area's list: channels without a category first, then one group per category in alphabetical order, each
 * keeping the order its channels came in (newest first). Two spellings that differ only in case are one category,
 * named as its first channel spelled it.
 */
export function groupChannels<Entry>(entries: readonly Entry[], categoryOf: (entry: Entry) => string | undefined): ChannelGroup<Entry>[] {
  const uncategorized: Entry[] = [];
  const byKey = new Map<string, ChannelGroup<Entry>>();
  for (const entry of entries) {
    const name = categoryOf(entry)?.trim();
    if (!name) {
      uncategorized.push(entry);
      continue;
    }
    const key = foldForSearch(name);
    const group = byKey.get(key);
    if (group) group.entries.push(entry);
    else byKey.set(key, { name, entries: [entry] });
  }
  const categories = [...byKey.values()].sort((first, second) => foldForSearch(first.name!).localeCompare(foldForSearch(second.name!)));
  return [...(uncategorized.length ? [{ name: undefined, entries: uncategorized }] : []), ...categories];
}

/** The categories already in use, for the channel dialog to offer; the same spelling rule as `groupChannels`. */
export function categoryNames(categories: readonly (string | undefined)[]): string[] {
  const names = new Map<string, string>();
  for (const category of categories) {
    const name = category?.trim();
    if (name && !names.has(foldForSearch(name))) names.set(foldForSearch(name), name);
  }
  return [...names.values()].sort((first, second) => foldForSearch(first).localeCompare(foldForSearch(second)));
}
