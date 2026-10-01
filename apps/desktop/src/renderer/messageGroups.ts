/**
 * Messages from one author in a row group under one header, the way Slack lists them (COD-365): the first carries the
 * face, the name and the time, and the ones right after it carry only their text, with the time shown in the gutter
 * on hover. A group ends when someone else writes, when a time mark breaks the chat, or after a pause longer than
 * `GROUP_WINDOW_MS`.
 */

/** How long after the previous message a message from the same author still joins its group. */
export const GROUP_WINDOW_MS = 5 * 60_000;

/** Who wrote a message and when: `person` for the person, `worker:<id>` for an orglet. */
export type MessageAuthor = { key: string; at?: string };

/** True when `next` joins the group `previous` belongs to: same author, and both times known and close together. */
export function continuesGroup(previous: MessageAuthor | undefined, next: MessageAuthor): boolean {
  if (!previous || previous.key !== next.key) return false;
  if (!previous.at || !next.at) return false;
  const gap = new Date(next.at).getTime() - new Date(previous.at).getTime();
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

/**
 * Walks the messages in the order they are drawn. `place` answers whether a message continues the group before it and
 * remembers it as the latest; `breakHere` starts a fresh group, for a time mark or anything else drawn between two
 * messages that should not read as one stretch.
 */
export function messageGrouping() {
  let previous: MessageAuthor | undefined;
  return {
    place(author: MessageAuthor): boolean {
      const continued = continuesGroup(previous, author);
      previous = author;
      return continued;
    },
    breakHere() {
      previous = undefined;
    },
  };
}

export const personAuthorKey = 'person';

export function workerAuthorKey(workerId: string): string {
  return `worker:${workerId}`;
}
