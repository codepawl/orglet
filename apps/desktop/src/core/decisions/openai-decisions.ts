import { z } from 'zod';
import type { DecisionAnswer, DecisionQuestion, DecisionQuestions, DecisionResponse, JsonValue } from '../../shared/decisions';
import { answerFromProbabilities, criterionText, noulFromProbability } from './answers';

/**
 * OpenAI's Decisions API (public beta, read 2026-10-07 from developers.openai.com/api/docs/guides/decisions): one
 * request carries a text and typed questions, and the answer carries a probability for every option. Tacet's three
 * question types map onto the API's three:
 *
 *   noul   -> predicate  (criteria.true / criteria.false are folded into the instructions)
 *   choice -> choice     (value = the option name, description = its criterion, or the name again)
 *   score  -> score      (label = the level's text, which is also its description)
 *
 * A plain `fetch` with a zod check of the reply, rather than the SDK: the repository's `openai` package predates the
 * endpoint, and the request is one POST.
 */

export const OPENAI_DECISIONS_URL = 'https://api.openai.com/v1/decisions';
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

type OpenAiQuestion =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: 'score'; name: string; instructions: string; levels: { label: string; description: string }[] };

/** A name the API accepts for sure: the question's own id when it is plain, else its position. */
export function questionName(id: string, index: number): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : `question_${index + 1}`;
}

function predicateInstructions(question: Extract<DecisionQuestion, { type: 'noul' }>): string {
  const meaning = (word: string, value: JsonValue | undefined) => (value === undefined ? [] : [`${word}: ${criterionText(value)}`]);
  const folded = [...meaning('True means', question.criteria?.true), ...meaning('False means', question.criteria?.false)];
  return folded.length ? `${question.instructions}\n\n${folded.join('\n')}` : question.instructions;
}

/** Score labels must tell the levels apart, so a repeated text gets its position. */
export function levelLabels(question: Extract<DecisionQuestion, { type: 'score' }>): string[] {
  const texts = question.criteria.map(criterion => criterionText(criterion));
  return texts.map((text, index) => (texts.indexOf(text) === index && texts.lastIndexOf(text) === index ? text : `${index + 1}. ${text}`));
}

export function openAiQuestions(questions: DecisionQuestions): { list: OpenAiQuestion[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const list = Object.entries(questions).map(([id, question], index): OpenAiQuestion => {
    const name = questionName(id, index);
    ids.set(name, id);
    if (question.type === 'noul') return { type: 'predicate', name, instructions: predicateInstructions(question) };
    if (question.type === 'choice') {
      const choices = Object.entries(question.criteria).map(([value, criterion]) => ({ value, description: criterionText(criterion) || value }));
      return { type: 'choice', name, instructions: question.instructions, choices };
    }
    const levels = levelLabels(question).map(label => ({ label, description: label }));
    return { type: 'score', name, instructions: question.instructions, levels };
  });
  return { list, ids };
}

const Probability = z.number().min(0).max(1);
const ChoiceProbabilities = z.array(z.object({ value: z.string(), probability: Probability }).passthrough());
const ScoreProbabilities = z.array(z.object({ value: z.union([z.string(), z.number()]).optional(), label: z.string().optional(), probability: Probability }).passthrough());
const ApiAnswer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('predicate'), name: z.string(), probability: Probability }).passthrough(),
  z.object({ type: z.literal('choice'), name: z.string(), probabilities: ChoiceProbabilities }).passthrough(),
  z.object({ type: z.literal('score'), name: z.string(), probabilities: ScoreProbabilities }).passthrough(),
  z.object({ type: z.literal('refusal'), name: z.string() }).passthrough(),
]);
const ApiReply = z.object({
  answers: z.array(z.unknown()),
  usage: z.object({ input_tokens: z.number().optional(), prompt_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

function scoreProbabilities(question: Extract<DecisionQuestion, { type: 'score' }>, given: z.infer<typeof ScoreProbabilities>): number[] | undefined {
  const labels = levelLabels(question);
  const byLabel = new Map(labels.map((label, level) => [label, level]));
  const placed: number[] = Array.from({ length: labels.length }, () => 0);
  if (given.every(entry => entry.label !== undefined && byLabel.has(entry.label))) {
    for (const entry of given) placed[byLabel.get(entry.label!)!] += entry.probability;
    return placed;
  }
  // Without usable labels the levels come back in the order they were sent.
  if (given.length !== labels.length) return undefined;
  return given.map(entry => entry.probability);
}

/** One API answer as Tacet's, or undefined for a refusal, an unknown option set or an impossible distribution. */
function convert(question: DecisionQuestion, raw: unknown): DecisionAnswer | undefined {
  const parsed = ApiAnswer.safeParse(raw);
  if (!parsed.success) return undefined;
  const answer = parsed.data;
  if (answer.type === 'refusal') return undefined;
  if (answer.type === 'predicate') return question.type === 'noul' ? noulFromProbability(answer.probability) : undefined;
  if (answer.type === 'choice' && question.type === 'choice') {
    const names = Object.keys(question.criteria);
    const known = new Map(answer.probabilities.map(entry => [entry.value, entry.probability]));
    return answerFromProbabilities(question, names.map(name => known.get(name) ?? 0));
  }
  if (answer.type === 'score' && question.type === 'score') {
    const placed = scoreProbabilities(question, answer.probabilities);
    return placed ? answerFromProbabilities(question, placed) : undefined;
  }
  return undefined;
}

/** Answers the API's reply gives for the questions asked; a refusal or a missing answer leaves its question out. */
export function answersFromReply(reply: unknown, questions: DecisionQuestions, ids: Map<string, string>): Record<string, DecisionAnswer> {
  const parsed = ApiReply.safeParse(reply);
  if (!parsed.success) return {};
  const answers: Record<string, DecisionAnswer> = {};
  for (const raw of parsed.data.answers) {
    const name = (raw as { name?: unknown } | null)?.name;
    const id = typeof name === 'string' ? ids.get(name) : undefined;
    if (id === undefined) continue;
    const converted = convert(questions[id], raw);
    if (converted) answers[id] = converted;
  }
  return answers;
}

export type OpenAiDecisionRequest = {
  fetcher: Fetcher;
  key: string;
  model: string;
  /** The state as text, already cut to size. */
  input: string;
  questions: DecisionQuestions;
  signal: AbortSignal;
  url?: string;
};

export async function askOpenAiDecisions(request: OpenAiDecisionRequest): Promise<DecisionResponse> {
  const { list, ids } = openAiQuestions(request.questions);
  const response = await request.fetcher(request.url ?? OPENAI_DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: request.model, input: request.input, questions: list }),
    signal: request.signal,
  });
  if (!response.ok) throw new Error(`OpenAI Decisions API trả về lỗi ${response.status}.`);
  const reply: unknown = await response.json().catch(() => undefined);
  const parsed = ApiReply.safeParse(reply);
  if (!parsed.success) throw new Error('OpenAI Decisions API trả lời không đúng dạng.');
  const inputTokens = parsed.data.usage?.input_tokens ?? parsed.data.usage?.prompt_tokens ?? Math.ceil(request.input.length / 4);
  return { model: request.model, answers: answersFromReply(reply, request.questions, ids), usage: { inputTokens } };
}
