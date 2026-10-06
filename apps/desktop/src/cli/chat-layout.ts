import { HEADER_FACE_WIDTH, renderHeaderFace, renderMiniFace } from './faces';
import type { ChatEntry } from './picker';
import { muted, paint, truncate, wrapSegments, type ColorMode } from './terminal';

/** One mascot identifies the product; author names identify the conversation. */
export function terminalHeader(chat: ChatEntry | undefined, version: string, directory: string, width: number, height: number, mode: ColorMode): string[] {
  const title = `Orglet ${version}${chat ? ` · ${chat.name}` : ''}`;
  const model = chat ? `${chat.model ?? (chat.providerId === 'demo' ? 'No model connected' : 'CLI/provider default')} · ${chat.provider ?? 'connection unknown'}` : 'Choose an orglet or channel';
  if (height < 12 || width < 54) {
    return [paint(truncate(title, width), { bold: true }, mode), muted(truncate(height < 7 ? model : `${model} · ${directory}`, width), mode)];
  }
  const beside = [paint(title, { bold: true }, mode), model, chat?.billing ?? 'Plan not reported', directory];
  const gap = '   ';
  const mascot = renderHeaderFace(chat?.color, mode);
  const textWidth = width - HEADER_FACE_WIDTH - gap.length;
  return mascot.map((row, index) => `${row}${gap}${truncate(beside[index], textWidth)}`);
}

export function agentDetails(chat: ChatEntry, entries: readonly ChatEntry[], directory: string, width: number, mode: ColorMode): string[] {
  const names = chat.members ?? [chat.name];
  const lines = [`Agents · ${chat.name}`];
  for (const name of names) {
    const agent = entries.find(entry => entry.kind === 'worker' && entry.name === name);
    lines.push(`${renderMiniFace(agent?.color, mode)} ${name} · ${agent?.detail ?? 'connection unknown'}`);
    if (agent?.description) lines.push(`     ${agent.description}`);
  }
  lines.push(`Terminal: ${directory}`, 'Plan tier: not reported by this connection.', 'Thinking effort: provider default; no Orglet override.');
  lines.push('Ctrl+G toggles · ← picks a chat · Esc closes');
  return lines.flatMap((line, index) => wrapSegments([{ text: line, style: { bold: index === 0 } }], { width, mode }));
}
