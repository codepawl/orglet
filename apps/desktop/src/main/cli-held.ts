import type { TaskDetail, Workspace } from '../shared/contracts';
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
    default: return HELD_ACTIONS[body.action].label;
  }
}

function chatWords(body: { to?: string; chat?: string }): string {
  return body.to ?? (body.chat ? `#${body.chat}` : '');
}

function levelWords(permissions: readonly string[]): string {
  if (permissions.includes('execute')) return 'đọc, sửa và chạy lệnh';
  return permissions.includes('write') ? 'đọc và sửa' : 'chỉ đọc';
}

/**
 * The arguments of a grant, as plain words the person reads in the pairing dialog before typing anything: which chat,
 * which folder, at what level. Names and paths are not translated, and this never reads `secret`.
 */
export function heldDetail(body: HeldBody): string {
  switch (body.action) {
    case 'tools': return `${chatWords(body)}: ${body.capabilities.join(', ') || '-'}`;
    case 'folder': return `${chatWords(body)}: ${body.path} (${levelWords(body.permissions)})`;
    case 'schedule-folder': return `${body.path} (${levelWords(body.permissions)})`;
    case 'folder-level': return `${chatWords(body)}: ${levelWords(body.permissions)}`;
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
    default: return '';
  }
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
    const detail = heldDetail(body);
    return detail ? `${this.say(heldWords(body))}: ${detail}` : this.say(heldWords(body));
  }

  async pairStart(request: Request<'pair-start'>): Promise<PairStartValue> {
    // A secret is read after the pairing and sent only in the held request; the dialog, the hash and the journal never see it.
    if (request.operation && 'secret' in request.operation) throw new CliFailure('invalid', 'Yêu cầu ghép đôi không được mang khóa bí mật.');
    const operation = request.operation ? { hash: operationHash(request.operation), words: this.describe(request.operation) } : undefined;
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
    if (request.to === undefined && request.chat === undefined) return { cards: this.appCards(workspace) };
    const { task } = targetChat(workspace, request);
    const detail = await readTask(this.dependencies.request, task.id);
    const recovery = await this.dependencies.request('workspaceRecovery', { taskId: task.id }) as WorkspaceRecoveryView;
    return { cards: [...this.toolCards(detail), ...this.changeCards(detail, recovery), ...this.proposalCards(detail)] };
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
    const journalWords = isSetupBody(body) ? this.describe(body) : words;
    let subject: string | undefined;
    try {
      const outcome = await this.perform(body);
      subject = outcome.subject;
      const setupFields = isSetupBody(body) ? { notice: true, ...(outcome.undo ? { undo: outcome.undo } : {}) } : {};
      await this.access().journal.record({ scope: grant.scope, operation: journalWords, ...(subject ? { subject } : {}), outcome: 'done', ...setupFields });
      return { action: body.action, summary: words };
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

  private async perform(body: HeldBody): Promise<SetupOutcome> {
    if (isSetupBody(body)) return new CliSetup(this.dependencies).perform(body);
    const call = this.dependencies.request;
    switch (body.action) {
      case 'memory': return this.reviewMemory(body);
      case 'budget': return this.reconcile(body);
      case 'install-update': return this.installUpdate();
      case 'test': return this.runTest(body);
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
    }
    return { subject: chat.name };
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
