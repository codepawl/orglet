import { createHash } from 'node:crypto';
import type { Artifact, TaskDetail, Workspace } from '../shared/contracts';
import type { McpServerDraft } from '../shared/mcp';
import type { PackageReview } from '../shared/skill-package';
import type { SyncConflict } from '../shared/sync-conflicts';
import type { WorkspaceRecoveryView } from '../shared/workspace-recovery';
import { carriesSecret, HELD_ACTIONS, isSetupBody, type HeldBody, type HeldValue, type PairFinishValue, type PairStartValue, type WaitingCard, type WaitingChoice, type WaitingValue } from '../cli/held-protocol';
import type { CliRequest } from '../cli/protocol';
import { operationHash, type ElevationGrant } from './cli-elevation';
import { CliFailure, targetChat } from './cli-chats';
import { pendingDecision } from './cli-chat-history';
import { readTask, type CliDependencies } from './cli-turns';
import { CliSetup, type SetupOutcome } from './cli-setup';

/**
 * The terminal's side of the held operations (docs/cli-held-actions-design.md): pairing, the cards a chat is waiting
 * on with the facts the window's card shows, and the answers. Every answer is the core command the window's button
 * sends, and every one is journaled. By the time `answer` runs, the server has already checked the elevation.
 */

type Request<Op extends CliRequest['op']> = Extract<CliRequest, { op: Op }>;

const STALE_CARD = 'Thẻ này đã đổi hoặc đã có người trả lời. Xem lại thẻ đang chờ rồi thử lại.';
const MAX_LISTED_FILES = 20;
const MAX_LISTED_CARDS = 20;
const MAX_VERSION_TEXT = 600;
/** Decisions whose journal row names what they touched (a note's title, a file's path), not only what kind of act they are. */
const NAMED_DECISIONS: ReadonlySet<string> = new Set(['note', 'restore-file', 'skill-show', 'skill-review', 'sync-conflict']);

/** The operation in words, for the pairing dialog and the journal. Source strings; the caller translates them. */
export function heldWords(body: HeldBody): string {
  switch (body.action) {
    case 'mcp': return { once: 'Cho phép dùng công cụ MCP một lần', tool: 'Cho phép công cụ MCP này trong chat', server: 'Cho phép mọi công cụ của máy chủ MCP này trong chat', refuse: 'Từ chối công cụ MCP' }[body.choice];
    case 'browser': return body.answer === 'allow' ? 'Cho phép bước trình duyệt đang chờ' : 'Từ chối bước trình duyệt đang chờ';
    case 'desktop': return body.answer === 'allow' ? 'Cho phép bước trên máy đang chờ' : 'Từ chối bước trên máy đang chờ';
    case 'changes': return body.decision === 'apply' ? 'Áp dụng thay đổi của một lượt chạy vào thư mục' : 'Bỏ thay đổi của một lượt chạy';
    case 'hand-in': return 'Áp dụng bản làm việc dù lệnh kiểm tra đã bị chặn';
    case 'proposal': return { apply: 'Áp dụng đề xuất đổi app', dismiss: 'Bỏ đề xuất đổi app', undo: 'Hoàn tác đề xuất đổi app đã áp dụng' }[body.decision];
    case 'memory': return body.decision === 'approve' ? 'Duyệt một ghi nhớ để các Tí đọc' : 'Lưu trữ một ghi nhớ';
    case 'budget': return 'Ghi số tiền nhà cung cấp đã tính cho một lượt chạy';
    case 'install-update': return 'Khởi động lại Orglet để cài bản cập nhật';
    case 'test': return { mcp: 'Chạy thử một máy chủ MCP', 'web-search': 'Chạy thử tìm kiếm web', 'decision-model': 'Chạy thử mô hình quyết định' }[body.what];
    case 'sync-conflict': return body.keep === 'this-computer' ? 'Giữ bản của máy này cho một mục sửa trên hai máy' : 'Giữ bản của tài khoản cho một mục sửa trên hai máy';
    default: return HELD_ACTIONS[body.action].label;
  }
}

function chatWords(body: { to?: string; chat?: string }): string {
  return body.to ?? (body.chat ? `#${body.chat}` : '');
}

/** Turns a source string into the app's language; the plain function leaves it as written. */
type Say = (source: string) => string;

function levelWords(permissions: readonly string[], say: Say): string {
  if (permissions.includes('execute')) return say('đọc, sửa và chạy lệnh');
  return say(permissions.includes('write') ? 'đọc và sửa' : 'chỉ đọc');
}

/**
 * The arguments of a grant, as plain words the person reads in the pairing dialog before typing anything: which chat,
 * which folder, at what level. Names and paths are not translated, and this never reads `secret`.
 */
export function heldDetail(body: HeldBody, say: Say = source => source): string {
  switch (body.action) {
    case 'tools': return `${chatWords(body)}: ${body.capabilities.join(', ') || '-'}`;
    case 'folder': return `${chatWords(body)}: ${body.path} (${levelWords(body.permissions, say)})`;
    case 'schedule-folder': return `${body.path} (${levelWords(body.permissions, say)})`;
    case 'folder-level': return `${chatWords(body)}: ${levelWords(body.permissions, say)}`;
    case 'folder-revoke': return chatWords(body);
    case 'file-revoke': return body.sourceId;
    case 'mcp-enable': return `${body.server}: ${body.enabled ? 'on' : 'off'}`;
    case 'mcp-grant': return `${chatWords(body)}: ${body.server}${body.tool ? ` / ${body.tool}` : ''} (${body.allowed ? 'allow' : 'deny'})`;
    case 'mcp-remove':
    case 'mcp-sign-in': return body.server;
    case 'limit': return `${chatWords(body)}: ${(body.budgetMicros / 1_000_000).toFixed(2)} USD`;
    case 'space-tools': return `${body.space}: ${body.capabilities.join(', ') || '-'}`;
    case 'decision-model': return body.entries.map(entry => `${entry.connection} ${entry.model}`).join(', ') || '-';
    case 'switch': return `${body.what}: ${body.enabled ? 'on' : 'off'}`;
    case 'backup': return body.path;
    case 'browser-profile': return `${body.change} ${body.profile}`;
    case 'harness': return [body.change, body.harness, body.account, body.label].filter(Boolean).join(' ');
    case 'account': return body.change;
    case 'custom-connection': return [body.change, body.name, body.baseUrl].filter(Boolean).join(' ');
    case 'disconnect':
    case 'connect':
    case 'search-key':
    case 'search-key-remove': return body.provider;
    case 'browser-choice': return browserChoiceDetail(body);
    case 'desktop-choice': return [chatWords(body), body.mode ? `mode ${body.mode}` : '', ...(body.add ?? []).map(program => `+${program}`), ...(body.remove ?? []).map(program => `-${program}`)].filter(Boolean).join(' ');
    case 'mcp-save':
    case 'mcp-import': return body.servers.map(serverWords).join(', ');
    case 'accept':
    case 'evidence': return chatWords(body);
    case 'restore-file': return `${chatWords(body)}: ${body.path}`;
    case 'skill-show':
    case 'skill-review': return body.skill;
    case 'note': return `${body.title}${body.orglet ? ` (${body.orglet})` : ''}`;
    default: return '';
  }
}

function browserChoiceDetail(body: Extract<HeldBody, { action: 'browser-choice' }>): string {
  const parts = [chatWords(body), body.profile ? `profile ${body.profile}` : '', body.mode ? `mode ${body.mode}` : ''];
  for (const site of body.allow ?? []) parts.push(`+${site}`);
  for (const site of body.block ?? []) parts.push(`block ${site}`);
  for (const site of body.remove ?? []) parts.push(`-${site}`);
  return parts.filter(Boolean).join(' ');
}

/** A server for the dialog and the journal: its name and how it starts, never its arguments, path, query or any value. */
function serverWords(server: McpServerDraft): string {
  if (server.transport.kind === 'stdio') return `${server.name} (stdio: ${server.transport.command})`;
  let origin = 'http';
  try {
    origin = new URL(server.transport.url).origin;
  } catch {
    // The draft's schema has already accepted the address; an odd one is shown as plain "http".
  }
  return `${server.name} (${origin})`;
}

export class CliHeld {
  constructor(private readonly dependencies: CliDependencies) {}

  private access() {
    if (!this.dependencies.terminalAccess) throw new CliFailure('failed', 'App này chưa bật việc mở khóa từ terminal.');
    return this.dependencies.terminalAccess;
  }

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  private say(source: string): string {
    return this.dependencies.translate(source);
  }

  /** The operation and its arguments in words, for the dialog and the journal. */
  private describe(body: HeldBody): string {
    const detail = heldDetail(body, source => this.say(source));
    return detail ? `${this.say(heldWords(body))}: ${detail}` : this.say(heldWords(body));
  }

  /**
   * The words the pairing dialog shows. What the terminal named is not trusted for what the person reads: a conflict is
   * shown by the name main finds for it, so a terminal cannot dress one choice up as another.
   */
  private async describeForDialog(body: HeldBody): Promise<string> {
    if (body.action !== 'sync-conflict') return this.describe(body);
    const conflict = (await this.conflicts()).find(item => item.id === body.cardId && item.entity === body.entity);
    return `${this.say(heldWords(body))}: ${conflict?.name ?? body.cardId.slice(0, 8)}`;
  }

  private conflicts(): Promise<SyncConflict[]> {
    return this.dependencies.request('syncConflicts', {}) as Promise<SyncConflict[]>;
  }

  async pairStart(request: Request<'pair-start'>): Promise<PairStartValue> {
    // A secret is read after the pairing and sent only in the held request; the dialog, the hash and the journal never see it.
    if (request.operation && ('secret' in request.operation || 'secrets' in request.operation)) throw new CliFailure('invalid', 'Yêu cầu ghép đôi không được mang khóa bí mật.');
    const operation = request.operation ? { hash: operationHash(request.operation), words: await this.describeForDialog(request.operation) } : undefined;
    const started = await this.access().elevation.startPairing(request.scope, operation);
    // The window comes forward so the person sees the code; the terminal says where to look as well.
    await Promise.resolve(this.dependencies.open()).catch(() => undefined);
    return started;
  }

  pairFinish(request: Request<'pair-finish'>): PairFinishValue {
    return this.access().elevation.finishPairing(request.pairingId, request.code);
  }

  pairCancel(request: Request<'pair-cancel'>): Record<string, never> {
    this.access().elevation.cancelPairing(request.pairingId);
    return {};
  }

  elevationEnd(): Record<string, never> {
    this.access().elevation.endElevation();
    return {};
  }

  /** The cards a chat waits on, or with no chat the ones that belong to the app. Reading only; no ids that reach a decision on their own. */
  async waiting(request: Request<'waiting'>): Promise<WaitingValue> {
    const workspace = await this.workspace();
    if (request.to === undefined && request.chat === undefined) return { cards: [...this.appCards(workspace), ...await this.conflictCards()] };
    const { task } = targetChat(workspace, request);
    const detail = await readTask(this.dependencies.request, task.id);
    const recovery = await this.dependencies.request('workspaceRecovery', { taskId: task.id }) as WorkspaceRecoveryView;
    const cards = [...this.toolCards(detail), ...this.changeCards(detail, recovery), ...this.proposalCards(detail), ...this.reportCards(detail)];
    return { cards: [...cards, ...await this.restoreCards(detail, recovery)] };
  }

  /** The latest report of the chat when the person has not accepted it: the same one the window's button accepts. */
  private acceptableReport(detail: TaskDetail): Artifact | undefined {
    const { task } = detail;
    if (task.accepted || !['completed', 'partial', 'waiting_input'].includes(task.status)) return undefined;
    return detail.artifacts.findLast(artifact => detail.runs.some(run => run.id === artifact.runId
      && (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0) && (!task.teamSnapshot || run.stage === 'synthesis')));
  }

  private reportCards(detail: TaskDetail): WaitingCard[] {
    const chat = detail.task.id;
    const cards: WaitingCard[] = [];
    const report = this.acceptableReport(detail);
    if (report) {
      cards.push({
        kind: 'accept', cardId: report.id, chat, title: this.say('Báo cáo chờ bạn chấp nhận'),
        facts: [this.say(report.report.title), this.say(report.report.summary), `${this.say('Số phát hiện')}: ${report.report.findings.length}`],
        choices: [this.choice('accept', 'Chấp nhận báo cáo', { action: 'accept', chat, cardId: report.id })],
      });
    }
    for (const request of detail.task.evidenceRequests ?? []) {
      if (request.state !== 'pending') continue;
      cards.push({
        kind: 'evidence', cardId: request.id, chat, title: this.say('Bằng chứng còn thiếu'),
        facts: [...request.checks, this.say('Ghi nhận giới hạn không chuyển các mục này thành đạt.')],
        choices: [this.choice('acknowledge', 'Ghi nhận giới hạn', { action: 'evidence', chat, cardId: request.id })],
      });
    }
    return cards;
  }

  /** Files a hand-in deleted that can still be put back, each with the size of its saved copy. */
  private async restoreCards(detail: TaskDetail, recovery: WorkspaceRecoveryView): Promise<WaitingCard[]> {
    const chat = detail.task.id;
    const cards: WaitingCard[] = [];
    for (const copy of recovery.copies) {
      if (recovery.attempts.find(attempt => attempt.runId === copy.runId)?.retired !== false) continue;
      for (const change of copy.changes) {
        if (change.kind !== 'delete' || change.status !== 'applied' || change.restored) continue;
        const saved = await this.dependencies.request('recoveryDeletedFile', { taskId: chat, runId: copy.runId, path: change.path }).catch(() => undefined) as { bytes: number; restored: boolean } | undefined;
        if (!saved || saved.restored) continue;
        const cardId = createHash('sha256').update(`${copy.runId}\n${change.path}`).digest('hex').slice(0, 24);
        cards.push({
          kind: 'restore-file', cardId, chat, title: this.say('Một tệp đã bị xóa có thể khôi phục'),
          facts: [`${this.say('Đường dẫn')}: ${change.path}`, `${this.say('Dung lượng')}: ${saved.bytes} bytes`],
          choices: [this.choice('restore', 'Khôi phục tệp', { action: 'restore-file', chat, runId: copy.runId, path: change.path })],
        });
      }
    }
    return cards;
  }

  private async conflictCards(): Promise<WaitingCard[]> {
    const cards: WaitingCard[] = [];
    for (const conflict of (await this.conflicts()).slice(0, MAX_LISTED_CARDS)) {
      const [first, second] = conflict.versions;
      const thisComputer = [first, second].find(version => version?.thisComputer);
      const account = [first, second].find(version => version && !version.thisComputer);
      if (!thisComputer || !account) continue;
      const describe = (version: typeof first, label: string) => `${this.say(label)}${version.current ? ` (${this.say('đang dùng')})` : ''}: ${version.text.slice(0, MAX_VERSION_TEXT)}`;
      const choice = (key: string, label: string, version: typeof first, keep: 'this-computer' | 'account') => this.choice(key, label,
        { action: 'sync-conflict', entity: conflict.entity, cardId: conflict.id, revisionId: version.revisionId, generation: conflict.generation, keep });
      cards.push({
        kind: 'sync-conflict', cardId: conflict.id, title: conflict.name || this.say('Sửa trên hai máy'),
        facts: [describe(thisComputer, 'Bản của máy này'), describe(account, 'Bản của tài khoản (máy khác)')],
        choices: [choice('keep-this', 'Giữ bản của máy này', thisComputer, 'this-computer'), choice('keep-account', 'Giữ bản của tài khoản', account, 'account')],
      });
    }
    return cards;
  }

  private choice(key: string, label: string, request: HeldBody): WaitingChoice {
    return { key, label: this.say(label), request };
  }

  private toolCards(detail: TaskDetail): WaitingCard[] {
    const chat = detail.task.id;
    const cards: WaitingCard[] = [];
    const decision = detail.task.status === 'waiting_input' ? pendingDecision(detail.task) : undefined;
    if (decision?.approval) {
      const { serverName, tool, arguments: toolArguments } = decision.approval;
      cards.push({
        kind: 'mcp', cardId: decision.id, chat, title: this.say('Xin quyền dùng công cụ MCP'),
        facts: [`${this.say('Máy chủ')}: ${serverName}`, `${this.say('Công cụ')}: ${tool}`, `${this.say('Tham số')}: ${toolArguments}`],
        choices: [
          this.choice('once', 'Cho phép một lần', { action: 'mcp', chat, cardId: decision.id, choice: 'once' }),
          this.choice('tool', 'Cho phép công cụ này trong chat', { action: 'mcp', chat, cardId: decision.id, choice: 'tool' }),
          this.choice('server', 'Cho phép cả máy chủ này trong chat', { action: 'mcp', chat, cardId: decision.id, choice: 'server' }),
          this.choice('refuse', 'Từ chối', { action: 'mcp', chat, cardId: decision.id, choice: 'refuse' }),
        ],
      });
    }
    const browser = detail.browser?.approval;
    if (browser) {
      const facts = [`${browser.workerName}: ${browser.kind} ${browser.element}`, `${this.say('Trang')}: ${browser.site} (${browser.url})`];
      if (browser.text !== undefined) facts.push(`${this.say('Sẽ gõ')}: ${browser.text}`);
      if (browser.key !== undefined) facts.push(`${this.say('Phím')}: ${browser.key}`);
      if (browser.values?.length) facts.push(`${this.say('Chọn')}: ${browser.values.join(', ')}`);
      facts.push(...browser.reasons.map(reason => this.say(reason)));
      cards.push({
        kind: 'browser', cardId: browser.id, chat, title: this.say('Một bước trình duyệt cần bạn duyệt'), facts,
        choices: [
          this.choice('allow', 'Cho phép bước này', { action: 'browser', chat, cardId: browser.id, answer: 'allow' }),
          this.choice('decline', 'Từ chối', { action: 'browser', chat, cardId: browser.id, answer: 'decline' }),
        ],
      });
    }
    const desktop = detail.desktop?.approval;
    if (desktop) {
      const facts = [`${desktop.workerName}: ${desktop.kind} ${desktop.element}`, `${this.say('Chương trình')}: ${desktop.program} (${desktop.window})`];
      if (desktop.text !== undefined) facts.push(`${this.say('Sẽ nhập')}: ${desktop.text}`);
      if (desktop.borrow) facts.push(`${this.say('Mượn chuột và bàn phím tối đa')} ${desktop.borrow.limitSeconds}s, ${desktop.borrow.steps.length} ${this.say('bước')}`);
      facts.push(...desktop.reasons.map(reason => this.say(reason)));
      cards.push({
        kind: 'desktop', cardId: desktop.id, chat, title: this.say('Một bước trên máy cần bạn duyệt'), facts,
        choices: [
          this.choice('allow', 'Cho phép bước này', { action: 'desktop', chat, cardId: desktop.id, answer: 'allow' }),
          this.choice('decline', 'Từ chối', { action: 'desktop', chat, cardId: desktop.id, answer: 'decline' }),
        ],
      });
    }
    return cards;
  }

  private changeCards(detail: TaskDetail, recovery: WorkspaceRecoveryView): WaitingCard[] {
    const chat = detail.task.id;
    const cards: WaitingCard[] = [];
    for (const copy of recovery.copies) {
      if (copy.review?.state !== 'pending') continue;
      const listed = copy.changes.slice(0, MAX_LISTED_FILES).map(change => `${change.status} ${change.path}`);
      const hidden = copy.changes.length - listed.length;
      cards.push({
        kind: 'changes', cardId: copy.runId, chat, title: this.say('Thay đổi đang chờ bạn duyệt'),
        facts: [`${this.say('Số tệp')}: ${copy.changeCount}`, ...listed, ...(hidden > 0 ? [`… +${hidden}`] : [])],
        choices: [
          this.choice('apply', 'Áp dụng vào thư mục', { action: 'changes', chat, cardId: copy.runId, decision: 'apply' }),
          this.choice('discard', 'Bỏ thay đổi', { action: 'changes', chat, cardId: copy.runId, decision: 'discard' }),
        ],
      });
    }
    const blocked = detail.runs.findLast(run => run.blockedHandIn && !run.blockedHandIn.acceptedAt);
    if (blocked?.blockedHandIn) {
      cards.push({
        kind: 'hand-in', cardId: blocked.id, chat, title: this.say('Bản làm việc bị chặn bởi lệnh kiểm tra'),
        facts: blocked.blockedHandIn.commands.map(command => [command.program, ...command.arguments].join(' ').slice(0, 300)),
        choices: [this.choice('apply', 'Áp dụng dù bị chặn', { action: 'hand-in', chat, cardId: blocked.id })],
      });
    }
    return cards;
  }

  private proposalCards(detail: TaskDetail): WaitingCard[] {
    const chat = detail.task.id;
    const cards: WaitingCard[] = [];
    for (const proposal of detail.appProposals) {
      const facts = [`${proposal.kind} / ${proposal.action}`, ...proposal.changes.map(change => `${change.field}: ${change.before ?? '-'} -> ${change.after}`)];
      if (proposal.status === 'pending') {
        cards.push({
          kind: 'proposal', cardId: proposal.id, chat, title: proposal.title, facts,
          choices: [
            this.choice('apply', 'Áp dụng', { action: 'proposal', chat, cardId: proposal.id, decision: 'apply' }),
            this.choice('dismiss', 'Bỏ đề xuất', { action: 'proposal', chat, cardId: proposal.id, decision: 'dismiss' }),
          ],
        });
      } else if (proposal.status === 'applied' && proposal.undo && !proposal.undoneAt) {
        cards.push({
          kind: 'proposal', cardId: proposal.id, chat, title: proposal.title, facts,
          choices: [this.choice('undo', 'Hoàn tác', { action: 'proposal', chat, cardId: proposal.id, decision: 'undo' })],
        });
      }
    }
    return cards;
  }

  private appCards(workspace: Workspace): WaitingCard[] {
    const cards: WaitingCard[] = [];
    for (const item of workspace.knowledge.filter(note => note.status === 'proposed').slice(0, MAX_LISTED_CARDS)) {
      cards.push({
        kind: 'memory', cardId: item.id, title: item.title, facts: [item.content, ...(item.tags.length ? [`#${item.tags.join(' #')}`] : [])],
        choices: [
          this.choice('approve', 'Duyệt để các Tí đọc', { action: 'memory', cardId: item.id, revision: item.revision, decision: 'approve' }),
          this.choice('archive', 'Lưu trữ', { action: 'memory', cardId: item.id, revision: item.revision, decision: 'archive' }),
        ],
      });
    }
    const update = this.dependencies.app?.updateState();
    if (update?.status === 'ready' && this.dependencies.app?.installUpdate) {
      cards.push({
        kind: 'install-update', cardId: 'update', title: this.say('Bản cập nhật đã tải xong'), facts: update.version ? [update.version] : [],
        choices: [this.choice('install', 'Khởi động lại để cài', { action: 'install-update' })],
      });
    }
    return cards;
  }

  /** Runs one held action and journals it, whatever its outcome. */
  async answer(request: Request<'held'>, grant: ElevationGrant): Promise<HeldValue> {
    const body = request.request;
    const words = this.say(heldWords(body));
    // A grant's row says what it touched; `describe` never reads `secret`.
    // A row holds at most 300 characters; a long path must not make the journal throw after the grant was made.
    const journalWords = (isSetupBody(body) || NAMED_DECISIONS.has(body.action) ? this.describe(body) : words).slice(0, 300);
    let subject: string | undefined;
    try {
      const outcome = await this.perform(body, grant);
      subject = outcome.subject?.slice(0, 200);
      const setupFields = isSetupBody(body) ? { notice: true, ...(outcome.undo ? { undo: outcome.undo } : {}) } : {};
      await this.access().journal.record({ scope: grant.scope, operation: journalWords, ...(subject ? { subject } : {}), outcome: 'done', ...setupFields });
      return { action: body.action, summary: words, ...(outcome.report ? { report: outcome.report } : {}), ...(outcome.skillHash ? { skillHash: outcome.skillHash } : {}) };
    } catch (error) {
      // A key must never come back in a message, so a failed save of one says only that it failed.
      const detail = carriesSecret(body) ? undefined : error instanceof Error ? error.message.slice(0, 300) : undefined;
      await this.access().journal.record({ scope: grant.scope, operation: journalWords, ...(subject ? { subject } : {}), outcome: 'failed', ...(detail ? { detail } : {}) });
      throw error;
    }
  }

  /** Takes back a grant from Settings, once. The window sends the journal row's id and nothing else. */
  async undoGrant(rowId: string): Promise<void> {
    const { journal } = this.access();
    const recipe = await journal.undoOf(rowId);
    if (!recipe) throw new CliFailure('failed', 'Không hoàn tác được thao tác này nữa.');
    await new CliSetup(this.dependencies).undo(recipe);
    await journal.markUndone(rowId);
  }

  private async perform(body: HeldBody, grant: ElevationGrant): Promise<SetupOutcome> {
    if (isSetupBody(body)) return new CliSetup(this.dependencies).perform(body);
    const call = this.dependencies.request;
    switch (body.action) {
      case 'memory': return this.reviewMemory(body);
      case 'budget': return this.reconcile(body);
      case 'install-update': return this.installUpdate();
      case 'test': return this.runTest(body);
      case 'sync-conflict': return this.resolveConflict(body);
      case 'skill-show': return this.showSkill(body, grant);
      case 'skill-review': return this.reviewSkill(body, grant);
      case 'note': return this.saveNote(body);
      default: break;
    }
    const workspace = await this.workspace();
    const { chat, task } = targetChat(workspace, body);
    const detail = await readTask(call, task.id);
    const taskId = task.id;
    switch (body.action) {
      case 'mcp': {
        const decision = detail.task.status === 'waiting_input' ? pendingDecision(detail.task) : undefined;
        if (!decision?.approval || decision.id !== body.cardId) throw new CliFailure('failed', STALE_CARD);
        await call('answerDecision', { taskId, requestId: decision.id, answer: body.choice });
        break;
      }
      case 'browser':
        if (detail.browser?.approval?.id !== body.cardId) throw new CliFailure('failed', STALE_CARD);
        await call('answerBrowserApproval', { taskId, requestId: body.cardId, answer: body.answer });
        break;
      case 'desktop':
        if (detail.desktop?.approval?.id !== body.cardId) throw new CliFailure('failed', STALE_CARD);
        await call('answerDesktopApproval', { taskId, requestId: body.cardId, answer: body.answer });
        break;
      case 'changes': {
        const recovery = await call('workspaceRecovery', { taskId }) as WorkspaceRecoveryView;
        const pending = recovery.copies.find(copy => copy.runId === body.cardId && copy.review?.state === 'pending');
        if (!pending) throw new CliFailure('failed', STALE_CARD);
        await call(body.decision === 'apply' ? 'applyWorkspaceReview' : 'discardWorkspaceReview', { taskId, runId: body.cardId });
        break;
      }
      case 'hand-in': {
        const run = detail.runs.find(item => item.id === body.cardId && item.blockedHandIn && !item.blockedHandIn.acceptedAt);
        if (!run) throw new CliFailure('failed', STALE_CARD);
        await call('applyBlockedHandIn', { taskId, runId: run.id });
        break;
      }
      case 'proposal': {
        const proposal = detail.appProposals.find(item => item.id === body.cardId);
        const usable = proposal && (body.decision === 'undo' ? proposal.status === 'applied' && proposal.undo && !proposal.undoneAt : proposal.status === 'pending');
        if (!usable) throw new CliFailure('failed', STALE_CARD);
        await call({ apply: 'applyAppProposal', dismiss: 'dismissAppProposal', undo: 'undoAppProposal' }[body.decision], { id: body.cardId });
        break;
      }
      case 'accept':
        if (this.acceptableReport(detail)?.id !== body.cardId) throw new CliFailure('failed', STALE_CARD);
        await call('accept', { id: taskId });
        break;
      case 'evidence': {
        const request = detail.task.evidenceRequests?.find(item => item.id === body.cardId && item.state === 'pending');
        if (!request) throw new CliFailure('failed', STALE_CARD);
        await call('acknowledgeEvidence', { taskId, requestId: request.id });
        break;
      }
      case 'restore-file': {
        const recovery = await call('workspaceRecovery', { taskId }) as WorkspaceRecoveryView;
        const open = recovery.attempts.some(attempt => attempt.runId === body.runId && !attempt.retired);
        const change = recovery.copies.find(copy => copy.runId === body.runId)?.changes.find(item => item.kind === 'delete' && item.path === body.path && item.status === 'applied' && !item.restored);
        if (!open || !change) throw new CliFailure('failed', STALE_CARD);
        await call('restoreWorkspaceFile', { taskId, runId: body.runId, path: body.path });
        break;
      }
    }
    return { subject: chat.name };
  }

  /** Keeps the version a card offered, after checking that the conflict is still the one the person read. */
  private async resolveConflict(body: Extract<HeldBody, { action: 'sync-conflict' }>): Promise<SetupOutcome> {
    const conflict = (await this.conflicts()).find(item => item.id === body.cardId && item.entity === body.entity);
    const version = conflict?.versions.slice(0, 2).find(item => item.revisionId === body.revisionId);
    if (!conflict || !version || conflict.generation !== body.generation || version.thisComputer !== (body.keep === 'this-computer')) throw new CliFailure('failed', STALE_CARD);
    await this.dependencies.request('resolveSyncConflict', { entity: conflict.entity, id: conflict.id, revisionId: version.revisionId, generation: conflict.generation });
    return { subject: conflict.name };
  }

  private async skillNamed(name: string) {
    const skill = (await this.workspace()).skills.find(item => item.package && item.name.toLowerCase() === name.toLowerCase());
    if (!skill) throw new CliFailure('not_found', 'Không tìm thấy skill có gói nhập với tên này.');
    return skill;
  }

  /** Prints the package through the same inspect the window's review uses, and remembers the hash as shown to this elevation. */
  private async showSkill(body: Extract<HeldBody, { action: 'skill-show' }>, grant: ElevationGrant): Promise<SetupOutcome> {
    const skill = await this.skillNamed(body.skill);
    const review = await this.dependencies.request('inspectSkill', { id: skill.id }) as PackageReview;
    this.access().elevation.shownTo(grant).add(`${skill.id}:${review.hash}`);
    const report = [`sha256 ${review.hash}`, ...review.blockers.map(blocker => `! ${blocker}`)];
    for (const file of review.files) report.push(`--- ${file.path} (${file.bytes} bytes)`, file.text ?? this.say('(không hiện được dạng chữ)'));
    return { subject: skill.name, report, skillHash: review.hash };
  }

  /** Trusts a package only if its exact hash was printed to this same elevation; the core checks the hash again. */
  private async reviewSkill(body: Extract<HeldBody, { action: 'skill-review' }>, grant: ElevationGrant): Promise<SetupOutcome> {
    const skill = await this.skillNamed(body.skill);
    if (!this.access().elevation.shownTo(grant).has(`${skill.id}:${body.hash}`)) {
      throw new CliFailure('failed', 'Chưa hiện gói skill này (đúng mã băm) cho lần mở khóa này. Chạy orglet skill show để đọc nó trước.');
    }
    await this.dependencies.request('reviewSkill', { id: skill.id, hash: body.hash });
    return { subject: skill.name };
  }

  /** Saves a note the way the window's note form does: approved, for the whole workspace or one orglet. */
  private async saveNote(body: Extract<HeldBody, { action: 'note' }>): Promise<SetupOutcome> {
    let scope: { type: 'workspace' } | { type: 'worker'; id: string } = { type: 'workspace' };
    if (body.orglet !== undefined) {
      const worker = (await this.workspace()).workers.find(item => item.name.toLowerCase() === body.orglet!.toLowerCase());
      if (!worker) throw new CliFailure('not_found', 'Không tìm thấy Tí với tên này.');
      scope = { type: 'worker', id: worker.id };
    }
    await this.dependencies.request('saveKnowledge', { title: body.title, content: body.content, tags: body.tags, pinned: body.pinned, scope });
    return { subject: body.title };
  }

  private async reviewMemory(body: Extract<HeldBody, { action: 'memory' }>): Promise<{ subject?: string }> {
    const workspace = await this.workspace();
    const item = workspace.knowledge.find(note => note.id === body.cardId && note.revision === body.revision && note.status === 'proposed');
    if (!item) throw new CliFailure('failed', STALE_CARD);
    await this.dependencies.request('reviewKnowledge', { id: item.id, revision: item.revision, decision: body.decision });
    return { subject: item.title };
  }

  private async reconcile(body: Extract<HeldBody, { action: 'budget' }>): Promise<{ subject?: string }> {
    const workspace = await this.workspace();
    const matches = workspace.budgetReservations.filter(item => !item.resolvedAt && item.id.startsWith(body.cardId));
    if (matches.length !== 1) throw new CliFailure(matches.length ? 'ambiguous' : 'not_found', matches.length ? 'Mã khoản giữ tiền khớp với nhiều khoản. Gõ dài hơn.' : 'Không tìm thấy khoản giữ tiền chưa xử lý nào với mã này.');
    await this.dependencies.request('reconcileBudget', { reservationId: matches[0].id, amountMicros: body.amountMicros, source: body.source });
    return { subject: matches[0].provider };
  }

  private async installUpdate(): Promise<{ subject?: string }> {
    const app = this.dependencies.app;
    if (!app?.installUpdate || app.updateState().status !== 'ready') throw new CliFailure('failed', 'Chưa có bản cập nhật nào tải xong để cài.');
    app.installUpdate();
    return {};
  }

  private async runTest(body: Extract<HeldBody, { action: 'test' }>): Promise<{ subject?: string }> {
    if (body.what === 'web-search') await this.dependencies.request('testWebSearch', {});
    else if (body.what === 'decision-model') await this.dependencies.request('testDecisionModel', {});
    else {
      const workspace = await this.workspace();
      const server = workspace.mcpServers.find(item => item.name.toLowerCase() === (body.server ?? '').toLowerCase());
      if (!server) throw new CliFailure('not_found', 'Không tìm thấy máy chủ MCP với tên này.');
      await this.dependencies.request('testMcpServer', { id: server.id });
      return { subject: server.name };
    }
    return {};
  }
}
