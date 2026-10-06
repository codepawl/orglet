import type { Run, TaskDetail, Workspace } from '../shared/contracts';
import type { ForwardResult, ForwardTarget } from '../shared/forward';
import { canContinueRun } from '../shared/out-of-steps';
import type { CliChat, CliRequest, ControlValue, ForwardValue, ReactValue } from '../cli/protocol';
import { chatsOf, CliFailure, matchChat, targetChat, taskRunners } from './cli-chats';
import { isTurnRunning, pendingDecision, resolveMessage, savedTurnInput, turnArtifacts, turnRevisionAt } from './cli-chat-history';
import { readTask, turnResult, waitForTurn, type CliDependencies } from './cli-turns';

/**
 * What a person does to a chat's messages and its latest turn from the terminal (COD-354): react, forward, stop,
 * pause, resume, retry, continue, and answer an orglet's question. Each one is the core command the desktop's button
 * sends, with the same guards; the core refuses whatever the desktop would refuse. An MCP approval is not answered
 * here: it is a trust decision, so only the desktop's card answers it.
 */

type ControlRequest = Extract<CliRequest, { op: 'control' }>;
type AnswerRequest = Extract<CliRequest, { op: 'answer' }>;

/** The core command behind each button under a turn; `continue` is a new message and has none of its own. */
const CORE_COMMAND_OF_CONTROL = { stop: 'cancel', pause: 'pause', resume: 'resume', retry: 'retry' } as const;

export class CliChatActions {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  private detail(taskId: string): Promise<TaskDetail> {
    return readTask(this.dependencies.request, taskId);
  }

  /** A correction starts a fresh turn from the chosen message's saved input, leaving every earlier run frozen. */
  async revise(request: Extract<CliRequest, { op: 'revise' }>, signal: AbortSignal): Promise<ControlValue> {
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, request);
    const detail = await this.detail(task.id);
    if (isTurnRunning(detail.task)) throw new CliFailure('failed', 'Đợi lượt đang chạy dừng trước khi sửa tin nhắn.');
    const revision = turnRevisionAt(detail, Number(request.message.replace(/^#/, '')));
    if (revision === undefined) throw new CliFailure('not_found', 'Không tìm thấy tin nhắn của bạn để sửa.');
    const input = savedTurnInput(detail, revision);
    if (!input) throw new CliFailure('failed', 'Tin nhắn này thiếu bản lưu đầu vào; không thể khôi phục tệp gốc để sửa.');
    const sourceIds = input.sourceIds.filter(sourceId => detail.sources.some(source => source.id === sourceId && !source.revoked));
    const providerScopes = [...new Set(taskRunners(workspace, detail.task).map(worker => worker.provider).filter(provider => provider !== 'demo'))];
    await this.dependencies.request('reviseTask', {
      taskId: task.id,
      brief: request.text,
      sourceIds,
      excludedSources: input.excludedSources,
      replyTo: input.replyTo,
      planFirst: input.planFirst,
      consent: true,
      providerScopes,
      budgetMicros: detail.task.budgetMicros,
      onlyWhenIdle: true,
    });
    return this.settle(chat, task.id, 'revise', request.wait, request.timeoutSeconds, signal);
  }

  async react(request: Extract<CliRequest, { op: 'react' }>): Promise<ReactValue> {
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, request);
    const message = resolveMessage(await this.detail(task.id), request.message);
    await this.dependencies.request('setMessageReaction', { taskId: task.id, messageId: message.messageId, emoji: request.emoji, active: request.active });
    return { chat, taskId: task.id, ref: message.ref, emoji: request.emoji, active: request.active };
  }

  /** Forwards one message to up to five orglets' or crews' chats, as the person's own message; files go by name only. */
  async forward(request: Extract<CliRequest, { op: 'forward' }>): Promise<ForwardValue> {
    const workspace = await this.workspace();
    const { task } = targetChat(workspace, request);
    const message = resolveMessage(await this.detail(task.id), request.message);
    const chats = chatsOf(workspace);
    const destinations = uniqueChats(request.targets.map(name => matchChat(name, chats)));
    const targets: ForwardTarget[] = destinations.map(destination => ({ kind: destination.kind, id: destination.id }));
    const note = request.note ? { note: request.note } : {};
    const result = await this.dependencies.request('forwardMessage', { taskId: task.id, messageId: message.messageId, targets, ...note, carrySourceIds: [] }) as ForwardResult;
    const nameOf = (target: ForwardTarget) => destinations.find(destination => destination.id === target.id)?.name ?? target.id;
    return {
      sent: result.sent.map(item => ({ name: nameOf(item.target), taskId: item.taskId })),
      failed: result.failed.map(item => ({ name: nameOf(item.target), error: this.dependencies.translate(item.error) })),
    };
  }

  async control(request: ControlRequest, signal: AbortSignal): Promise<ControlValue> {
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, request);
    if (request.action === 'continue') return this.continueTurn(request, workspace, chat, task.id, signal);
    if (request.action === 'stop' && !isTurnRunning(task)) throw new CliFailure('failed', 'Không có lượt nào đang chạy trong chat này.');
    await this.dependencies.request(CORE_COMMAND_OF_CONTROL[request.action], { id: task.id });
    const startsRun = request.action === 'resume' || request.action === 'retry';
    return this.settle(chat, task.id, request.action, startsRun && request.wait, request.timeoutSeconds, signal);
  }

  /**
   * Continue under an answer cut short by the step limit, as the desktop's Continue does (COD-257): the next message
   * carries the chat's files, and its run starts from the last run's calls and results.
   */
  private async continueTurn(request: ControlRequest, workspace: Workspace, chat: CliChat, taskId: string, signal: AbortSignal): Promise<ControlValue> {
    const detail = await this.detail(taskId);
    const run = continuableRun(detail);
    const input = detail.task.currentInput ?? detail.task;
    const sourceIds = input.sourceIds.filter(sourceId => !detail.sources.find(source => source.id === sourceId)?.revoked);
    const provider = workspace.workers.find(worker => worker.id === detail.task.workerId)?.provider ?? run.snapshot.worker.provider;
    await this.dependencies.request('reviseTask', {
      taskId,
      brief: this.dependencies.translate('Tiếp tục từ chỗ đã dừng.'),
      continueFrom: run.id,
      sourceIds,
      excludedSources: input.excludedSources,
      consent: true,
      providerScopes: provider === 'demo' ? [] : [provider],
      budgetMicros: detail.task.budgetMicros,
    });
    return this.settle(chat, taskId, 'continue', request.wait, request.timeoutSeconds, signal);
  }

  /**
   * Answers the question an orglet asked, with one of its choices (by number or text) or words of the person's own,
   * the way the desktop's message box does while a question waits. The run then goes on.
   */
  async answer(request: AnswerRequest, signal: AbortSignal): Promise<ControlValue> {
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, request);
    const decision = task.status === 'waiting_input' ? pendingDecision(task) : undefined;
    if (!decision) throw new CliFailure('failed', 'Chat này không chờ câu trả lời nào.');
    if (decision.approval) throw new CliFailure('failed', 'Câu hỏi này xin quyền dùng công cụ MCP. Chỉ app trả lời được: mở chat trong app.');
    const answer = chosenOption(request.answer, decision.options);
    await this.dependencies.request('answerDecision', { taskId: task.id, requestId: decision.id, answer });
    return this.settle(chat, task.id, 'answer', request.wait, request.timeoutSeconds, signal);
  }

  /** Reads the chat after an action and, when asked, waits for the turn it started the way `send` does. */
  private async settle(chat: CliChat, taskId: string, action: ControlValue['action'], wait: boolean, timeoutSeconds: number, signal: AbortSignal): Promise<ControlValue> {
    let detail = await this.detail(taskId);
    const revision = detail.task.inputRevision ?? 0;
    if (wait) detail = await waitForTurn(this.dependencies, detail, timeoutSeconds, signal, undefined, revision);
    return { ...turnResult(chat, detail, revision, wait, this.dependencies.translate), action };
  }
}

function uniqueChats(chats: readonly CliChat[]): CliChat[] {
  return chats.filter((chat, index) => chats.findIndex(other => other.kind === chat.kind && other.id === chat.id) === index);
}

/** A choice typed by its number in the list the terminal printed, or the text as typed. */
function chosenOption(answer: string, options: readonly string[]): string {
  if (!/^\d+$/.test(answer)) return answer;
  return options[Number(answer) - 1] ?? answer;
}

/** The latest turn's answering run, when the desktop would offer Continue under it. */
function continuableRun(detail: TaskDetail): Run {
  const busy = isTurnRunning(detail.task);
  const author = turnArtifacts(detail, detail.task.inputRevision ?? 0).at(-1)?.run;
  if (busy || !author || !canContinueRun(author)) throw new CliFailure('failed', 'Lượt mới nhất không dừng vì hết bước, nên không có gì để tiếp tục.');
  return author;
}
