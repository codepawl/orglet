/** What a deleted chat's name and every turn it kept read as. */
export const DELETED_CHAT_TEXT = '(đã xóa)';

type DeletableSnapshot = {
  input?: { brief: string; replyTo?: string };
  context?: unknown;
  preflightId?: string;
  upstreamArtifactIds?: string[];
};

/**
 * What a run of a deleted chat keeps of its snapshot when the chat already cost money: who ran it, with what, and
 * never what was asked. Deleting a chat writes this, and restoring a backup uses the same function to recognise the
 * deleted run as the one the backup holds in full (COD-281).
 */
export function deletedRunSnapshot<Snapshot extends DeletableSnapshot>(snapshot: Snapshot): Snapshot {
  const input = snapshot.input ? { input: { ...snapshot.input, brief: DELETED_CHAT_TEXT, replyTo: undefined } } : {};
  return { ...snapshot, ...input, context: undefined, preflightId: undefined, upstreamArtifactIds: undefined };
}
