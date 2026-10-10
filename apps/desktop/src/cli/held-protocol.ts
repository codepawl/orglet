import { z } from 'zod';

/**
 * The held operations the terminal reaches with an elevation (docs/cli-held-actions-design.md). Node only: main and the
 * CLI both import this file. `HELD_ACTIONS` names, for each action, the core commands and Bridge methods it stands for;
 * `parity.ts` derives the scope of an action from the answers it gives those keys, so nothing is written twice.
 */

/** Pairing codes: eight characters, with no 0, O, 1, I or L. */
export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

export const PairingId = z.string().regex(/^[a-f0-9]{32}$/);
/** The elevation key: 32 random bytes as hex. Main keeps only its SHA-256. */
export const ElevationKey = z.string().regex(/^[a-f0-9]{64}$/);

const Name = z.string().trim().min(1).max(80);
const ChatReference = z.string().trim().regex(/^#?[0-9a-f-]{4,36}$/i);
const CardId = z.string().trim().min(4).max(64).regex(/^[0-9a-f-]+$/i);
/** A chat for a held action: the full id the waiting list printed, or the same names the other commands take. */
const ChatFields = { to: Name.optional(), chat: ChatReference.optional() };

export const MCP_CHOICES = ['once', 'tool', 'server', 'refuse'] as const;

/** Stage C and D bodies. Main checks each field again with the window's own schema before it calls anything. */
const Level = z.array(z.enum(['read', 'write', 'execute'])).min(1).max(3);
const Capabilities = z.array(z.string().trim().min(1).max(40)).max(10);
const FolderPath = z.string().min(1).max(32768);
const Provider = z.string().trim().min(1).max(80);
/**
 * What a secret may be: a key or a token, one line. It rides only in the `held` request, never in the pairing's
 * `operation`, and `operationHash` leaves it out, so no stored hash or word list is ever made from it.
 */
export const SecretText = z.string().min(1).max(500);
export const CHANGES_OF_ACCOUNT = ['sign-in', 'sign-out', 'cancel', 'reopen'] as const;
export const CHANGES_OF_HARNESS = ['add', 'remove', 'select', 'sign-in', 'cancel', 'sign-out'] as const;

const SetupBodies = [
  z.object({ action: z.literal('tools'), ...ChatFields, capabilities: Capabilities }).strict(),
  z.object({ action: z.literal('folder'), ...ChatFields, path: FolderPath, permissions: Level }).strict(),
  z.object({ action: z.literal('schedule-folder'), kind: z.enum(['watch', 'work']), path: FolderPath, permissions: Level }).strict(),
  z.object({ action: z.literal('folder-level'), ...ChatFields, permissions: Level }).strict(),
  z.object({ action: z.literal('folder-revoke'), ...ChatFields }).strict(),
  z.object({ action: z.literal('file-revoke'), sourceId: z.uuid() }).strict(),
  z.object({ action: z.literal('mcp-enable'), server: Name, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('mcp-grant'), ...ChatFields, server: Name, tool: z.string().min(1).max(128).optional(), allowed: z.boolean() }).strict(),
  z.object({ action: z.literal('mcp-remove'), server: Name }).strict(),
  z.object({ action: z.literal('mcp-sign-in'), server: Name, cancel: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('limit'), ...ChatFields, budgetMicros: z.number().int().min(1000).max(100_000_000) }).strict(),
  z.object({ action: z.literal('space-tools'), space: Name, capabilities: Capabilities }).strict(),
  z.object({ action: z.literal('decision-model'), entries: z.array(z.object({ connection: Provider, model: z.string().trim().min(1).max(200) }).strict()).max(8) }).strict(),
  z.object({ action: z.literal('switch'), what: z.enum(['analytics', 'cli-path', 'send-to']), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('backup'), path: FolderPath }).strict(),
  z.object({ action: z.literal('sync'), confirm: z.string().max(200), choice: z.enum(['merge', 'replace']).optional() }).strict(),
  z.object({ action: z.literal('browser-profile'), change: z.enum(['clear', 'delete']), profile: Name, confirm: z.string().max(200) }).strict(),
  z.object({ action: z.literal('harness'), change: z.enum(CHANGES_OF_HARNESS), harness: Name, account: Name.optional(), label: Name.optional() }).strict(),
  z.object({ action: z.literal('account'), change: z.enum(CHANGES_OF_ACCOUNT) }).strict(),
  z.object({ action: z.literal('custom-connection'), change: z.enum(['save', 'delete']), name: Name, baseUrl: z.string().trim().min(1).max(500).optional() }).strict(),
  z.object({ action: z.literal('disconnect'), provider: Provider }).strict(),
  z.object({ action: z.literal('search-key-remove'), provider: Provider }).strict(),
  // The two that carry a secret. `secret` is optional in the schema so the same body, without it, can name the
  // operation to a pairing; main refuses to run one that arrives without it.
  z.object({ action: z.literal('connect'), provider: Provider, secret: SecretText.optional() }).strict(),
  z.object({ action: z.literal('search-key'), provider: Provider, secret: SecretText.optional() }).strict(),
] as const;

export const HeldBody = z.discriminatedUnion('action', [
  ...SetupBodies,
  z.object({ action: z.literal('mcp'), ...ChatFields, cardId: CardId, choice: z.enum(MCP_CHOICES) }).strict(),
  z.object({ action: z.literal('browser'), ...ChatFields, cardId: CardId, answer: z.enum(['allow', 'decline']) }).strict(),
  z.object({ action: z.literal('desktop'), ...ChatFields, cardId: CardId, answer: z.enum(['allow', 'decline']) }).strict(),
  z.object({ action: z.literal('changes'), ...ChatFields, cardId: CardId, decision: z.enum(['apply', 'discard']) }).strict(),
  z.object({ action: z.literal('hand-in'), ...ChatFields, cardId: CardId }).strict(),
  z.object({ action: z.literal('proposal'), ...ChatFields, cardId: CardId, decision: z.enum(['apply', 'dismiss', 'undo']) }).strict(),
  z.object({ action: z.literal('memory'), cardId: CardId, revision: z.number().int().positive(), decision: z.enum(['approve', 'archive']) }).strict(),
  z.object({ action: z.literal('budget'), cardId: CardId, amountMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), source: z.enum(['provider_dashboard', 'invoice']) }).strict(),
  z.object({ action: z.literal('install-update') }).strict(),
  z.object({ action: z.literal('test'), what: z.enum(['mcp', 'web-search', 'decision-model']), server: Name.optional() }).strict(),
]);
export type HeldBody = z.infer<typeof HeldBody>;
export type SetupBody = z.infer<(typeof SetupBodies)[number]>;
const SETUP_ACTIONS: ReadonlySet<string> = new Set(SetupBodies.map(schema => schema.shape.action.value));
/** Grants and secrets (stages C and D), as opposed to the decisions of stage B. */
export function isSetupBody(body: HeldBody): body is SetupBody {
  return SETUP_ACTIONS.has(body.action);
}
/** The bodies that carry a secret; their errors and journal lines say nothing but that the key was not saved. */
export function carriesSecret(body: HeldBody): boolean {
  return body.action === 'connect' || body.action === 'search-key';
}
export type HeldAction = HeldBody['action'];

/**
 * `keys` are the parity-table keys an action stands for. An action whose core command the terminal also reaches
 * without a key (a lower spend limit, a space's other fields) has no key of its own and names its `scope` instead.
 */
export const HELD_ACTIONS: Record<HeldAction, { keys: readonly string[]; label: string; scope?: 'setup' }> = {
  tools: { keys: ['setToolCapabilities'], label: 'Đổi công cụ của một chat' },
  folder: { keys: ['pickWorkspace', 'pickNewChatWorkspace'], label: 'Cho một chat làm việc trong một thư mục' },
  'schedule-folder': { keys: ['pickWatchFolder', 'pickRoutineWorkspace'], label: 'Chọn thư mục cho một lịch' },
  'folder-level': { keys: ['setWorkspaceLevel'], label: 'Đổi quyền trên thư mục của một chat' },
  'folder-revoke': { keys: ['revokeWorkspace'], label: 'Gỡ thư mục của một chat' },
  'file-revoke': { keys: ['revoke'], label: 'Lấy lại một tệp từ Tí' },
  'mcp-enable': { keys: ['setMcpServerEnabled'], label: 'Bật hoặc tắt một máy chủ MCP' },
  'mcp-grant': { keys: ['setMcpGrant'], label: 'Cho hoặc rút quyền MCP của một chat' },
  'mcp-remove': { keys: ['removeMcpServer'], label: 'Xóa một máy chủ MCP' },
  'mcp-sign-in': { keys: ['signInMcpServer', 'cancelMcpSignIn'], label: 'Đăng nhập máy chủ MCP bằng trình duyệt' },
  limit: { keys: [], label: 'Tăng giới hạn chi phí của một chat', scope: 'setup' },
  'space-tools': { keys: [], label: 'Đổi công cụ mà kênh mới của một không gian bắt đầu với', scope: 'setup' },
  'decision-model': { keys: ['saveDecisionModelSetting'], label: 'Chọn kết nối cho mô hình quyết định' },
  switch: { keys: ['setAnalytics', 'setCliOnPath', 'setSendTo'], label: 'Đổi một công tắc của app' },
  backup: { keys: ['backup'], label: 'Sao lưu ra một tệp' },
  sync: { keys: ['syncStart'], label: 'Nối máy này với tài khoản' },
  'browser-profile': { keys: ['clearBrowserProfile', 'deleteBrowserProfile'], label: 'Xóa dữ liệu hoặc xóa một hồ sơ trình duyệt' },
  harness: { keys: ['saveHarnessAccount', 'removeHarnessAccount', 'selectHarnessAccount', 'startHarnessSignIn', 'cancelHarnessSignIn', 'signOutHarness'], label: 'Đổi tài khoản CLI của một harness' },
  account: { keys: ['accountSignIn', 'accountSignOut', 'accountCancelSignIn', 'accountReopenSignIn'], label: 'Đăng nhập hoặc đăng xuất tài khoản CodePawl' },
  'custom-connection': { keys: ['saveCustomConnection', 'deleteCustomConnection'], label: 'Lưu hoặc xóa một kết nối tùy chỉnh' },
  disconnect: { keys: ['disconnect'], label: 'Xóa khóa của một kết nối' },
  'search-key-remove': { keys: ['removeWebSearchKey'], label: 'Xóa khóa tìm kiếm web' },
  connect: { keys: ['connect'], label: 'Lưu khóa API của một kết nối' },
  'search-key': { keys: ['saveWebSearchKey'], label: 'Lưu khóa tìm kiếm web' },
  // An MCP approval is the approval branch of `answerDecision`; `orglet answer` refuses it without an elevation.
  mcp: { keys: [], label: 'Trả lời xin quyền dùng công cụ MCP' },
  browser: { keys: ['answerBrowserApproval'], label: 'Trả lời một bước trình duyệt đang chờ duyệt' },
  desktop: { keys: ['answerDesktopApproval'], label: 'Trả lời một bước trên máy đang chờ duyệt' },
  changes: { keys: ['applyWorkspaceReview', 'discardWorkspaceReview'], label: 'Áp dụng hoặc bỏ thay đổi của một lượt chạy' },
  'hand-in': { keys: ['applyBlockedHandIn'], label: 'Áp dụng bản làm việc bị chặn' },
  proposal: { keys: ['applyAppProposal', 'dismissAppProposal', 'undoAppProposal'], label: 'Trả lời một đề xuất đổi app' },
  memory: { keys: ['reviewKnowledge'], label: 'Duyệt hoặc lưu trữ một ghi nhớ' },
  budget: { keys: ['reconcileBudget'], label: 'Ghi số tiền nhà cung cấp đã tính' },
  'install-update': { keys: ['installUpdate'], label: 'Khởi động lại để cài bản cập nhật' },
  test: { keys: ['testMcpServer', 'testWebSearch', 'testDecisionModel'], label: 'Chạy thử một kết nối' },
};

/** What a held-action card offers: its facts as the window's card shows them, and a ready request for each choice. */
export type WaitingChoice = { key: string; label: string; request: HeldBody };
export type WaitingCard = {
  kind: HeldAction;
  cardId: string;
  /** Which chat the card is in; absent for a card that belongs to the app (a memory, an update). */
  chat?: string;
  title: string;
  facts: string[];
  choices: WaitingChoice[];
};
export type WaitingValue = { cards: WaitingCard[] };

export type PairStartValue = { pairingId: string; expiresInSeconds: number };
export type PairFinishValue = { key: string; scope: 'decisions' | 'one' | 'setup'; endsInSeconds: number };
export type HeldValue = { action: HeldAction; summary: string };
