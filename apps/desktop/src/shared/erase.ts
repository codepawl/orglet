import { z } from 'zod';

/** What a deletion in Settings → Dữ liệu covers. */
export const EraseScope = z.enum(['chats', 'knowledge', 'memory', 'sources', 'everything']);
export type EraseScope = z.infer<typeof EraseScope>;

/** Typed to confirm a full erase. The app's own name, so it reads the same in every language. */
export const ERASE_CONFIRMATION = 'Orglet';

/** What the deletion actually removed, so the window can say it rather than claim it. */
export type EraseSummary = {
  scope: EraseScope;
  chats: number;
  /** Notes only; memories are the `memory` scope (COD-161). */
  knowledge: number;
  /** What workers remembered from chats, every scope. */
  memory: number;
  /** Sources removed outright: nothing in the workspace refers to them any more. */
  sources: number;
  /** Sources a chat still refers to. Their path and hash are dropped, so Orglet can no longer read the file. */
  sourcesForgotten: number;
  /** Workers, teams, skills and routines, only on a full erase. */
  entities: number;
};
