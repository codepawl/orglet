import type { Task, TaskInput, Team, Worker, Workspace } from '../shared/contracts';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { ArchiveEntityValue, BringValue, ChatChangeValue, ChatsValue, CliChatRow, CliRequest, MembersValue, SendValue, TemplateValue } from '../cli/protocol';
import { chatKind, chatName, chatOfTask, chatsOf, CliFailure, matchChat, targetChat, taskById, taskRunners } from './cli-chats';
import { resolveMessage } from './cli-chat-history';
import { readTask, turnResult, waitForTurn, type CliDependencies } from './cli-turns';

/**
 * The chats themselves from the terminal (COD-354): listing them, side threads and group chats, renaming, archiving,
 * restoring and deleting a chat, archiving and restoring an orglet or crew, and a crew from a template. Each step is
 * the core command the desktop uses, with its guards. A side thread copies its main chat's permissions in the core,
 * never more; nothing here sets a permission, a folder or a browser.
 */

/** How many chats one `orglet chats` lists, newest first. */
const MAX_LISTED_CHATS = 200;
/** The characters of a chat id `orglet chats` prints, enough to tell chats apart. */
const SHORT_ID_LENGTH = 8;
const DEFAULT_TASK_BUDGET_MICROS = 500_000;

type Request<Op extends CliRequest['op']> = Extract<CliRequest, { op: Op }>;

function providerScopes(runners: readonly Worker[]): NonNullable<TaskInput['providerScopes']> {
  return [...new Set(runners.map(runner => runner.provider).filter(provider => provider !== 'demo'))] as NonNullable<TaskInput['providerScopes']>;
}

export class CliChatAdmin {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  /** Open chats newest first, or with `archived` the archived ones, each with the short id `--chat` takes. */
  async chats(request: Request<'chats'>): Promise<ChatsValue> {
    const workspace = await this.workspace();
    const shown = workspace.tasks.filter(task => Boolean(task.archivedAt) === request.archived);
    const newest = [...shown].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, MAX_LISTED_CHATS);
    return { chats: newest.map(task => chatRow(workspace, task)) };
  }

  /**
   * A message "in a new thread" from an orglet's main chat (COD-247), as the desktop's composer sends it. The core
   * copies the main chat's permissions, folder and MCP grants onto the side thread and never widens them.
   */
  async sideThread(request: Request<'side-thread'>, signal: AbortSignal): Promise<SendValue> {
    const workspace = await this.workspace();
    const { task } = targetChat(workspace, request);
    if (chatKind(task) !== 'orglet') throw new CliFailure('failed', 'Chat phụ chỉ bắt đầu từ chat chính của một Tí.');
    const runners = taskRunners(workspace, task);
    const sideId = String(await this.dependencies.request('startSideThread', {
      taskId: task.id,
      brief: request.message,
      sourceIds: [],
      excludedSources: [],
      consent: true,
      providerScopes: providerScopes(runners),
      budgetMicros: task.budgetMicros,
    }));
    return this.settle(sideId, request.wait, request.timeoutSeconds, signal);
  }

  /** Copies a side thread's answer into its main chat as a quote; it never starts a run there. */
  async bring(request: Request<'bring'>): Promise<BringValue> {
    const workspace = await this.workspace();
    const side = taskById(workspace, request.chat);
    if (!side.sideOf) throw new CliFailure('failed', 'Chỉ đưa được câu trả lời của chat phụ vào chat chính.');
    const message = resolveMessage(await readTask(this.dependencies.request, side.id), request.message);
    if (!message.ref.includes('.')) throw new CliFailure('failed', 'Chọn một câu trả lời, như 2.1; tin nhắn của bạn không đưa vào chat chính được.');
    const mainTaskId = String(await this.dependencies.request('bringIntoMainChat', { artifactId: message.messageId }));
    const main = (await this.workspace()).tasks.find(task => task.id === mainTaskId);
    const chat = main ? chatOfTask(workspace, main) : chatOfTask(workspace, side);
    return { mainTaskId, chat, ref: message.ref };
  }

  /**
   * Starts a group chat of these orglets with its first message, the way picking several orglets in the sidebar
   * does: every one answers, and the first one named owns the row. The next message goes in with `--chat`.
   */
  async group(request: Request<'group'>, signal: AbortSignal): Promise<SendValue> {
    const workspace = await this.workspace();
    const workers = uniqueWorkers(workspace, request.names);
    if (workers.length < 2) throw new CliFailure('failed', 'Chat nhóm cần ít nhất hai Tí khác nhau.');
    const input: TaskInput = {
      workerId: workers[0].id,
      assignees: workers.map(worker => worker.id),
      brief: request.message,
      sourceIds: [],
      excludedSources: [],
      consent: true,
      providerScopes: providerScopes(workers),
      budgetMicros: workers[0].taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS,
    };
    const taskId = String(await this.dependencies.request('createTask', input));
    return this.settle(taskId, request.wait, request.timeoutSeconds, signal);
  }

  /** Changes who a group chat's messages go to, from the next message on, as the chat's settings do. */
  async members(request: Request<'members'>): Promise<MembersValue> {
    const workspace = await this.workspace();
    const task = taskById(workspace, request.chat);
    if (chatKind(task) !== 'group') throw new CliFailure('failed', 'Chỉ đổi được thành viên của chat nhóm.');
    const workers = uniqueWorkers(workspace, request.names);
    if (workers.length < 2) throw new CliFailure('failed', 'Chat nhóm cần ít nhất hai Tí khác nhau.');
    await this.dependencies.request('updateTask', {
      id: task.id,
      title: task.title ?? '',
      assignee: { kind: 'workers', workerIds: workers.map(worker => worker.id) },
      budgetMicros: task.budgetMicros,
    });
    return { taskId: task.id, names: workers.map(worker => worker.name) };
  }

  /** Renames, archives, restores or deletes one chat; deleting needs the chat's displayed name typed out. */
  async change(request: Request<'chat-change'>): Promise<ChatChangeValue> {
    const workspace = await this.workspace();
    if (request.change === 'restore' && request.to !== undefined) throw new CliFailure('invalid', 'Khôi phục chat bằng --chat <mã>; orglet chats --archived liệt kê chat đã lưu trữ.');
    const { task } = targetChat(workspace, request);
    const name = chatName(workspace, task);
    const value = { taskId: task.id, name, change: request.change };
    if (request.change === 'rename') {
      if (!request.title) throw new CliFailure('invalid', 'Đổi tên cần --title "<tên mới>".');
      await this.dependencies.request('renameTask', { id: task.id, title: request.title });
      return { ...value, title: request.title };
    }
    if (request.change === 'delete') {
      if (request.confirmName !== name) throw new CliFailure('failed', `Gõ đúng tên chat để xác nhận xóa: ${name}`);
      await this.dependencies.request('deleteTask', { id: task.id });
      return value;
    }
    await this.dependencies.request('archiveTask', { id: task.id, archived: request.change === 'archive' });
    return value;
  }

  /** Archives an active orglet or crew, or restores an archived one, by its full name; the core's guards still apply. */
  async archiveEntity(request: Request<'archive-entity'>): Promise<ArchiveEntityValue> {
    const workspace = await this.workspace();
    const candidates: readonly (Worker | Team)[] = request.kind === 'worker'
      ? request.archived ? workspace.workers : workspace.archivedWorkers
      : request.archived ? workspace.teams : workspace.archivedTeams;
    const wanted = request.name.toLocaleLowerCase();
    const matches = candidates.filter(entity => entity.name.toLocaleLowerCase() === wanted);
    if (matches.length > 1) throw new CliFailure('ambiguous', `"${request.name}" là tên của nhiều mục. Đổi tên trong app để phân biệt.`);
    if (matches.length === 0) throw new CliFailure('not_found', request.archived ? `Không có mục đang hoạt động nào tên "${request.name}".` : `Không có mục đã lưu trữ nào tên "${request.name}".`);
    const entity = matches[0];
    await this.dependencies.request('archiveEntity', { kind: request.kind, id: entity.id, archived: request.archived });
    return { kind: request.kind, id: entity.id, name: entity.name, archived: request.archived };
  }

  /** A crew with its orglets and skill from one of the app's templates, on Demo or the OpenAI connection. */
  async template(request: Request<'template'>): Promise<TemplateValue> {
    const team = await this.dependencies.request('createTemplate', { templateId: request.templateId, provider: request.provider }) as Team;
    const workspace = await this.workspace();
    const roster = [...team.memberIds, team.synthesizerId].map(id => workspace.workers.find(worker => worker.id === id)?.name ?? id);
    return { id: team.id, name: team.name, members: roster };
  }

  private async settle(taskId: string, wait: boolean, timeoutSeconds: number, signal: AbortSignal): Promise<SendValue> {
    let detail = await readTask(this.dependencies.request, taskId);
    const revision = detail.task.inputRevision ?? 0;
    if (wait) detail = await waitForTurn(this.dependencies, detail, timeoutSeconds, signal, undefined, revision);
    const workspace = await this.workspace();
    const task = workspace.tasks.find(item => item.id === taskId) ?? detail.task;
    return turnResult(chatOfTask(workspace, task), detail, revision, wait, this.dependencies.translate);
  }
}

/** The orglets these names find, each once, in the order named; a crew's name is not an orglet. */
function uniqueWorkers(workspace: Workspace, names: readonly string[]): Worker[] {
  const orglets = chatsOf({ workers: workspace.workers, teams: [] });
  const found = names.map(name => matchChat(name, orglets));
  const ids = [...new Set(found.map(chat => chat.id))];
  return ids.map(id => workspace.workers.find(worker => worker.id === id)!);
}

function chatRow(workspace: Workspace, task: Task): CliChatRow {
  const runners = taskRunners(workspace, task);
  const lead = runners.at(-1);
  return {
    id: task.id,
    short: task.id.slice(0, SHORT_ID_LENGTH),
    kind: chatKind(task),
    name: chatName(workspace, task),
    with: runners.map(runner => runner.name),
    status: task.status,
    archived: Boolean(task.archivedAt),
    createdAt: task.createdAt,
    ...(lead ? { color: defaultAvatarColor(lead) } : {}),
  };
}
