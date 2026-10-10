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

export const HeldBody = z.discriminatedUnion('action', [
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
export type HeldAction = HeldBody['action'];

export const HELD_ACTIONS: Record<HeldAction, { keys: readonly string[]; label: string }> = {
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
