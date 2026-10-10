import type { Source, Workspace } from '../shared/contracts';
import type { HarnessInfo } from '../shared/harness';
import type { BrowserAction } from '../shared/browser';
import type { DesktopAction } from '../shared/desktop';
import type { WorkspaceRecoveryView } from '../shared/workspace-recovery';
import type { MarketInstallation, MarketUpdateRecord } from '../shared/market';
import type { CliRequest, MarketUpdatesValue, ShowRow, ShowValue, UpdateCheckValue } from '../cli/protocol';
import type { UpdateState } from '../shared/updates';
import { CliFailure, targetChat } from './cli-chats';
import type { CliDependencies } from './cli-turns';

/**
 * What the terminal may look at without changing anything (issue 554, phase 2): which connections and sign-ins exist,
 * what was spent, the release notes, the updater, a chat's browser and desktop journals, its sources and what its runs
 * changed in the working folder. Nothing here returns a key, a token, a review token, a file's content or the path a
 * file was picked from; applying or discarding changes stays in the window.
 */

type Request<Op extends CliRequest['op']> = Extract<CliRequest, { op: Op }>;

/** How many rows of one journal or change list the terminal prints, newest last. */
const MAX_ROWS = 200;
const MAX_RELEASES = 10;

const NO_APP_STATE = 'Chỉ đọc được mục này khi app đang chạy đầy đủ.';

export class CliInspect {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  async show(request: Request<'show'>): Promise<ShowValue> {
    switch (request.what) {
      case 'connections': return this.connections();
      case 'spend': return this.spend();
      case 'changelog': return this.changelog(request.refresh);
      case 'update': return { what: 'update', rows: [updateRow(this.app().updateState())] };
      case 'browser': return this.browserJournal(request);
      case 'desktop': return this.desktopJournal(request);
      case 'sources': return this.sources(request);
      case 'changes': return this.changes(request);
      case 'terminal': return this.terminal();
    }
  }

  /** Looks for an update and says what it found. Installing the one it downloads stays a click in the window. */
  async checkForUpdates(): Promise<UpdateCheckValue> {
    const app = updateRow(this.app().checkForUpdates()) as UpdateCheckValue;
    return { ...app, market: await this.marketUpdates() };
  }

  /** The Marketplace items with a newer version, and what the automatic path did; a core that cannot say adds nothing. */
  private async marketUpdates(): Promise<MarketUpdatesValue> {
    const installations = await this.dependencies.request('marketInstallations', {}) as MarketInstallation[];
    const records = await this.dependencies.request('marketUpdateRecords', {}) as MarketUpdateRecord[];
    return {
      available: installations.filter(item => item.updateAvailable).map(item => ({ id: item.listingId, name: item.name, kind: item.kind, version: item.version, ...(item.latestVersion ? { latestVersion: item.latestVersion } : {}) })),
      records: records.map(record => ({
        name: record.name, status: record.status, version: record.toVersion, changed: record.changed,
        ...(record.reason ? { reason: this.dependencies.translate(record.reason) } : {}),
        ...(record.block ? { block: record.block } : {}),
      })),
    };
  }

  private app() {
    if (!this.dependencies.app) throw new CliFailure('failed', NO_APP_STATE);
    return this.dependencies.app;
  }

  /** Which keys are saved and which CLI accounts are signed in, as yes or no. */
  private async connections(): Promise<ShowValue> {
    const saved = await this.app().connections();
    const workspace = await this.workspace();
    const rows: ShowRow[] = [];
    for (const [provider, isSaved] of Object.entries(saved)) {
      if (provider === 'custom' || provider === 'search') continue;
      // The router connection exists only in a build that names a router; the window is where it is set up.
      if (provider === 'codepawl' && !isSaved) continue;
      rows.push({ connection: provider, kind: 'key', saved: Boolean(isSaved) });
    }
    for (const connection of workspace.customConnections ?? []) {
      rows.push({ connection: connection.name, kind: 'custom', saved: Boolean(saved.custom?.[connection.id]) });
    }
    for (const [provider, isSaved] of Object.entries(saved.search ?? {})) rows.push({ connection: provider, kind: 'search', saved: Boolean(isSaved) });
    const harnesses = await this.dependencies.request('harnesses', { refresh: false }) as HarnessInfo[];
    for (const harness of harnesses) rows.push({ connection: harness.name, kind: 'sign-in', status: harness.status });
    return { what: 'connections', rows };
  }

  /** Spend and what is held back for runs that have not settled, in integer millionths of a USD. */
  private async spend(): Promise<ShowValue> {
    const workspace = await this.workspace();
    const usage = workspace.usage;
    const unresolved = (workspace.budgetReservations ?? []).filter(item => !item.resolvedAt).length;
    const row: ShowRow = {
      chargedMicros: usage.chargedMicros,
      reservedMicros: usage.reservedMicros,
      uncertainCount: usage.uncertainCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      connectionLimitMicros: workspace.connectionLimitMicros,
      unsettledReservations: unresolved,
    };
    return { what: 'spend', rows: [row] };
  }

  private async changelog(refresh: boolean): Promise<ShowValue> {
    const changelog = await this.app().changelog(refresh);
    const rows = changelog.releases.slice(0, MAX_RELEASES).map(release => ({ version: release.version, name: release.name, publishedAt: release.publishedAt, url: release.url }));
    const note = changelog.error ?? (changelog.stale ? this.dependencies.translate('Danh sách có thể đã cũ.') : undefined);
    return { what: 'changelog', rows, ...(note ? { note } : {}) };
  }

  private async browserJournal(request: Request<'show'>): Promise<ShowValue> {
    const taskId = await this.chatOf(request);
    const actions = await this.dependencies.request('browserActions', { taskId }) as BrowserAction[];
    const rows = actions.slice(-MAX_ROWS).map(action => ({ at: action.at, kind: action.kind, origin: action.origin, target: action.target, risk: action.risk, outcome: action.outcome }));
    return { what: 'browser', rows };
  }

  private async desktopJournal(request: Request<'show'>): Promise<ShowValue> {
    const taskId = await this.chatOf(request);
    const actions = await this.dependencies.request('desktopActions', { taskId }) as DesktopAction[];
    const rows = actions.slice(-MAX_ROWS).map(action => ({ at: action.at, kind: action.kind, program: action.program, window: action.window, target: action.target, risk: action.risk, outcome: action.outcome }));
    return { what: 'desktop', rows };
  }

  /** The chat's sources by name and size; where each file was picked from is for the person's eyes only. */
  private async sources(request: Request<'show'>): Promise<ShowValue> {
    const workspace = await this.workspace();
    const { task } = targetChat(workspace, request);
    const sources = task.sourceIds.length ? await this.dependencies.request('sourceMetadata', { ids: task.sourceIds.slice(0, 20) }) as Source[] : [];
    const rows = sources.map(source => ({ name: source.name, bytes: source.bytes, revoked: source.revoked, format: source.format ?? source.media ?? null }));
    return { what: 'sources', rows, ...(task.sourceIds.length > 20 ? { note: this.dependencies.translate(`Chỉ hiện 20 trên ${task.sourceIds.length} nguồn.`) } : {}) };
  }

  /**
   * What the chat's runs changed in the working folder, by working copy, and the copies still there to recover.
   * Reading only: the review token that applies or discards a hand-in is not returned.
   */
  private async changes(request: Request<'show'>): Promise<ShowValue> {
    const taskId = await this.chatOf(request);
    const view = await this.dependencies.request('workspaceRecovery', { taskId }) as WorkspaceRecoveryView;
    const rows: ShowRow[] = [];
    for (const copy of view.copies) {
      rows.push({ run: copy.runId.slice(0, 8), copy: copy.state, kind: copy.kind, review: copy.review?.state ?? null, files: copy.changeCount, path: null, status: null });
      for (const change of copy.changes.slice(0, MAX_ROWS)) {
        rows.push({ run: copy.runId.slice(0, 8), copy: null, kind: change.kind ?? 'write', review: null, files: null, path: change.path, status: change.status });
      }
    }
    const translate = this.dependencies.translate;
    const notes = [
      view.processes.length ? translate(`${view.processes.length} lệnh đã chạy`) : '',
      view.uncertainCalls.length ? translate(`${view.uncertainCalls.length} lệnh chưa rõ kết quả`) : '',
      view.truncated ? translate('Danh sách bị cắt bớt.') : '',
    ].filter(Boolean);
    return { what: 'changes', rows, ...(notes.length ? { note: notes.join('; ') } : {}) };
  }

  /** What the terminal did while acting for the person, newest first: the same list as Settings. Reading only. */
  private async terminal(): Promise<ShowValue> {
    const journal = this.dependencies.terminalAccess?.journal;
    const rows = journal ? await journal.list(MAX_ROWS) : [];
    return { what: 'terminal', rows: rows.map(row => ({ at: row.at, scope: row.scope, operation: row.operation, subject: row.subject ?? null, outcome: row.outcome })) };
  }

  private async chatOf(request: Request<'show'>): Promise<string> {
    const workspace = await this.workspace();
    return targetChat(workspace, request).task.id;
  }
}

function updateRow(state: UpdateState): ShowRow & UpdateCheckValue {
  const version = state.status === 'ready' && state.version ? state.version : undefined;
  const checkedAt = 'checkedAt' in state ? state.checkedAt : undefined;
  const message = state.status === 'error' ? state.message : state.status === 'unsupported' ? state.reason : undefined;
  return { status: state.status, ...(version ? { version } : {}), ...(message ? { message } : {}), ...(checkedAt ? { checkedAt } : {}) };
}
