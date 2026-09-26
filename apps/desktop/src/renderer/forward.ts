import type { Source, Task, Worker, Workspace } from '../shared/contracts';
import type { ForwardTarget } from '../shared/forward';
import { liveTeamTask, liveWorkerTask } from '../shared/live-task';
import { plainSearchText } from '../shared/chat-search';
import { sendToOptions, type SendToOption } from './sendTo';
import { t, tMessage } from './i18n';

/**
 * The places a message can be forwarded to (COD-257), built on the Send to picker's list: recent chats, then every
 * orglet and crew. Plain data, so the picker only draws it.
 */

/** Recent chats the forward list offers, a few more than Send to, since forwarding is mostly to a chat just used. */
const FORWARD_RECENT_COUNT = 5;

/** A message on screen the person asked to forward: which one, and what the picker shows of it. */
export type ForwardRequest = {
  taskId: string;
  messageId: string;
  /** Who wrote it, as the chat names them ("You", or the orglet). */
  author: string;
  text: string;
  /** The files the message had; each can be sent along, which attaches it to the target chat. */
  files: readonly Pick<Source, 'id' | 'name' | 'bytes'>[];
};

export type ForwardOption = SendToOption & {
  forwardTarget: ForwardTarget;
  /**
   * The chat this place lands in: the chat itself, the orglet's or crew's main chat, or a new one. Two rows with the
   * same key are one place, so picking one picks both.
   */
  chatKey: string;
  /** Why this place cannot take a forward now; the row is shown but cannot be picked. */
  unavailable?: string;
};

function isBusy(task: Task): boolean {
  return Boolean(task.pendingStart) || ['queued', 'running', 'pausing'].includes(task.status);
}

/**
 * Every place, less the chat the message is in. A chat at work cannot be picked, because a message arriving there
 * would stop that work, and neither can one whose orglets have no working connection.
 */
export function forwardOptions(workspace: Pick<Workspace, 'tasks' | 'workers' | 'teams'> & Partial<Pick<Workspace, 'routines'>>, originTaskId: string, ready: (workers: readonly Worker[]) => boolean): ForwardOption[] {
  const options = sendToOptions(workspace, FORWARD_RECENT_COUNT + 1);
  const resolved = options.map((option): ForwardOption & { chat?: Task } => {
    const target = option.target;
    const chat = target.kind === 'task' ? workspace.tasks.find(task => task.id === target.id)
      : target.kind === 'worker' ? liveWorkerTask(workspace.tasks, target.id) : liveTeamTask(workspace.tasks, target.id);
    const unavailable = chat && isBusy(chat) ? t('Đang làm') : !ready(option.faces) ? t('Chưa kết nối') : undefined;
    return { ...option, forwardTarget: { kind: target.kind, id: target.id }, chatKey: chat?.id ?? option.key, chat, ...(unavailable ? { unavailable } : {}) };
  });
  const places = resolved.filter(option => option.chatKey !== originTaskId);
  const recent = places.filter(option => option.group === 'recent').slice(0, FORWARD_RECENT_COUNT);
  return [...recent, ...places.filter(option => option.group !== 'recent')].map(({ chat: _chat, ...option }) => option);
}

/** One line of the message for the picker's head: who wrote it and the start of what they wrote, as plain text. */
export function forwardPreview(request: Pick<ForwardRequest, 'author' | 'text'>): string {
  const line = plainSearchText(request.text);
  return t('{0}: {1}', [request.author, line.length > 160 ? `${line.slice(0, 160)}…` : line]);
}

/** What the toast says after sending: where it went, and each place it did not go with the reason. */
export function forwardSummary(sent: number, failed: readonly { name: string; error: string }[]): string {
  if (!failed.length) return sent === 1 ? t('Đã chuyển tiếp') : t('Đã chuyển tiếp tới {0} chat', [sent]);
  const reasons = failed.map(item => t('{0}: {1}', [item.name, tMessage(item.error)])).join(' ');
  if (!sent) return t('Chưa chuyển tiếp được. {0}', [reasons]);
  return t('Đã chuyển tiếp tới {0} chat. Chưa gửi được: {1}', [sent, reasons]);
}
