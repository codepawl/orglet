import type { DecisionQuestions, DecisionResponse, DecisionState, DecisionModelConnection, DecisionModelSetting, DecisionModelSettingView, DecisionModelTestResult, DecisionUsage } from '../../shared/decisions';
import { DecisionQuestions as QuestionsSchema, DecisionState as StateSchema, DECISION_MAX_STATE_CHARS, effectiveDecisionModelSetting } from '../../shared/decisions';
import { API_PROVIDER_NAMES } from '../../shared/contracts';
import type { ModelAdapter } from '../adapters/openai';
import type { DecisionUsageEntry } from '../budgets/decision-usage';
import { stateText } from './answers';
import type { DecisionContext } from './budget';
import { askThroughAdapter } from './emulated';
import { askOpenAiDecisions, type Fetcher } from './openai-decisions';

/** What the decision model needs from the rest of the core: the saved choice, a key, and the adapter a connection chats through. */
export type DecisionsDependencies = {
  saved(): DecisionModelSetting | undefined;
  save(setting: DecisionModelSetting): void;
  readKey(provider: string): Promise<string | null>;
  /** The chat's own factory, so the decision model reaches a connection exactly as a chat does. */
  adapter(provider: string, model: string): Promise<ModelAdapter>;
  /** Where each request's usage is counted, on the connection it went through. Unset in tests that do not look at usage. */
  recordUsage?(entry: DecisionUsageEntry): void;
  fetcher?: Fetcher;
  timeoutMs?: number;
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

/**
 * The decision model (COD-303): typed questions answered through an API. With OpenAI selected the request goes to its Decisions
 * API; with any other connection the connection's chat adapter answers the same questions (emulated.ts). The setting
 * names one connection and one model, and nothing falls back to another: a request that cannot be answered returns
 * `undefined`, and the caller carries on as it did before the decision model existed. Every request that reaches the
 * provider is counted against that connection (budgets/decision-usage.ts), and against the chat when the caller names it.
 */
export class Decisions {
  constructor(private readonly dependencies: DecisionsDependencies) {}

  /**
   * Whether the decision model could answer: false only when the person turned it off. An unset choice counts as on, since the
   * default depends on an OpenAI key that `decide` looks up; without one `decide` returns `undefined` at once.
   */
  isEnabled(): boolean {
    return this.dependencies.saved() !== 'off';
  }

  async view(): Promise<DecisionModelSettingView> {
    const saved = this.dependencies.saved();
    const openAiKeySaved = saved === undefined && !!(await this.dependencies.readKey('openai').catch(() => null));
    return { setting: effectiveDecisionModelSetting(saved, openAiKeySaved), chosen: saved !== undefined };
  }

  async save(setting: DecisionModelSetting): Promise<DecisionModelSettingView> {
    this.dependencies.save(setting);
    return this.view();
  }

  /**
   * Answers `questions` about `state`, or `undefined` when the decision model is off, has no key, takes longer than 15 seconds, or
   * gets a reply it cannot read. `maxLength` is the state's room in tokens; a longer state is cut to its start.
   */
  async decide(state: DecisionState, questions: DecisionQuestions, maxLength = DEFAULT_MAX_LENGTH, context: DecisionContext = {}): Promise<DecisionResponse | undefined> {
    const checked = { state: StateSchema.parse(state), questions: QuestionsSchema.parse(questions) };
    const { setting } = await this.view();
    if (setting === 'off') return undefined;
    try {
      return await this.ask(setting, checked.state, checked.questions, maxLength, context);
    } catch {
      return undefined;
    }
  }

  /** One sample decision for Settings → Test, with the reason when it fails and how long it took when it works. */
  async test(): Promise<DecisionModelTestResult> {
    const { setting } = await this.view();
    if (setting === 'off') throw new Error('Model quyết định đang tắt. Chọn một kết nối trước.');
    const started = Date.now();
    const response = await this.ask(setting, SAMPLE_TEXT, SAMPLE_QUESTIONS, DEFAULT_MAX_LENGTH, {});
    const answer = response.answers.kind;
    if (!answer || answer.type !== 'choice') throw new Error('Nhà cung cấp trả lời nhưng model quyết định không đọc được câu trả lời.');
    return { connection: setting.connection, model: setting.model, milliseconds: Date.now() - started, choice: answer.choice, probability: answer.probabilities[answer.choice] };
  }

  private async ask(setting: DecisionModelConnection, state: DecisionState, questions: DecisionQuestions, maxLength: number, context: DecisionContext): Promise<DecisionResponse> {
    const full = stateText(state);
    const room = Math.min(DECISION_MAX_STATE_CHARS, Math.max(1, maxLength) * CHARACTERS_PER_TOKEN);
    const input = full.length > room ? full.slice(0, room) : full;
    const signal = AbortSignal.timeout(this.dependencies.timeoutMs ?? DECISION_TIMEOUT_MS);
    let response: DecisionResponse;
    try {
      response = setting.connection === 'openai'
        ? await this.askOpenAi(setting, input, questions, signal)
        : await askThroughAdapter({ adapter: await this.dependencies.adapter(setting.connection, setting.model), model: setting.model, input, questions, signal });
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
    if (!key) throw new Error(`Chưa kết nối ${API_PROVIDER_NAMES.openai}. Mở Cài đặt để nhập API key.`);
    return askOpenAiDecisions({ fetcher: this.dependencies.fetcher ?? fetch, key, model: setting.model, input, questions, signal });
  }
}
