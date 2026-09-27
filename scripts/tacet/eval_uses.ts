/**
 * Measures candidate questions for Tacet's two COD-306 uses on the real model, before any is wired in: which notes fit
 * a message (`knowledge_cases.json`) and which browser or desktop steps send, pay, delete or publish
 * (`action_cases.json`). Prints the ranking quality (AUC) and precision and recall per threshold on the tune and
 * held-out cases, and the latency of each request.
 *
 *   node node_modules/esbuild/bin/esbuild scripts/tacet/eval_uses.ts --bundle --platform=node --format=esm \
 *       --external:onnxruntime-node --outfile=scripts/tacet/.eval_uses.mjs
 *   node scripts/tacet/.eval_uses.mjs <tacet-sonata-int8-embeddings.onnx> <tokenizer.json> [knowledge|actions] [candidate]
 *
 * VERBOSE=1 lists every case with its value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TacetEngine } from '../../apps/desktop/src/core/decisions/engine';
import * as risk from '../../apps/desktop/src/core/decisions/action-risk';
import * as fit from '../../apps/desktop/src/core/decisions/knowledge-fit';
import { keywordScore } from '../../apps/desktop/src/core/context/compiler';
import { classifyBrowserStep } from '../../apps/desktop/src/core/tools/browser-risk';
import { classifyDesktopStep } from '../../apps/desktop/src/core/tools/desktop-risk';
import type { DecisionAnswer, DecisionQuestions, DecisionState } from '../../apps/desktop/src/shared/decisions';

type Note = { title: string; content: string; tags: string[] };
type Pair = { split: 'tune' | 'test'; message: string; note: string; relevant: boolean };
type KnowledgeCases = { notes: Record<string, Note>; pairs: Pair[] };
type ActionCase = { split: 'tune' | 'test'; surface: 'browser' | 'desktop'; kind: string; name: string; role?: string; controlType?: string; site?: string; title?: string; program?: string; window?: string; inDialog?: boolean; risky: boolean };
type Scored = { split: string; truth: boolean; value: number; label: string };

const noulOf = (answer: DecisionAnswer) => answer.type === 'noul' ? answer.noul : Number.NaN;
const scoreShare = (answer: DecisionAnswer) => answer.type === 'score' ? answer.score / (Object.keys(answer.probabilities).length - 1) : Number.NaN;
const choiceShare = (answer: DecisionAnswer, options: string[]) => answer.type === 'choice' ? options.reduce((sum, option) => sum + (answer.probabilities[option] ?? 0), 0) : Number.NaN;

/** One question about one note and one message; the note and the message are the state. */
type PairCandidate = { shape: 'pair'; name: string; state: (message: string, note: Note) => DecisionState; questions: DecisionQuestions; read: (answers: Record<string, DecisionAnswer>) => number };
/** The message is the state and every note is an option of one question, the way Tacet routes a ticket to a team. */
type RouteCandidate = { shape: 'route'; name: string; routing: (notes: Record<string, Note>) => { questions: DecisionQuestions; noteOf: Map<string, string> }; read: (answers: Record<string, DecisionAnswer>, noteOf: Map<string, string>, noteKey: string) => number };

const pairState = (message: string, note: Note): DecisionState => ({ message, note: `${note.title}: ${note.content}` });

/** A note's probability averaged over every choice question of the request. */
function routeShare(answers: Record<string, DecisionAnswer>, noteOf: Map<string, string>, noteKey: string): number {
  const name = [...noteOf].find(([, key]) => key === noteKey)?.[0] ?? '';
  const choices = Object.values(answers).filter(answer => answer.type === 'choice');
  return choices.reduce((sum, answer) => sum + (answer.probabilities[name] ?? 0), 0) / choices.length;
}

/** The shipped reading: the averaged probability, or 0 when "other" is at least as likely. */
function shippedShare(answers: Record<string, DecisionAnswer>, noteOf: Map<string, string>, noteKey: string): number {
  const { shares, other } = fit.noteShares(answers, noteOf);
  const share = shares.get(noteKey) ?? 0;
  return share > other ? share : 0;
}

/** Every note as a topic named by its title, with an optional description, plus "other". */
function topicRouting(notes: Record<string, Note>, instructions: string, describe: (note: Note) => string | null) {
  const noteOf = new Map<string, string>();
  const criteria: Record<string, string | null> = {};
  for (const [key, note] of Object.entries(notes)) {
    noteOf.set(note.title, key);
    criteria[note.title] = describe(note);
  }
  criteria.other = 'something else';
  return { questions: { note: { type: 'choice' as const, instructions, criteria } }, noteOf };
}

const knowledgeCandidates: (PairCandidate | RouteCandidate)[] = [
  { shape: 'pair', name: 'noul help', state: pairState, questions: { fit: { type: 'noul', instructions: 'Does the note help answer the message?' } }, read: answers => noulOf(answers.fit) },
  { shape: 'pair', name: 'noul same subject', state: pairState, questions: { fit: { type: 'noul', instructions: 'Is the note about the same subject as the message?' } }, read: answers => noulOf(answers.fit) },
  {
    shape: 'pair', name: 'score useful', state: pairState,
    questions: { fit: { type: 'score', instructions: 'How useful is the note for answering the message?', criteria: ['none: it is about something else', 'some: related, but not what the message needs', 'high: it guides how to do what the message asks'] } },
    read: answers => scoreShare(answers.fit),
  },
  {
    shape: 'pair', name: 'choice helps', state: pairState,
    questions: { fit: { type: 'choice', instructions: 'Does the note help with what the message asks?', criteria: { helps: 'the note is about what the message asks for', unrelated: 'the note is about something else' } } },
    read: answers => choiceShare(answers.fit, ['helps']),
  },
  {
    shape: 'route', name: 'route: topic by title and tags',
    routing: notes => topicRouting(notes, 'What is this message about?', note => note.tags.join(', ') || null),
    read: routeShare,
  },
  {
    shape: 'route', name: 'route: topic by title only',
    routing: notes => topicRouting(notes, 'What is this message about?', () => null),
    read: routeShare,
  },
  {
    shape: 'route', name: 'route: topic reversed order',
    routing: notes => topicRouting(Object.fromEntries(Object.entries(notes).reverse()), 'What is this message about?', note => note.tags.join(', ') || null),
    read: routeShare,
  },
  {
    shape: 'route', name: 'route: topic both orders in one pass',
    routing: notes => {
      const forward = topicRouting(notes, 'What is this message about?', note => note.tags.join(', ') || null);
      const backward = topicRouting(Object.fromEntries(Object.entries(notes).reverse()), 'What is this message about?', note => note.tags.join(', ') || null);
      return { questions: { note: forward.questions.note, again: backward.questions.note }, noteOf: forward.noteOf };
    },
    read: routeShare,
  },
  {
    shape: 'route', name: 'shipped: both orders, must beat other',
    routing: notes => fit.noteRouting(Object.entries(notes).map(([key, note]) => ({ id: key, ...note }))),
    read: shippedShare,
  },
];

const RISKY_KINDS = ['send', 'pay', 'delete', 'publish'];
type RiskCandidate = { name: string; state: (action: risk.ActionToJudge) => DecisionState; questions: DecisionQuestions; read: (answers: Record<string, DecisionAnswer>) => number };
const sentence = (action: risk.ActionToJudge) => risk.actionDescription(action);
const SIX_KINDS = {
  look: 'opens, shows, searches, sorts, filters or moves around',
  edit: 'changes a draft, a setting or the view, without sending anything',
  send: 'sends a message, a form or a file to someone',
  pay: 'pays, buys, orders, transfers or withdraws money',
  delete: 'deletes, trashes, cancels or closes something for good',
  publish: 'posts, publishes, shares or makes something public',
};
const riskCandidates: RiskCandidate[] = [
  { name: 'noul send/pay/delete/publish', state: sentence, questions: { risky: { type: 'noul', instructions: 'Does this step send, pay, delete or publish something?' } }, read: answers => noulOf(answers.risky) },
  { name: 'choice six kinds · sentence', state: sentence, questions: { does: { type: 'choice', instructions: 'What does this step do?', criteria: SIX_KINDS } }, read: answers => choiceShare(answers.does, RISKY_KINDS) },
  { name: 'choice six kinds · fields', state: risk.actionFields, questions: { does: { type: 'choice', instructions: 'What does this step do?', criteria: SIX_KINDS } }, read: answers => choiceShare(answers.does, RISKY_KINDS) },
  {
    name: 'choice two kinds · fields', state: risk.actionFields,
    questions: { does: { type: 'choice', instructions: 'What happens when this step is taken?', criteria: { harmless: 'it only opens, shows, searches, sorts, filters or moves around', consequential: 'it sends, pays, buys, transfers, deletes, cancels or publishes something' } } },
    read: answers => choiceShare(answers.does, ['consequential']),
  },
  {
    name: 'four nouls · fields', state: risk.actionFields,
    questions: {
      send: { type: 'noul', instructions: 'Does this step send a message, a form or a file to someone?' },
      pay: { type: 'noul', instructions: 'Does this step pay, buy, order, transfer or withdraw money?' },
      delete: { type: 'noul', instructions: 'Does this step delete, trash, cancel or close something?' },
      publish: { type: 'noul', instructions: 'Does this step post, publish or share something publicly?' },
    },
    read: answers => Math.max(noulOf(answers.send), noulOf(answers.pay), noulOf(answers.delete), noulOf(answers.publish)),
  },
  {
    name: 'choice six kinds both orders · fields', state: risk.actionFields,
    questions: {
      does: { type: 'choice', instructions: 'What does this step do?', criteria: SIX_KINDS },
      again: { type: 'choice', instructions: 'What does this step do?', criteria: Object.fromEntries(Object.entries(SIX_KINDS).reverse()) },
    },
    read: answers => (choiceShare(answers.does, RISKY_KINDS) + choiceShare(answers.again, RISKY_KINDS)) / 2,
  },
  {
    name: 'choice six kinds both orders · sentence', state: sentence,
    questions: {
      does: { type: 'choice', instructions: 'What does this step do?', criteria: SIX_KINDS },
      again: { type: 'choice', instructions: 'What does this step do?', criteria: Object.fromEntries(Object.entries(SIX_KINDS).reverse()) },
    },
    read: answers => (choiceShare(answers.does, RISKY_KINDS) + choiceShare(answers.again, RISKY_KINDS)) / 2,
  },
  {
    name: 'six kinds and two kinds together · fields', state: risk.actionFields,
    questions: {
      does: { type: 'choice', instructions: 'What does this step do?', criteria: SIX_KINDS },
      happens: { type: 'choice', instructions: 'What happens when this step is taken?', criteria: { harmless: 'it only opens, shows, searches, sorts, filters or moves around', consequential: 'it sends, pays, buys, transfers, deletes, cancels or publishes something' } },
    },
    read: answers => (choiceShare(answers.does, RISKY_KINDS) + choiceShare(answers.happens, ['consequential'])) / 2,
  },
  { name: 'shipped question', state: risk.actionFields, questions: risk.ACTION_RISK_QUESTIONS, read: answers => risk.riskShare(answers) ?? Number.NaN },
];

function report(name: string, scored: Scored[]) {
  const thresholds = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
  console.log(`\n== ${name}`);
  for (const split of ['tune', 'test', 'all']) {
    const rows = scored.filter(item => split === 'all' || item.split === split);
    const positives = rows.filter(item => item.truth).map(item => item.value);
    const negatives = rows.filter(item => !item.truth).map(item => item.value);
    let ordered = 0;
    for (const positive of positives) for (const negative of negatives) ordered += positive > negative ? 1 : positive === negative ? 0.5 : 0;
    const auc = ordered / (positives.length * negatives.length);
    console.log(`  ${split}: ${positives.length} positive, ${negatives.length} negative, AUC ${auc.toFixed(3)}; positive min ${Math.min(...positives).toFixed(3)}, negative max ${Math.max(...negatives).toFixed(3)}`);
    const cells = thresholds.map(threshold => {
      const truePositive = positives.filter(value => value >= threshold).length;
      const falsePositive = negatives.filter(value => value >= threshold).length;
      const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 1;
      return `${threshold.toFixed(2)}: P ${precision.toFixed(2)} R ${(truePositive / positives.length).toFixed(2)} FP ${falsePositive}`;
    });
    console.log(`    ${cells.join(' | ')}`);
  }
  if (process.env.VERBOSE) for (const item of [...scored].sort((left, right) => right.value - left.value)) console.log(`    ${item.truth ? '+' : '-'} ${item.value.toFixed(3)} ${item.split} ${item.label}`);
}

/** Precision, recall and wrong picks at the shipped threshold, per split. */
function atShipped(scored: Scored[], threshold: number) {
  for (const split of ['tune', 'test', 'all']) {
    const rows = scored.filter(item => split === 'all' || item.split === split);
    const positives = rows.filter(item => item.truth);
    const truePositive = positives.filter(item => item.value >= threshold).length;
    const falsePositive = rows.filter(item => !item.truth && item.value >= threshold).length;
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 1;
    console.log(`  shipped ${threshold.toFixed(3)} · ${split}: precision ${precision.toFixed(2)}, recall ${truePositive}/${positives.length}, wrong ${falsePositive}/${rows.length - positives.length}`);
  }
}

function percentile(samples: number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

function actionOf(item: ActionCase): risk.ActionToJudge {
  if (item.surface === 'browser') return { surface: 'browser', kind: 'click', element: item.name, role: item.role ?? 'button', site: item.site ?? '', page: item.title ?? '' };
  return { surface: 'desktop', kind: 'invoke', element: item.name, controlType: item.controlType ?? 'button', program: item.program ?? '', window: item.window ?? '', inDialog: item.inDialog ?? false };
}

/** Whether today's word rules already ask about the step, from facts filled in the way a plain button reports them. */
function rulesAsk(item: ActionCase): boolean {
  if (item.surface === 'browser') {
    const target = { ref: 'e1', role: item.role ?? 'button', name: item.name, tag: item.role === 'link' ? 'a' : 'button', inputType: null, autocomplete: null, fieldName: null, editable: false, submits: false, form: null, link: null, inCaptcha: false };
    return classifyBrowserStep({ kind: 'click', target, page: { passwordField: false, cardField: false, payment: false, captcha: false } }).risk === 'consequential';
  }
  const target = { ref: 'e1', name: item.name, controlType: item.controlType ?? 'button', automationId: '', className: '', enabled: true, password: false, actions: ['invoke'], inDialog: item.inDialog ?? false, defaultButton: false, windowName: item.window ?? '' };
  return classifyDesktopStep({ kind: 'invoke', target }).risk === 'consequential';
}

async function evaluateKnowledge(engine: TacetEngine, only?: string) {
  const cases = JSON.parse(readFileSync(join(import.meta.dirname, 'knowledge_cases.json'), 'utf8')) as KnowledgeCases;
  const matched = cases.pairs.filter(pair => keywordScore(pair.message, cases.notes[pair.note]) > 0);
  console.log(`knowledge: ${cases.pairs.length} pairs, ${matched.length} already matched by keywords (${matched.map(pair => `${pair.note} <- ${pair.message}`).join('; ')})`);
  for (const candidate of knowledgeCandidates) {
    if (only && !candidate.name.includes(only)) continue;
    const timings: number[] = [];
    const scored: Scored[] = [];
    if (candidate.shape === 'pair') {
      for (const pair of cases.pairs) {
        const started = performance.now();
        const response = await engine.decide(candidate.state(pair.message, cases.notes[pair.note]), candidate.questions, fit.KNOWLEDGE_MAX_LENGTH);
        timings.push(performance.now() - started);
        scored.push({ split: pair.split, truth: pair.relevant, value: candidate.read(response.answers), label: `${pair.note} <- ${pair.message}` });
      }
    } else {
      // One pass per message, with every note of the workspace as an option.
      const { questions, noteOf } = candidate.routing(cases.notes);
      const messages = [...new Set(cases.pairs.map(pair => pair.message))];
      for (const message of messages) {
        const started = performance.now();
        const response = await engine.decide(fit.routingState(message), questions, fit.KNOWLEDGE_MAX_LENGTH);
        timings.push(performance.now() - started);
        if (process.env.VERBOSE) {
          const answer = Object.values(response.answers)[0];
          const top = answer.type === 'choice' ? Object.entries(answer.probabilities).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([name, share]) => `${name} ${share.toFixed(2)}`).join(', ') : '';
          console.log(`    ${response.usage.inputTokens} tokens · ${message} -> ${top}`);
        }
        for (const pair of cases.pairs.filter(item => item.message === message)) {
          scored.push({ split: pair.split, truth: pair.relevant, value: candidate.read(response.answers, noteOf, pair.note), label: `${pair.note} <- ${pair.message}` });
        }
      }
    }
    report(`knowledge · ${candidate.name} · p50 ${percentile(timings, 0.5).toFixed(0)} ms p95 ${percentile(timings, 0.95).toFixed(0)} ms`, scored);
    if (candidate.name.startsWith('shipped')) atShipped(scored, fit.fitThreshold(Object.keys(cases.notes).length));
    if (candidate.shape === 'route' && candidate.name.startsWith('shipped')) await evaluateSmallWorkspaces(engine, cases, candidate);
  }
}

/**
 * The same messages in a workspace of six notes instead of twenty: the two labelled for the message and four others,
 * picked in turn, so the threshold is checked where each option draws a larger share.
 */
async function evaluateSmallWorkspaces(engine: TacetEngine, cases: KnowledgeCases, candidate: RouteCandidate) {
  const keys = Object.keys(cases.notes);
  const messages = [...new Set(cases.pairs.map(pair => pair.message))];
  const timings: number[] = [];
  const scored: Scored[] = [];
  for (const [index, message] of messages.entries()) {
    const labelled = cases.pairs.filter(pair => pair.message === message);
    const others = keys.filter(key => !labelled.some(pair => pair.note === key));
    const chosen = [...labelled.map(pair => pair.note), ...Array.from({ length: 4 }, (_, offset) => others[(index * 4 + offset) % others.length])];
    const notes = Object.fromEntries(chosen.map(key => [key, cases.notes[key]]));
    const { questions, noteOf } = candidate.routing(notes);
    const started = performance.now();
    const response = await engine.decide(fit.routingState(message), questions, fit.KNOWLEDGE_MAX_LENGTH);
    timings.push(performance.now() - started);
    for (const pair of labelled) scored.push({ split: pair.split, truth: pair.relevant, value: candidate.read(response.answers, noteOf, pair.note), label: `${pair.note} <- ${pair.message}` });
  }
  report(`knowledge · ${candidate.name} · six notes · p50 ${percentile(timings, 0.5).toFixed(0)} ms p95 ${percentile(timings, 0.95).toFixed(0)} ms`, scored);
  atShipped(scored, fit.fitThreshold(6));
}

async function evaluateActions(engine: TacetEngine, only?: string) {
  const cases = (JSON.parse(readFileSync(join(import.meta.dirname, 'action_cases.json'), 'utf8')) as { cases: ActionCase[] }).cases;
  const caught = cases.filter(rulesAsk);
  console.log(`actions: ${cases.length} steps (${cases.filter(item => item.risky).length} risky); the word rules already ask on ${caught.length}: ${caught.map(item => `${item.name}${item.risky ? '' : ' (benign!)'}`).join(', ')}`);
  for (const candidate of riskCandidates) {
    if (only && !candidate.name.includes(only)) continue;
    const timings: number[] = [];
    const scored: Scored[] = [];
    for (const item of cases) {
      const started = performance.now();
      const response = await engine.decide(candidate.state(actionOf(item)), candidate.questions, risk.ACTION_RISK_MAX_LENGTH);
      timings.push(performance.now() - started);
      scored.push({ split: item.split, truth: item.risky, value: candidate.read(response.answers), label: `${rulesAsk(item) ? '[rules] ' : ''}${risk.actionDescription(actionOf(item))}` });
    }
    report(`actions · ${candidate.name} · p50 ${percentile(timings, 0.5).toFixed(0)} ms p95 ${percentile(timings, 0.95).toFixed(0)} ms`, scored);
    if (!candidate.name.startsWith('shipped')) continue;
    atShipped(scored, risk.ACTION_RISK_THRESHOLD);
    // Tacet is only asked about what the rules let through: its catches there, and its extra asks on harmless steps.
    const passed = scored.filter((_, index) => !rulesAsk(cases[index]));
    const riskyPassed = passed.filter(item => item.truth);
    const benignPassed = passed.filter(item => !item.truth);
    const caught = riskyPassed.filter(item => item.value >= risk.ACTION_RISK_THRESHOLD).length;
    const extra = benignPassed.filter(item => item.value >= risk.ACTION_RISK_THRESHOLD).length;
    console.log(`  of the steps the rules let through: ${caught}/${riskyPassed.length} risky ones now ask; ${extra}/${benignPassed.length} harmless ones get an extra ask`);
  }
}

async function main() {
  const [modelPath, tokenizerPath, use, only] = process.argv.slice(2);
  const started = performance.now();
  const engine = await TacetEngine.load({ model: modelPath, tokenizer: tokenizerPath });
  console.log(`load ${(performance.now() - started).toFixed(0)} ms`);
  if (!use || use === 'knowledge') await evaluateKnowledge(engine, only);
  if (!use || use === 'actions') await evaluateActions(engine, only);
  await engine.close();
}

await main();
