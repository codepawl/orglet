/**
 * The files a message brought with it (COD-263). A chat keeps its files from one message to the next, so each turn's
 * input lists every file the chat had at that point; the message shows only the ones that were not there the turn
 * before, and earlier files stay in the chat's sources without being drawn again above every later message.
 */
export function filesAddedWith<T extends { id: string }>(current: readonly T[], previous: readonly T[] | undefined): T[] {
  if (!previous) return [...current];
  const earlier = new Set(previous.map(file => file.id));
  return current.filter(file => !earlier.has(file.id));
}
