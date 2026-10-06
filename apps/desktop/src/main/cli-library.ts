import type { ProviderId, Workspace } from '../shared/contracts';
import type { ChatSearchResult } from '../shared/chat-search';
import type { HarnessUsage } from '../shared/harness';
import type { Knowledge } from '../shared/knowledge';
import type { ModelListResult } from '../shared/models';
import { maskEmail } from '../shared/pii';
import type { RunningItem } from '../shared/running';
import type { CliLibraryRow, CliRequest, CliRunningRow, LibraryValue, ModelsValue, PreferencesValue, RunningValue, SearchValue, UsageValue } from '../cli/protocol';
import { chatName, chatsOf, CliFailure, matchChat } from './cli-chats';
import { spaceNamed } from './cli-spaces';
import type { CliDependencies } from './cli-turns';

/**
 * Reading across the app from the terminal (COD-354): searching every chat, the Running view, the Library's notes and
 * memories, plan usage and model lists, and the two preferences a terminal person changes most, language and theme.
 * Editing or deleting a memory is allowed only for one already approved: a memory an orglet merely proposed is a
 * knowledge proposal, and approving or rejecting those stays in the desktop.
 */

type Request<Op extends CliRequest['op']> = Extract<CliRequest, { op: Op }>;

/** The characters of an id the terminal prints, enough to tell rows apart. */
const SHORT_ID_LENGTH = 8;

export class CliLibrary {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  /** Every message, answer and chat, orglet and crew name, the way the desktop's search finds them. */
  async search(request: Request<'search'>): Promise<SearchValue> {
    const workspace = await this.workspace();
    const result = await this.dependencies.request('searchChats', { query: request.query }) as ChatSearchResult;
    // In one space only its channels' messages count; an orglet or channel found by name belongs to no space.
    const space = request.space === undefined ? undefined : spaceNamed(workspace, request.space);
    const inSpace = (taskId: string) => !space || workspace.tasks.find(item => item.id === taskId)?.channel?.spaceId === space.id;
    const nameOf = (id: string) => workspace.workers.find(worker => worker.id === id)?.name ?? workspace.teams.find(team => team.id === id)?.name ?? id;
    const chats = result.chats.filter(hit => inSpace(hit.taskId)).map(hit => {
      const task = workspace.tasks.find(item => item.id === hit.taskId);
      const sender = hit.sender?.kind === 'orglet' ? hit.sender.name : hit.sender ? 'you' : undefined;
      return {
        chat: hit.taskId.slice(0, SHORT_ID_LENGTH),
        name: task ? chatName(workspace, task) : hit.taskId,
        ...(sender ? { sender } : {}),
        snippet: hit.snippet.map(part => part.text).join(''),
        at: hit.at,
      };
    });
    return { orglets: space ? [] : result.orgletIds.map(nameOf), crews: space ? [] : result.crewIds.map(nameOf), chats, indexing: result.indexing };
  }

  /** Every run working, waiting its turn or stopped at a checkpoint, across chats, as the Running view lists them. */
  async running(request: Request<'running'>): Promise<RunningValue> {
    const workspace = await this.workspace();
    const space = request.space === undefined ? undefined : spaceNamed(workspace, request.space);
    const items = (workspace.running ?? []).filter(item => !space || workspace.tasks.find(task => task.id === item.taskId)?.channel?.spaceId === space.id);
    return { items: items.map(item => runningRow(workspace, item)) };
  }

  /** Notes or memories, every approved and proposed one, or what a search finds; optionally only one orglet's or crew's. */
  async library(request: Request<'library'>): Promise<LibraryValue> {
    const workspace = await this.workspace();
    const found = request.query ? await this.dependencies.request('searchKnowledge', { query: request.query }) as Knowledge[] : workspace.knowledge;
    const owner = request.owner ? matchChat(request.owner, chatsOf(workspace)) : undefined;
    const kind = request.kind === 'memory' ? 'memory' : 'note';
    const rows = found.filter(item => (item.kind ?? 'note') === kind && item.status !== 'archived').filter(item => !owner || item.scope.type !== 'workspace' && item.scope.id === owner.id);
    return { items: rows.map(item => libraryRow(workspace, item)) };
  }

  /** New text or a pin for an approved memory, as the Memory tab saves it: a new revision. */
  async editMemory(request: Request<'memory-edit'>): Promise<LibraryValue> {
    const workspace = await this.workspace();
    const memory = approvedMemory(workspace, request.id);
    const updated = await this.dependencies.request('updateMemory', { id: memory.id, ...(request.text ? { text: request.text } : {}), ...(request.pinned !== undefined ? { pinned: request.pinned } : {}) }) as Knowledge;
    return { items: [libraryRow(workspace, updated)] };
  }

  /** Deletes an approved memory for good, revisions and all, as the Memory tab does. */
  async deleteMemory(request: Request<'memory-delete'>): Promise<LibraryValue> {
    const workspace = await this.workspace();
    const memory = approvedMemory(workspace, request.id);
    if (!request.confirmed && !confirmsMemory(memory, request.confirm)) {
      throw new CliFailure('failed', 'Gõ đúng mã hoặc nội dung của ghi nhớ trong --confirm để xác nhận xóa.');
    }
    await this.dependencies.request('deleteMemory', { id: memory.id });
    return { items: [libraryRow(workspace, memory)] };
  }

  /** Plan usage of every signed-in harness account; emails show only in part, as everywhere on screen. */
  async usage(request: Request<'usage'>): Promise<UsageValue> {
    const usage = await this.dependencies.request('harnessUsage', { refresh: request.refresh }) as HarnessUsage;
    const accounts = Object.entries(usage).flatMap(([harness, rows]) => (rows ?? []).map(row => ({
      harness,
      ...(row.email ? { email: maskEmail(row.email) } : {}),
      ...(row.plan ? { plan: row.plan } : {}),
      windows: row.windows.map(window => ({ kind: window.kind, usedPercent: window.usedPercent, ...(window.model ? { model: window.model } : {}), ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}) })),
      ...(row.unavailable ? { unavailable: row.unavailable } : {}),
      ...(row.asOf ? { asOf: row.asOf } : {}),
    })));
    return { accounts };
  }

  /** The models a connection offers, for a provider by id or for the one an orglet uses. */
  async models(request: Request<'models'>): Promise<ModelsValue> {
    const workspace = await this.workspace();
    const provider = request.provider ?? orgletProvider(workspace, request.to);
    const result = await this.dependencies.request('modelList', { provider, ...(request.refresh ? { refresh: true } : {}) }) as ModelListResult;
    const models = result.models.map(model => ({ id: model.id, ...(model.displayName ? { name: model.displayName } : {}), ...(model.deprecated ? { deprecated: true } : {}) }));
    return { provider, models, fetchedAt: result.fetchedAt, stale: result.stale, ...(result.error ? { error: this.dependencies.translate(result.error) } : {}) };
  }

  /** Shows the language and theme, and changes either; every other setting stays as it is. */
  async preferences(request: Request<'preferences'>): Promise<PreferencesValue> {
    const workspace = await this.workspace();
    const changes = { ...(request.language ? { language: request.language } : {}), ...(request.theme ? { theme: request.theme } : {}) };
    if (Object.keys(changes).length) {
      const settings = { theme: workspace.theme, connectionLimitMicros: workspace.connectionLimitMicros, ...changes };
      await this.dependencies.request('settings', settings);
      this.dependencies.settingsChanged?.(changes);
    }
    return { language: request.language ?? workspace.language, theme: request.theme ?? workspace.theme };
  }
}

/** A memory by the start of its id, which has to be approved: a proposed one is reviewed in the desktop. */
function approvedMemory(workspace: Workspace, prefix: string): Knowledge {
  const wanted = prefix.trim().replace(/^#/, '').toLowerCase();
  const matches = workspace.knowledge.filter(item => item.kind === 'memory' && item.status !== 'archived' && item.id.toLowerCase().startsWith(wanted));
  if (matches.length > 1) throw new CliFailure('ambiguous', `Mã "${wanted}" khớp với nhiều ghi nhớ. Gõ thêm vài ký tự.`);
  if (matches.length === 0) throw new CliFailure('not_found', `Không có ghi nhớ nào có mã "${wanted}". Lệnh orglet library memory liệt kê chúng.`);
  if (matches[0].status !== 'approved') throw new CliFailure('failed', 'Ghi nhớ này đang chờ duyệt. Duyệt hoặc bỏ nó trong Thư viện của app.');
  return matches[0];
}

/** Whether what was typed to confirm a delete is the memory's id (whole, or as the terminal prints it) or its exact text. */
function confirmsMemory(memory: Knowledge, typed: string | undefined): boolean {
  if (typed === undefined) return false;
  const wanted = typed.trim();
  const idMatches = [memory.id, memory.id.slice(0, SHORT_ID_LENGTH)].some(id => id.toLowerCase() === wanted.replace(/^#/, '').toLowerCase());
  return idMatches || wanted === memory.content.trim();
}

function orgletProvider(workspace: Workspace, to: string | undefined): ProviderId {
  if (!to) throw new CliFailure('invalid', 'Gõ một provider, hoặc --to <tên Tí> để dùng kết nối của Tí đó.');
  const chat = matchChat(to, chatsOf({ workers: workspace.workers, teams: [] }));
  return workspace.workers.find(worker => worker.id === chat.id)!.provider;
}

function ownerName(workspace: Workspace, item: Knowledge): string | undefined {
  if (item.scope.type === 'workspace') return undefined;
  const id = item.scope.id;
  return workspace.workers.find(worker => worker.id === id)?.name ?? workspace.teams.find(team => team.id === id)?.name;
}

function libraryRow(workspace: Workspace, item: Knowledge): CliLibraryRow {
  const owner = ownerName(workspace, item);
  return {
    id: item.id,
    short: item.id.slice(0, SHORT_ID_LENGTH),
    kind: item.kind ?? 'note',
    title: item.title,
    content: item.content,
    status: item.status,
    pinned: item.pinned,
    ...(owner ? { owner } : {}),
    createdAt: item.createdAt,
  };
}

function runningRow(workspace: Workspace, item: RunningItem): CliRunningRow {
  const task = workspace.tasks.find(row => row.id === item.taskId);
  return {
    chat: item.taskId.slice(0, SHORT_ID_LENGTH),
    name: task ? chatName(workspace, task) : item.taskId,
    orglet: item.worker.name,
    state: item.state,
    provider: item.provider,
    ...(item.wait ? { waitsFor: item.wait.kind } : {}),
    ...(item.since ? { since: new Date(item.since).toISOString() } : {}),
  };
}
