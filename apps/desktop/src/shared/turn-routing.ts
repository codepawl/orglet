import { z } from 'zod';
import { DecisionModelConnection } from './decisions';

/**
 * Who the decision model picked to answer one group-chat message that tagged nobody (COD-305), kept on the chat so the thread can
 * say so under the message and a resumed or retried turn keeps the same answerer. Only a pick narrower than the whole
 * group is kept; a message everyone answers has no record, as before the decision model.
 */
export const TurnRoute = z.object({
  inputRevision: z.number().int().nonnegative(),
  workerIds: z.array(z.string().uuid()).min(1).max(8),
  /** The decision model's probability for the pick, shown in the line's tooltip. */
  probability: z.number().min(0).max(1),
  decidedAt: z.iso.datetime(),
  /** The backend of the person's list that answered, so the line never hides which one was asked. */
  answeredBy: DecisionModelConnection.optional(),
}).strict();
export type TurnRoute = z.infer<typeof TurnRoute>;

/** A chat keeps the picks of its latest turns only; older turns' answers still say who wrote them. */
export const MAX_TURN_ROUTES = 200;

export function routeOfTurn(routes: readonly TurnRoute[] | undefined, inputRevision: number): TurnRoute | undefined {
  return routes?.find(route => route.inputRevision === inputRevision);
}
