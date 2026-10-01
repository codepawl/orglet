/** The earlier turns a request carried, read back from its one-per-message `earlierTurn` messages (COD-358). */
export function earlierTurns(messages: readonly unknown[]): { id: string; from: string; text: string }[] {
  return (messages as { content?: unknown }[]).flatMap(message => {
    if (typeof message.content !== 'string' || !message.content.startsWith('{"earlierTurn":')) return [];
    return [JSON.parse(message.content).earlierTurn];
  });
}
