/**
 * Which orglet the Schedules page's message box was last aimed at. It is window chrome, like the Open list: it lives in
 * this browser's storage, never in the database, and the box works without it.
 */
const STORAGE_KEY = 'orglet.schedule-asker';

export function rememberedScheduleAsker(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberScheduleAsker(workerId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, workerId);
  } catch {
    // The choice is only a convenience; the next visit starts at the first orglet.
  }
}

/** The orglet the box starts on: the one chosen last time while it still exists, otherwise the first in the person's list. */
export function initialScheduleAsker(workerIds: readonly string[], remembered: string | undefined): string | undefined {
  if (remembered && workerIds.includes(remembered)) return remembered;
  return workerIds[0];
}
