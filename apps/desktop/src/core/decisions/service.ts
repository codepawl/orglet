import type { DecisionQuestions, DecisionResponse, DecisionState, TacetConnection, TacetSetting, TacetSettingView, TacetTestResult } from '../../shared/decisions';
import { DecisionQuestions as QuestionsSchema, DecisionState as StateSchema, DECISION_MAX_STATE_CHARS, effectiveTacetSetting } from '../../shared/decisions';
import { API_PROVIDER_NAMES } from '../../shared/contracts';
import type { ModelAdapter } from '../adapters/openai';
import { stateText } from './answers';
import { askThroughAdapter } from './emulated';
import { askOpenAiDecisions, type Fetcher } from './openai-decisions';

/** What Tacet needs from the rest of the core: the saved choice, a key, and the adapter a connection chats through. */
export type DecisionsDependencies = {
  saved(): TacetSetting | undefined;
  save(setting: TacetSetting): void;
  readKey(provider: string): Promise<string | null>;
  /** The chat's own factory, so Tacet reaches a connection exactly as a chat does. */
  adapter(provider: string, model: string): Promise<ModelAdapter>;
  fetcher?: Fetcher;
  timeoutMs?: number;
};

/** A question that takes longer than this is left unanswered; nothing in Tacet is worth a stalled turn. */
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

/**
 * Tacet (COD-303): typed questions answered through an API. With OpenAI selected the request goes to its Decisions
 * API; with any other connection the connection's chat adapter answers the same questions (emulated.ts). The setting
 * names one connection and one model, and nothing falls back to another: a request that cannot be answered returns
 * `undefined`, and the caller carries on as it did before Tacet existed.
 */
export class Decisions {
  constructor(private readonly dependencies: DecisionsDependencies) {}

  /**
   * Whether Tacet could answer: false only when the person turned it off. An unset choice counts as on, since the
   * default depends on an OpenAI key that `decide` looks up; without one `decide` returns `undefined` at once.
   */
  isEnabled(): boolean {
    return this.dependencies.saved() !== 'off';
  }

  async view(): Promise<TacetSettingView> {
    const saved = this.dependencies.saved();
    const openAiKeySaved = saved === undefined && !!(await this.dependencies.readKey('openai').catch(() => null));
    return { setting: effectiveTacetSetting(saved, openAiKeySaved), chosen: saved !== undefined };
  }

  async save(setting: TacetSetting): Promise<TacetSettingView> {
    this.dependencies.save(setting);
    return this.view();
  }

  /**
   * Answers `questions` about `state`, or `undefined` when Tacet is off, has no key, takes longer than 15 seconds, or
   * gets a reply it cannot read. `maxLength` is the state's room in tokens; a longer state is cut to its start.
   */
  async decide(state: DecisionState, questions: DecisionQuestions, maxLength = DEFAULT_MAX_LENGTH): Promise<DecisionResponse | undefined> {
    const checked = { state: StateSchema.parse(state), questions: QuestionsSchema.parse(questions) };
    const { setting } = await this.view();
    if (setting === 'off') return undefined;
    try {
      return await this.ask(setting, checked.state, checked.questions, maxLength);
    } catch {
      return undefined;
    }
  }

  /** One sample decision for Settings → Test, with the reason when it fails and how long it took when it works. */
  async test(): Promise<TacetTestResult> {
    const { setting } = await this.view();
    if (setting === 'off') throw new Error('Tacet đang tắt. Chọn một kết nối trước.');
    const started = Date.now();
    const response = await this.ask(setting, SAMPLE_TEXT, SAMPLE_QUESTIONS, DEFAULT_MAX_LENGTH);
    const answer = response.answers.kind;
    if (!answer || answer.type !== 'choice') throw new Error('Nhà cung cấp trả lời nhưng Tacet không đọc được câu trả lời.');
    return { connection: setting.connection, model: setting.model, milliseconds: Date.now() - started, choice: answer.choice, probability: answer.probabilities[answer.choice] };
  }

  private async ask(setting: TacetConnection, state: DecisionState, questions: DecisionQuestions, maxLength: number): Promise<DecisionResponse> {
    const full = stateText(state);
    const room = Math.min(DECISION_MAX_STATE_CHARS, Math.max(1, maxLength) * CHARACTERS_PER_TOKEN);
    const input = full.length > room ? full.slice(0, room) : full;
    const signal = AbortSignal.timeout(this.dependencies.timeoutMs ?? DECISION_TIMEOUT_MS);
    const response = setting.connection === 'openai'
      ? await this.askOpenAi(setting, input, questions, signal)
      : await askThroughAdapter({ adapter: await this.dependencies.adapter(setting.connection, setting.model), model: setting.model, input, questions, signal });
    return input.length < full.length ? { ...response, usage: { ...response.usage, stateTruncated: true } } : response;
  }

  private async askOpenAi(setting: TacetConnection, input: string, questions: DecisionQuestions, signal: AbortSignal): Promise<DecisionResponse> {
    const key = await this.dependencies.readKey('openai');
    if (!key) throw new Error(`Chưa kết nối ${API_PROVIDER_NAMES.openai}. Mở Cài đặt để nhập API key.`);
    return askOpenAiDecisions({ fetcher: this.dependencies.fetcher ?? fetch, key, model: setting.model, input, questions, signal });
  }
}
