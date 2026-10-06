import type { Source, Task, TaskDetail, TaskInput, Team, Worker, Workspace } from '../shared/contracts';
import type { CliChat } from '../cli/protocol';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliRequest, ListValue, OpenValue, ReadValue, RunValue, SendValue, SpacesValue, StatusValue } from '../cli/protocol';
import { connectionPricing, findCustomConnection } from '../shared/custom-connections';
import { isHarness } from '../shared/harness';
import { isLocalApi, isPlanApi } from '../shared/contracts';
import { resolveWorkerModel } from '../core/models/resolve';
import { CliActivityFeed } from './cli-activity';
import type { CliProgressFrame } from '../cli/protocol';
import { manageCli } from './cli-management';
import { assertOneTarget, chatOfTask, chatsOf, CliFailure, crewRoster, liveChatTask, matchChat, matchSchedule, targetChat, taskById, taskRunners, type ChatTargetRequest } from './cli-chats';
import { chatTurns, isTurnRunning, latestAnsweredRevision, pendingQuestion, resolveMessage, turnAnswers, waitsForDesktop } from './cli-chat-history';
import { CliChatActions } from './cli-chat-actions';
import { CliChatAdmin } from './cli-chat-admin';
import { channelRows, channelsOfSpace, listedChannelRow, listedChannels } from './cli-channels';
import { CliSchedules } from './cli-schedules';
import { CliLibrary } from './cli-library';
import { readTask, turnResult, waitForTurn, type CliDependencies } from './cli-turns';

export { chatsOf, CliFailure, matchChat, matchSchedule, type CoreRequest } from './cli-chats';
export { answerText, isTurnRunning, latestAnsweredRevision, turnAnswers, turnErrors } from './cli-chat-history';
export type { CliDependencies } from './cli-turns';
import { CliSpaces } from './cli-spaces';
import { CliMarket } from './cli-market';

/**
 * What each `orglet` command does inside the app (COD-234). Every step goes through the same core commands the
 * window uses, so a message sent from a terminal is the same turn the composer would have made. Nothing here imports
 * Electron: main passes the core request, the app version, the window opener and the translator in.
 */

const DEFAULT_TASK_BUDGET_MICROS = 500_000;

export class CliOperations {
  private readonly chatActions: CliChatActions;
  private readonly chatAdmin: CliChatAdmin;
  private readonly schedules: CliSchedules;
  private readonly library: CliLibrary;
  private readonly spaceChanges: CliSpaces;
  private readonly market: CliMarket;

  constructor(private readonly dependencies: CliDependencies) {
    this.chatActions = new CliChatActions(dependencies);
    this.chatAdmin = new CliChatAdmin(dependencies);
    this.schedules = new CliSchedules(dependencies);
    this.library = new CliLibrary(dependencies);
    this.spaceChanges = new CliSpaces(dependencies);
    this.market = new CliMarket(dependencies);
  }

  async run(request: CliRequest, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void): Promise<unknown> {
    switch (request.op) {
      case 'status': return this.status();
      case 'list': return this.list();
      case 'send': return this.send(request, signal, progress);
      case 'read': return this.read(request);
      case 'open': return this.open(request.to);
      case 'run': return this.runSchedule(request);
      case 'react': return this.chatActions.react(request);
      case 'forward': return this.chatActions.forward(request);
      case 'control': return this.chatActions.control(request, signal);
      case 'answer': return this.chatActions.answer(request, signal);
      case 'revise': return this.chatActions.revise(request, signal);
      case 'chats': return this.chatAdmin.chats(request);
      case 'side-thread': return this.chatAdmin.sideThread(request, signal);
      case 'bring': return this.chatAdmin.bring(request);
      case 'channel': return this.chatAdmin.channel(request, signal);
      case 'members': return this.chatAdmin.members(request);
      case 'chat-change': return this.chatAdmin.change(request);
      case 'archive-entity': return this.chatAdmin.archiveEntity(request);
      case 'template': return this.chatAdmin.template(request);
      case 'schedules': return this.schedules.list();
      case 'spaces': return this.spaces();
      case 'space-change': return this.spaceChanges.change(request);
      case 'market': return this.market.run(request);
      case 'schedule-enable': return this.schedules.enable(request);
      case 'schedule-delete': return this.schedules.remove(request);
      case 'schedule-save': return this.schedules.save(request);
      case 'search': return this.library.search(request);
      case 'running': return this.library.running(request);
      case 'library': return this.library.library(request);
      case 'memory-edit': return this.library.editMemory(request);
      case 'memory-delete': return this.library.deleteMemory(request);
      case 'usage': return this.library.usage(request);
      case 'models': return this.library.models(request);
      case 'preferences': return this.library.preferences(request);
      case 'config':
      case 'save-orglet':
      case 'save-crew':
      case 'delete-entity': return manageCli(request, this.dependencies);
    }
  }

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  private taskDetail(id: string): Promise<TaskDetail> {
    return readTask(this.dependencies.request, id);
  }

  async status(): Promise<StatusValue> {
    const workspace = await this.workspace();
    const running = workspace.tasks.filter(task => !task.deletedAt && !task.archivedAt && isTurnRunning(task)).length;
    const colors = workspace.workers.map(worker => defaultAvatarColor(worker));
    return { version: this.dependencies.version(), orglets: workspace.workers.length, channels: channelRows(workspace).length, crews: workspace.teams.length, running, colors };
  }

  /**
   * The spaces with their orglets and channels (docs/spaces-design.md), by name, channels in the order the space shows
   * them: directly in the space first, then each category in its order, each in the saved order of the channels.
   */
  async spaces(): Promise<SpacesValue> {
    const workspace = await this.workspace();
    const nameOf = (orgletId: string) => workspace.workers.find(worker => worker.id === orgletId)?.name;
    const names = (orgletIds: readonly string[]) => orgletIds.flatMap(orgletId => nameOf(orgletId) ?? []);
    const channels = listedChannels(workspace);
    return {
      spaces: (workspace.spaces ?? []).map(space => ({
        name: space.name,
        orglets: names(space.orgletIds),
        categories: space.categories.map(category => category.name),
        channels: channelsOfSpace(space, channels, workspace.channelOrder ?? []).map(entry => {
          const row = listedChannelRow(workspace, entry);
          return {
            name: row.name,
            mode: row.mode,
            ...(row.lead ? { lead: row.lead } : {}),
            ...(row.category ? { category: row.category } : {}),
            access: entry.channel.access ?? 'inherit',
            orglets: names(entry.channel.members.map(member => member.id)),
          };
        }),
      })),
    };
  }

  async list(): Promise<ListValue> {
    const workspace = await this.workspace();
    const nameOf = (id: string) => workspace.workers.find(worker => worker.id === id)?.name ?? id;
    // A custom connection reads as the name the person gave it, not as `custom:<id>`.
    const providerOf = (provider: string) => findCustomConnection(workspace.customConnections ?? [], provider)?.name ?? provider;
    const orglets = workspace.workers.map(worker => ({
      name: worker.name,
      provider: providerOf(worker.provider),
      providerId: worker.provider,
      ...modelField(worker, workspace),
      ...(worker.description ? { description: worker.description } : {}),
      billing: billingLabel(worker, workspace),
      color: defaultAvatarColor(worker),
    }));
    const crews = workspace.teams.map(team => ({
      name: team.name,
      lead: nameOf(team.synthesizerId),
      members: team.memberIds.map(nameOf),
      colors: crewRoster(team, workspace.workers).map(worker => defaultAvatarColor(worker)),
    }));
    return { orglets, channels: channelRows(workspace), crews };
  }

  /**
   * Sends one message the way the composer does: the chat's live row takes it as a new turn, or the first message
   * creates the row (a crew's row belongs to its lead). Consent and provider scopes are the non-Demo providers of the
   * orglets that will run, and the cost limit is the chat's own or the orglet's or crew's default. `replyTo` names a
   * message of the live chat the way `read --turns` numbers it (COD-354).
   */
  async send(request: Extract<CliRequest, { op: 'send' }>, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void): Promise<SendValue> {
    const feed = request.progress && request.wait && progress ? new CliActivityFeed(progress, this.dependencies.translate) : undefined;
    return this.sendTurn(request, signal, feed);
  }

  private async sendTurn(request: Extract<CliRequest, { op: 'send' }>, signal: AbortSignal, feed?: CliActivityFeed): Promise<SendValue> {
    const workspace = await this.workspace();
    const { chat, live, team, worker } = this.sendTarget(workspace, request);
    const replyTo = request.replyTo ? await this.replyTarget(live?.id, request.replyTo) : undefined;
    const sources = request.files.length ? await this.dependencies.request('importSources', request.files) as Source[] : [];
    const sourceIds = sources.map(source => source.id);
    const runners = live ? taskRunners(workspace, live) : team ? crewRoster(team, workspace.workers) : worker ? [worker] : [];
    const providerScopes = [...new Set(runners.map(item => item.provider).filter(provider => provider !== 'demo'))] as NonNullable<TaskInput['providerScopes']>;
    const unsubscribe = feed ? this.dependencies.observe?.(observation => feed.observe(observation)) : undefined;
    if (live) feed?.bind(live.id);
    if (unsubscribe) signal.addEventListener('abort', unsubscribe, { once: true });
    try {
      let taskId: string;
      if (live) {
        await this.dependencies.request('reviseTask', { taskId: live.id, brief: request.message, ...(replyTo ? { replyTo } : {}), sourceIds, excludedSources: [], consent: true, providerScopes, budgetMicros: live.budgetMicros });
        taskId = live.id;
      } else {
        const budgetMicros = (team ?? worker)?.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS;
        const owner = team ? { workerId: team.synthesizerId, teamId: team.id } : { workerId: chat.id };
        const input: TaskInput = { ...owner, brief: request.message, sourceIds, excludedSources: [], consent: true, providerScopes, budgetMicros };
        taskId = String(await this.dependencies.request('createTask', input));
      }
      feed?.bind(taskId);
      let detail = await this.taskDetail(taskId);
      const revision = detail.task.inputRevision ?? 0;
      if (!request.wait) return turnResult(chat, detail, revision, false, this.dependencies.translate);
      feed?.update(detail, revision);
      detail = await waitForTurn(this.dependencies, detail, request.timeoutSeconds, signal, feed, revision);
      return turnResult(chat, detail, revision, true, this.dependencies.translate);
    } finally {
      unsubscribe?.();
      if (unsubscribe) signal.removeEventListener('abort', unsubscribe);
    }
  }

  /**
   * The chat a message goes to: an orglet's or crew's main chat, which the first message creates, or any existing
   * chat by its id, such as a side thread or a channel (COD-354).
   */
  private sendTarget(workspace: Workspace, request: ChatTargetRequest): { chat: CliChat; live?: Task; team?: Team; worker?: Worker } {
    assertOneTarget(request);
    if (request.chat !== undefined) {
      const task = taskById(workspace, request.chat);
      return { chat: chatOfTask(workspace, task), live: task };
    }
    const chat = matchChat(request.to!, chatsOf(workspace));
    const team = chat.kind === 'team' ? workspace.teams.find(item => item.id === chat.id) : undefined;
    const worker = chat.kind === 'worker' ? workspace.workers.find(item => item.id === chat.id) : undefined;
    return { chat, live: liveChatTask(workspace, chat), team, worker };
  }

  /** The message id a reply points at; a chat with no conversation yet has nothing to reply to. */
  private async replyTarget(taskId: string | undefined, ref: string): Promise<string> {
    if (!taskId) throw new CliFailure('not_found', 'Chat này chưa có tin nhắn nào để trả lời.');
    return resolveMessage(await this.taskDetail(taskId), ref).messageId;
  }

  /**
   * The answers of the newest message in the chat that has any, with the chat's current status. With `turns`, also
   * that many numbered turns, the newest ones or those before `before` (COD-354).
   */
  async read(request: Extract<CliRequest, { op: 'read' }>): Promise<ReadValue> {
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, request);
    const detail = await this.taskDetail(task.id);
    const answers = turnAnswers(detail, latestAnsweredRevision(detail));
    const history = request.turns ? chatTurns(detail, request.turns, request.before) : undefined;
    const question = pendingQuestion(detail.task);
    return {
      chat,
      taskId: task.id,
      status: detail.task.status,
      answers,
      ...(history ? { turns: history.turns, earlier: history.earlier } : {}),
      ...(question ? { question } : {}),
      ...(waitsForDesktop(detail) ? { needsDesktop: true } : {}),
    };
  }

  /**
   * Starts a schedule now with the files given, through the same guards a scheduled run passes: it must be switched
   * on, approved as it is, and not still busy with its previous run. The core refuses anything else.
   */
  async runSchedule(request: Extract<CliRequest, { op: 'run' }>): Promise<RunValue> {
    const workspace = await this.workspace();
    const found = matchSchedule(request.schedule, workspace.routines);
    const routine = workspace.routines.find(item => item.id === found.id)!;
    if (!routine.enabled) throw new CliFailure('failed', `"${routine.name}" đang tắt. Bật lịch trong app rồi chạy lại.`);
    const sources = request.files.length ? await this.dependencies.request('importSources', request.files) as Source[] : [];
    const taskId = String(await this.dependencies.request('runRoutine', { id: routine.id, sourceIds: sources.map(source => source.id) }));
    return { schedule: { id: routine.id, name: routine.name }, taskId };
  }

  async open(to: string | undefined): Promise<OpenValue> {
    if (!to) {
      await this.dependencies.open();
      return {};
    }
    const workspace = await this.workspace();
    const chat = matchChat(to, chatsOf(workspace));
    await this.dependencies.open(chat);
    return { chat };
  }
}

function modelField(worker: Worker, workspace: Workspace): { model?: string } {
  const model = resolveWorkerModel(worker, undefined, workspace.customConnections ?? []).id;
  return model ? { model } : {};
}

function billingLabel(worker: Worker, workspace: Workspace): string {
  if (worker.provider === 'demo') return 'no model connected';
  if (isHarness(worker.provider)) return 'CLI account';
  if (isLocalApi(worker.provider)) return 'local';
  if (isPlanApi(worker.provider)) return 'provider plan';
  const connection = findCustomConnection(workspace.customConnections ?? [], worker.provider);
  if (connection) return connectionPricing(connection).kind === 'local' ? 'local' : 'provider billing';
  return 'API billing';
}
