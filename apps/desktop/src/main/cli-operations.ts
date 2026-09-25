import type { Source, Task, TaskDetail, TaskInput, TaskStatus, Team, Worker, Workspace } from '../shared/contracts';
import { liveTeamTask, liveWorkerTask } from '../shared/live-task';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliAnswer, CliChat, CliErrorCode, CliRequest, ListValue, OpenValue, ReadValue, SendValue, StatusValue } from '../cli/protocol';
import { findCustomConnection } from '../shared/custom-connections';

/**
 * What each `orglet` command does inside the app (COD-234). Every step goes through the same core commands the
 * window uses, so a message sent from a terminal is the same turn the composer would have made. Nothing here imports
 * Electron: main passes the core request, the app version, the window opener and the translator in.
 */

/** A failure the CLI shows as is. The message is a Vietnamese source string that the server translates. */
export class CliFailure extends Error {
  constructor(readonly code: CliErrorCode, message: string) {
    super(message);
  }
}

export type CoreRequest = (command: string, args: unknown) => Promise<unknown>;

export type CliDependencies = {
  request: CoreRequest;
  version: () => string;
  /** Brings the window forward and, with a chat, opens it. */
  open: (chat?: CliChat) => void;
  /** Puts a run's Vietnamese error into the app's language. */
  translate: (message: string) => string;
  /** How often `send` reads the chat while it waits. */
  pollMilliseconds?: number;
};

/** Statuses of a turn that is still going; anything else means the turn has stopped. */
const RUNNING_STATUSES: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
const DEFAULT_TASK_BUDGET_MICROS = 500_000;
const DEFAULT_POLL_MILLISECONDS = 750;

export function isTurnRunning(task: Pick<Task, 'status' | 'pendingStart'>): boolean {
  return RUNNING_STATUSES.includes(task.status) || Boolean(task.pendingStart);
}

/**
 * Finds an orglet or crew by name: a case-insensitive exact name first, then a unique prefix. Two chats with the
 * same exact name, or a prefix several names share, is ambiguous and lists them; no match lists every name.
 */
export function matchChat(query: string, chats: readonly CliChat[]): CliChat {
  const wanted = query.trim().toLocaleLowerCase();
  const exact = chats.filter(chat => chat.name.toLocaleLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new CliFailure('ambiguous', `"${exact[0].name}" là tên của nhiều Tí hoặc hội. Đổi tên trong app để phân biệt.`);
  const prefixed = chats.filter(chat => chat.name.toLocaleLowerCase().startsWith(wanted));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) throw ambiguous(query, prefixed);
  const names = chats.map(chat => chat.name).join(', ');
  return notFound(query, names);
}

function ambiguous(query: string, candidates: readonly CliChat[]): CliFailure {
  const names = candidates.map(chat => chat.name).join(', ');
  return new CliFailure('ambiguous', `"${query}" khớp với nhiều tên: ${names}. Gõ tên đầy đủ hơn.`);
}

function notFound(query: string, names: string): never {
  if (!names) throw new CliFailure('not_found', 'Chưa có Tí hay hội nào.');
  throw new CliFailure('not_found', `Không có Tí hay hội nào tên "${query}". Có: ${names}.`);
}

export function chatsOf(workspace: Pick<Workspace, 'workers' | 'teams'>): CliChat[] {
  const orglets = workspace.workers.map(worker => orgletChat(worker));
  const crews = workspace.teams.map(team => crewChat(team, workspace.workers));
  return [...orglets, ...crews];
}

function orgletChat(worker: Worker): CliChat {
  return { kind: 'worker', id: worker.id, name: worker.name, color: defaultAvatarColor(worker) };
}

function crewChat(team: Team, workers: readonly Worker[]): CliChat {
  const lead = workers.find(worker => worker.id === team.synthesizerId);
  const colors = crewRoster(team, workers).map(worker => defaultAvatarColor(worker));
  return { kind: 'team', id: team.id, name: team.name, ...(lead ? { color: defaultAvatarColor(lead) } : {}), colors };
}

/** Members then the lead, without repeats, in crew order: the orglets a crew message runs. */
function crewRoster(team: Pick<Team, 'memberIds' | 'synthesizerId'>, workers: readonly Worker[]): Worker[] {
  const ids = [...new Set([...team.memberIds, team.synthesizerId])];
  return ids.map(id => workers.find(worker => worker.id === id)).filter((worker): worker is Worker => Boolean(worker));
}

/** The text of one saved answer: a chat reply as written, a report as its title over its summary. */
export function answerText(report: TaskDetail['artifacts'][number]['report']): string {
  if (report.format === 'chat') return report.summary;
  return `${report.title}\n\n${report.summary}`;
}

/**
 * The answers one message produced: every saved answer of a run started for that message, oldest first, named after
 * the orglet that wrote it. A crew turn gives each member's result and then the lead's combined answer.
 */
export function turnAnswers(detail: Pick<TaskDetail, 'runs' | 'artifacts'>, revision: number): CliAnswer[] {
  const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
  const answers = detail.artifacts.flatMap(artifact => {
    const run = runs.find(candidate => candidate.id === artifact.runId);
    if (!run) return [];
    const author = run.snapshot.worker;
    return [{ name: author.name, stage: run.stage, text: answerText(artifact.report), createdAt: artifact.createdAt, color: defaultAvatarColor(author) }];
  });
  return answers.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/** Why runs of this message stopped short, for a turn that failed. */
export function turnErrors(detail: Pick<TaskDetail, 'runs'>, revision: number): string[] {
  const failed = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision && run.error);
  return [...new Set(failed.map(run => run.error as string))];
}

/** The newest message in the chat that has at least one answer, or the current one when none has. */
export function latestAnsweredRevision(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts'>): number {
  const answered = detail.artifacts.flatMap(artifact => {
    const run = detail.runs.find(candidate => candidate.id === artifact.runId);
    return run ? [run.snapshot.inputRevision ?? 0] : [];
  });
  if (answered.length === 0) return detail.task.inputRevision ?? 0;
  return Math.max(...answered);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class CliOperations {
  constructor(private readonly dependencies: CliDependencies) {}

  async run(request: CliRequest, signal: AbortSignal): Promise<unknown> {
    switch (request.op) {
      case 'status': return this.status();
      case 'list': return this.list();
      case 'send': return this.send(request, signal);
      case 'read': return this.read(request.to);
      case 'open': return this.open(request.to);
    }
  }

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  private taskDetail(id: string): Promise<TaskDetail> {
    return this.dependencies.request('task', { id }) as Promise<TaskDetail>;
  }

  async status(): Promise<StatusValue> {
    const workspace = await this.workspace();
    const running = workspace.tasks.filter(task => !task.deletedAt && !task.archivedAt && isTurnRunning(task)).length;
    const colors = workspace.workers.map(worker => defaultAvatarColor(worker));
    return { version: this.dependencies.version(), orglets: workspace.workers.length, crews: workspace.teams.length, running, colors };
  }

  async list(): Promise<ListValue> {
    const workspace = await this.workspace();
    const nameOf = (id: string) => workspace.workers.find(worker => worker.id === id)?.name ?? id;
    // A custom connection reads as the name the person gave it, not as `custom:<id>`.
    const providerOf = (provider: string) => findCustomConnection(workspace.customConnections ?? [], provider)?.name ?? provider;
    const orglets = workspace.workers.map(worker => ({
      name: worker.name,
      provider: providerOf(worker.provider),
      ...(worker.modelId ? { model: worker.modelId } : {}),
      color: defaultAvatarColor(worker),
    }));
    const crews = workspace.teams.map(team => ({
      name: team.name,
      lead: nameOf(team.synthesizerId),
      members: team.memberIds.map(nameOf),
      colors: crewRoster(team, workspace.workers).map(worker => defaultAvatarColor(worker)),
    }));
    return { orglets, crews };
  }

  /**
   * Sends one message the way the composer does: the chat's live row takes it as a new turn, or the first message
   * creates the row (a crew's row belongs to its lead). Consent and provider scopes are the non-Demo providers of the
   * orglets that will run, and the cost limit is the chat's own or the orglet's or crew's default.
   */
  async send(request: Extract<CliRequest, { op: 'send' }>, signal: AbortSignal): Promise<SendValue> {
    const workspace = await this.workspace();
    const chat = matchChat(request.to, chatsOf(workspace));
    const sources = request.files.length ? await this.dependencies.request('importSources', request.files) as Source[] : [];
    const sourceIds = sources.map(source => source.id);
    const team = chat.kind === 'team' ? workspace.teams.find(item => item.id === chat.id) : undefined;
    const worker = chat.kind === 'worker' ? workspace.workers.find(item => item.id === chat.id) : undefined;
    const runners = team ? crewRoster(team, workspace.workers) : worker ? [worker] : [];
    const providerScopes = [...new Set(runners.map(item => item.provider).filter(provider => provider !== 'demo'))] as NonNullable<TaskInput['providerScopes']>;
    const live = team ? liveTeamTask(workspace.tasks, team.id) : liveWorkerTask(workspace.tasks, chat.id);
    let taskId: string;
    if (live) {
      await this.dependencies.request('reviseTask', { taskId: live.id, brief: request.message, sourceIds, excludedSources: [], consent: true, providerScopes, budgetMicros: live.budgetMicros });
      taskId = live.id;
    } else {
      const budgetMicros = (team ?? worker)?.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS;
      const owner = team ? { workerId: team.synthesizerId, teamId: team.id } : { workerId: chat.id };
      const input: TaskInput = { ...owner, brief: request.message, sourceIds, excludedSources: [], consent: true, providerScopes, budgetMicros };
      taskId = String(await this.dependencies.request('createTask', input));
    }
    let detail = await this.taskDetail(taskId);
    const revision = detail.task.inputRevision ?? 0;
    if (!request.wait) {
      return { chat, taskId, waited: false, finished: false, status: detail.task.status, answers: [], errors: [] };
    }
    detail = await this.waitForTurn(taskId, detail, request.timeoutSeconds, signal);
    const finished = !isTurnRunning(detail.task);
    const errors = finished ? turnErrors(detail, revision).map(error => this.dependencies.translate(error)) : [];
    return { chat, taskId, waited: true, finished, status: detail.task.status, answers: turnAnswers(detail, revision), errors };
  }

  private async waitForTurn(taskId: string, first: TaskDetail, timeoutSeconds: number, signal: AbortSignal): Promise<TaskDetail> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    const interval = this.dependencies.pollMilliseconds ?? DEFAULT_POLL_MILLISECONDS;
    let detail = first;
    while (isTurnRunning(detail.task) && Date.now() < deadline && !signal.aborted) {
      await delay(interval);
      detail = await this.taskDetail(taskId);
    }
    return detail;
  }

  /** The answers of the newest message in the chat that has any, with the chat's current status. */
  async read(to: string): Promise<ReadValue> {
    const workspace = await this.workspace();
    const chat = matchChat(to, chatsOf(workspace));
    const live = chat.kind === 'team' ? liveTeamTask(workspace.tasks, chat.id) : liveWorkerTask(workspace.tasks, chat.id);
    if (!live) throw new CliFailure('not_found', `Chưa có cuộc trò chuyện với ${chat.name}.`);
    const detail = await this.taskDetail(live.id);
    const answers = turnAnswers(detail, latestAnsweredRevision(detail));
    return { chat, taskId: live.id, status: detail.task.status, answers };
  }

  async open(to: string | undefined): Promise<OpenValue> {
    if (!to) {
      this.dependencies.open();
      return {};
    }
    const workspace = await this.workspace();
    const chat = matchChat(to, chatsOf(workspace));
    this.dependencies.open(chat);
    return { chat };
  }
}
