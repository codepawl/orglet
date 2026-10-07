import { z } from 'zod';
import { WorkspacePermissions } from './workspace-access';

/**
 * What starts a routine (COD-245). A clock (`schedule`, the only kind before this and the default for a routine
 * saved without one), a new file in a folder the person granted (`folder`), or a call from `orglet run`
 * (`called`). Event triggers fire only while the app is open and never replay what happened while it was closed.
 * See docs/routines.md.
 */
export const RoutineTriggerKind = z.enum(['schedule', 'folder', 'called', 'app']);
export type RoutineTriggerKind = z.infer<typeof RoutineTriggerKind>;

/** How often an app trigger looks, in minutes: often enough to feel live, rarely enough to stay inside an API's limits. */
export const APP_TRIGGER_MINUTES = { least: 5, most: 1440 } as const;
/** Words an app trigger's new items must contain one of; none means every new item counts. */
export const APP_TRIGGER_KEYWORD_LIMIT = 10;

/**
 * "When something new shows up in an app" (stage 4, 2026-10-07): every few minutes Orglet itself calls one read-only
 * tool of a connected MCP server with fixed arguments, and items it has not seen before start a run. `serverName` is
 * written by the core from the server on every save, like a folder's name.
 */
export const AppTrigger = z.object({
  kind: z.literal('app'),
  serverId: z.uuid(),
  serverName: z.string().max(40),
  tool: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.unknown()),
  everyMinutes: z.number().int().min(APP_TRIGGER_MINUTES.least).max(APP_TRIGGER_MINUTES.most),
  keywords: z.array(z.string().trim().min(1).max(80)).max(APP_TRIGGER_KEYWORD_LIMIT),
}).strict();
export type AppTrigger = z.infer<typeof AppTrigger>;

/**
 * The folder part names a folder main's picker granted, never a path: the path stays in the core. `folderName` is
 * the folder's own name for the list and the editor; the core writes it from the grant on every save.
 */
export const RoutineTrigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule') }).strict(),
  z.object({ kind: z.literal('folder'), folderId: z.uuid(), folderName: z.string().max(260) }).strict(),
  z.object({ kind: z.literal('called') }).strict(),
  AppTrigger,
]);
export type RoutineTrigger = z.infer<typeof RoutineTrigger>;

/** A watched folder as the renderer sees it after the picker: an id and a name, no path. */
export const WatchFolderView = z.object({ folderId: z.uuid(), name: z.string() }).strict();
export type WatchFolderView = z.infer<typeof WatchFolderView>;

/**
 * A routine's own working folder (COD-294): a folder the picker granted, the level the schedule form chose and whether
 * its runs' changes wait for review. Every run gets this folder at exactly this level as its chat's grant; the level is
 * never wider than the one the picker was opened at. Like the watched folder, it names the grant, never a path, and
 * `folderName` is written by the core from the grant on every save.
 */
export const RoutineWorkspace = z.object({
  folderId: z.uuid(),
  folderName: z.string().max(260),
  permissions: WorkspacePermissions,
  review: z.boolean(),
}).strict();
export type RoutineWorkspace = z.infer<typeof RoutineWorkspace>;

const SCHEDULE_TRIGGER: RoutineTrigger = { kind: 'schedule' };

/** A routine saved before triggers existed runs on its clock. */
export function triggerOf(routine: { trigger?: RoutineTrigger }): RoutineTrigger {
  return routine.trigger ?? SCHEDULE_TRIGGER;
}

/** Office lock files, partial downloads and temporary copies (`~$report.docx`, `x.tmp`, `x.crdownload`, `x.part`). */
const TEMPORARY_PREFIXES = ['~$', '.'];
const TEMPORARY_SUFFIXES = ['.tmp', '.crdownload', '.part', '.partial', '.download'];

/** Whether a new file is one a program is still writing or keeps for itself, so a folder trigger never picks it up. */
export function isTemporaryArrival(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEMPORARY_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  return TEMPORARY_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

/** Items one look takes at most, and the characters one item keeps; a tool that returns more is cut, not refused. */
const APP_ITEM_LIMIT = 200;
const APP_ITEM_CHARACTERS = 2000;

/**
 * A tool's answer as separate items: the elements of a JSON array (or of the first array inside a JSON object, the
 * way most list tools wrap their results), otherwise the non-empty lines of the text.
 */
export function appItems(text: string): string[] {
  let items: string[];
  try {
    const parsed: unknown = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : firstArrayIn(parsed);
    items = list ? list.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : [JSON.stringify(parsed)];
  } catch {
    items = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }
  return items.slice(0, APP_ITEM_LIMIT).map(item => item.slice(0, APP_ITEM_CHARACTERS));
}

function firstArrayIn(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return Object.values(value).find(Array.isArray);
}

/** Whether an item has one of the trigger's words, ignoring case and accents; no words means it always does. */
export function matchesKeywords(item: string, keywords: readonly string[]): boolean {
  if (!keywords.length) return true;
  // Vietnamese đ is a letter of its own, not d with a mark, so it is folded by hand.
  const plain = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/gi, 'd').toLowerCase();
  const haystack = plain(item);
  return keywords.some(keyword => haystack.includes(plain(keyword)));
}
