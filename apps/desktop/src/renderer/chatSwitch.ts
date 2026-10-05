/**
 * When the person opens another chat, the right column can appear or go with it: a channel has a member column and a
 * DM has none. That is the chat's own layout, so it is in place at once (user, 2026-10-05). The column's fold motion
 * and the main card's change of width stay for the buttons that show and hide a column, where the person asked for
 * the change. A pane that mounts within this time of a chat switch came with the chat.
 */
export const CHAT_SWITCH_SETTLE_MS = 250;

let switchedAt = Number.NEGATIVE_INFINITY;

export function markChatSwitch(now: number = performance.now()): void {
  switchedAt = now;
}

export function arrivedWithChat(now: number = performance.now()): boolean {
  return now - switchedAt < CHAT_SWITCH_SETTLE_MS;
}
