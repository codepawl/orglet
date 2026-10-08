import type { DecisionAttempt, DecisionQuestions, DecisionResponse, DecisionState, DecisionModelConnection, DecisionModelSetting, DecisionModelSettingView, DecisionModelTestResult, DecisionUsage } from '../../shared/decisions';
import { DecisionQuestions as QuestionsSchema, DecisionState as StateSchema, DECISION_MAX_STATE_CHARS, effectiveDecisionModelSetting, isHarnessDecisionConnection } from '../../shared/decisions';
import { API_PROVIDER_NAMES } from '../../shared/contracts';
import type { ModelAdapter } from '../adapters/openai';
import type { DecisionUsageEntry } from '../budgets/decision-usage';
import { stateText } from './answers';
import { allowsSlowBackend, type DecisionContext } from './budget';
import { askThroughCodex, CODEX_DECISION_TIMEOUT_MS, DecisionBackendUnavailable, type CodexDecisionRuntime } from './codex';
import { askThroughAdapter } from './emulated';
import { askOpenAiDecisions, type Fetcher } from './openai-decisions';

/** What the decision model needs from the rest of the core: the saved list, a key, and the adapter a connection chats through. */
export type DecisionsDependencies = {
  saved(): DecisionModelSetting | undefined;
  save(setting: DecisionModelSetting): void;
  readKey(provider: string): Promise<string | null>;
  /** The chat's own factory, so the decision model reaches a connection exactly as a chat does. */
  adapter(provider: string, model: string): Promise<ModelAdapter>;
  /** The Codex CLI as the harness runtime reaches it. Unset in tests that do not use it; a Codex entry is then unavailable. */
  codex?: CodexDecisionRuntime;
  /** Where each request's usage is counted, on the connection it went through. Unset in tests that do not look at usage. */
  recordUsage?(entry: DecisionUsageEntry): void;
  fetcher?: Fetcher;
  timeoutMs?: number;
  harnessTimeoutMs?: number;
};

/** A question that takes longer than this is left unanswered; nothing in the decision model is worth a stalled turn. */
export const DECISION_TIMEOUT_MS = 15_000;
/** The state's room in tokens when a caller names none; about four characters make a token. */
const DEFAULT_MAX_LENGTH = 1536;
const CHARACTERS_PER_TOKEN = 4;

const SAMPLE_TEXT = 'Hi! Could you summarise this report for me in three bullet points?';
const SAMPLE_QUESTIONS: DecisionQuestions = {
  kind: {
    type: 'choice',
    instructions: 'What does the text ask for?',
    criteria: { greeting: 'only says hello', question: 'asks for information', request: 'asks someone to do a task' },
  },
};

/** A request that ran out of time may still have been served, and billed, after the answer was dropped. */
function endedByTime(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function reasonOf(error: unknown): string {
  if (endedByTime(error)) return 'Hết thời gian chờ.';
  return error instanceof Error && error.message ? error.message : 'Không rõ lý do.';
}

type Attempted = { response?: DecisionResponse; attempts: DecisionAttempt[] };

/**
 * The decision model (COD-303): typed questions answered through the person's priority list of backends, at most
 * three. Each question goes to the first backend that can answer it: OpenAI's Decisions API for OpenAI, the connection's
 * chat adapter for any other API connection (emulated.ts), or the Codex CLI signed in with a ChatGPT account (codex.ts).
 * A backend is passed over when it is missing or signed out, fails, runs out of time, or is a slow one (Codex) and the
 * caller cannot wait for it (budget.ts). Nothing outside the list ever answers: when every entry is passed over, the
 * request returns `undefined` and the caller carries on as it did before the decision model existed. The answer says which
 * backend gave it (`answeredBy`). Every request that reaches a backend is counted against that connection
 * (budgets/decision-usage.ts), and against the chat when the caller names it.
 */
export class Decisions {
  constructor(private readonly dependencies: DecisionsDependencies) {}

  /**
   * Whether the decision model could answer: false only when the person emptied the list. An unset choice counts as on,
   * since the default depends on an OpenAI key that `decide` looks up; without one `decide` returns `undefined` at once.
   */
  isEnabled(): boolean {
    const saved = this.dependencies.saved();
    return saved === undefined || saved.length > 0;
  }

  async view(): Promise<DecisionModelSettingView> {
    const saved = this.dependencies.saved();
    const openAiKeySaved = saved === undefined && !!(await this.dependencies.readKey('openai').catch(() => null));
    return { entries: effectiveDecisionModelSetting(saved, openAiKeySaved), chosen: saved !== undefined };
  }

  async save(setting: DecisionModelSetting): Promise<DecisionModelSettingView> {
    this.dependencies.save(setting);
    return this.view();
  }

  /**
   * Answers `questions` about `state`, or `undefined` when the list is empty, no entry can answer in time, or each gets
   * a reply it cannot read. `maxLength` is the state's room in tokens; a longer state is cut to its start.
   */
  async decide(state: DecisionState, questions: DecisionQuestions, maxLength = DEFAULT_MAX_LENGTH, context: DecisionContext = {}): Promise<DecisionResponse | undefined> {
    const checked = { state: StateSchema.parse(state), questions: QuestionsSchema.parse(questions) };
    const { entries } = await this.view();
    if (!entries.length) return undefined;
    const outcome = await this.tryInOrder(entries, checked.state, checked.questions, maxLength, context);
    return outcome.response;
  }

  /** One sample decision for Settings → Test through the whole list, with the entry that answered and what happened to those before it. */
  async test(): Promise<DecisionModelTestResult> {
    const { entries } = await this.view();
    if (!entries.length) throw new Error('Model quyết định đang tắt. Chọn một kết nối trước.');
    const started = Date.now();
    // Nobody waits on a test, so a slow backend is tried too.
    const outcome = await this.tryInOrder(entries, SAMPLE_TEXT, SAMPLE_QUESTIONS, DEFAULT_MAX_LENGTH, { background: true });
    const answer = outcome.response?.answers.kind;
    const answeredBy = outcome.response?.answeredBy;
    if (!outcome.response || !answeredBy || !answer || answer.type !== 'choice') throw new Error(failureMessage(outcome.attempts));
    return { connection: answeredBy.connection, model: answeredBy.model, milliseconds: Date.now() - started, choice: answer.choice, probability: answer.probabilities[answer.choice], attempts: outcome.attempts };
  }

  private async tryInOrder(entries: readonly DecisionModelConnection[], state: DecisionState, questions: DecisionQuestions, maxLength: number, context: DecisionContext): Promise<Attempted> {
    const attempts: DecisionAttempt[] = [];
    const deadline = context.budgetMs === undefined ? undefined : Date.now() + context.budgetMs;
    for (const entry of entries) {
      // The caller has stopped waiting: starting another request would only be billed for an answer nobody reads.
      if (deadline !== undefined && Date.now() >= deadline) break;
      if (isHarnessDecisionConnection(entry.connection) && !allowsSlowBackend(context)) {
        attempts.push({ ...entry, outcome: 'skipped', milliseconds: 0, reason: 'Chỉ chạy nền: bỏ qua cho việc cần trả lời nhanh.' });
        continue;
      }
      const began = Date.now();
      try {
        const response = await this.ask(entry, state, questions, maxLength, context);
        if (!Object.keys(response.answers).length) throw new Error('Nhà cung cấp trả lời nhưng model quyết định không đọc được câu trả lời.');
        attempts.push({ ...entry, outcome: 'answered', milliseconds: Date.now() - began });
        return { response: { ...response, answeredBy: entry }, attempts };
      } catch (error) {
        const unavailable = error instanceof DecisionBackendUnavailable;
        attempts.push({ ...entry, outcome: unavailable ? 'skipped' : 'failed', milliseconds: Date.now() - began, reason: reasonOf(error) });
      }
    }
    return { attempts };
  }

  private async ask(setting: DecisionModelConnection, state: DecisionState, questions: DecisionQuestions, maxLength: number, context: DecisionContext): Promise<DecisionResponse> {
    const full = stateText(state);
    const room = Math.min(DECISION_MAX_STATE_CHARS, Math.max(1, maxLength) * CHARACTERS_PER_TOKEN);
    const input = full.length > room ? full.slice(0, room) : full;
    const harness = isHarnessDecisionConnection(setting.connection);
    const signal = AbortSignal.timeout(harness ? this.dependencies.harnessTimeoutMs ?? CODEX_DECISION_TIMEOUT_MS : this.dependencies.timeoutMs ?? DECISION_TIMEOUT_MS);
    let response: DecisionResponse;
    try {
      if (harness) response = await this.askCodex(setting, input, questions, signal);
      else if (setting.connection === 'openai') response = await this.askOpenAi(setting, input, questions, signal);
      else response = await askThroughAdapter({ adapter: await this.dependencies.adapter(setting.connection, setting.model), model: setting.model, input, questions, signal });
    } catch (error) {
      // No count came back, but a request cut off by time may have been billed: keep it visible as a call of unknown cost.
      if (endedByTime(error)) this.recordUsage(setting, undefined, context);
      throw error;
    }
    this.recordUsage(setting, response.usage, context);
    return input.length < full.length ? { ...response, usage: { ...response.usage, stateTruncated: true } } : response;
  }

  /** Counting a request never changes its answer: a failure to record is dropped. */
  private recordUsage(setting: DecisionModelConnection, usage: DecisionUsage | undefined, context: DecisionContext): void {
    try {
      this.dependencies.recordUsage?.({ provider: setting.connection, model: setting.model, taskId: context.taskId, usage });
    } catch {
      // The decision is already made; the count is lost rather than the answer.
    }
  }

  private async askOpenAi(setting: DecisionModelConnection, input: string, questions: DecisionQuestions, signal: AbortSignal): Promise<DecisionResponse> {
    const key = await this.dependencies.readKey('openai');
    if (!key) throw new DecisionBackendUnavailable(`Chưa kết nối ${API_PROVIDER_NAMES.openai}. Mở Cài đặt để nhập API key.`);
    return askOpenAiDecisions({ fetcher: this.dependencies.fetcher ?? fetch, key, model: setting.model, input, questions, signal });
  }

  private async askCodex(setting: DecisionModelConnection, input: string, questions: DecisionQuestions, signal: AbortSignal): Promise<DecisionResponse> {
    const runtime = this.dependencies.codex;
    if (!runtime) throw new DecisionBackendUnavailable('Codex chưa sẵn sàng trên máy này.');
    return askThroughCodex({ runtime, model: setting.model, input, questions, signal });
  }
}

/** Why a test found no answer: the reason of the only entry, or one numbered line per entry (the window translates each reason on its own). */
function failureMessage(attempts: readonly DecisionAttempt[]): string {
  if (!attempts.length) return 'Không có mục nào trả lời được.';
  if (attempts.length === 1) return attempts[0].reason ?? 'Không rõ lý do.';
  return attempts.map((attempt, index) => `${index + 1}. ${attempt.reason ?? 'Không rõ lý do.'}`).join('\n');
}
