/**
 * How many of a chat's latest turns each message sends word for word; older turns are folded into a summary
 * (`core/context/thread.ts`). Shared so the usage details under the message box can say so (COD-326).
 */
export const THREAD_VERBATIM_TURNS = 10;
