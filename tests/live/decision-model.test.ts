import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { ACTION_RISK_THRESHOLD, askActionRisk, type ActionToJudge } from '../../apps/desktop/src/core/decisions/action-risk';
import { NOTEWORTHY_QUESTION, quietRunState } from '../../apps/desktop/src/core/orchestration/quiet-runs';
import { NOTEWORTHY_THRESHOLD } from '../../apps/desktop/src/shared/quiet-runs';

/**
 * Live decision model check against OpenAI's Decisions API. Gated on ORGLET_LIVE_KEY_FILE, like provider acceptance:
 *   $env:ORGLET_LIVE_KEY_FILE = 'C:\path\to\key.txt'; node node_modules/vitest/vitest.mjs run tests/live/decision-model.test.ts
 * It re-scores the labelled cases the thresholds were tuned on (scripts/tacet) and prints accuracy and timing; it asserts
 * only that answers come back, so a threshold move is a decision for a person, not a red test.
 */
const keyFile = process.env.ORGLET_LIVE_KEY_FILE;
const model = process.env.ORGLET_LIVE_DECISION_MODEL ?? 'gpt-6-luna';

/** A labelled step as the case file writes it: the element's name and the page title use the trace's older field names. */
type ActionCase = { split: string; surface: 'browser' | 'desktop'; kind: string; name: string; role?: string; site?: string; title?: string; text?: string; key?: string; controlType?: string; program?: string; window?: string; inDialog?: boolean; risky: boolean };

function actionOf(item: ActionCase): ActionToJudge {
  if (item.surface === 'desktop') {
    return { surface: 'desktop', kind: item.kind === 'toggle' ? 'toggle' : 'invoke', element: item.name, controlType: item.controlType ?? 'button', program: item.program ?? '', window: item.window ?? '', inDialog: item.inDialog ?? false };
  }
  const where = { element: item.name, role: item.role ?? 'button', site: item.site ?? '', page: item.title ?? '' };
  if (item.kind === 'type') return { surface: 'browser', kind: 'type', text: item.text ?? '', ...where };
  if (item.kind === 'press') return { surface: 'browser', kind: 'press', key: item.key ?? 'Enter', ...where };
  return { surface: 'browser', kind: 'click', ...where };
}
type QuietCase = { split: string; schedule: string; request: string; answer: string; noteworthy: boolean };

function readCases<T>(name: string): T[] {
  const file = JSON.parse(readFileSync(new URL(`../../scripts/tacet/${name}`, import.meta.url), 'utf8')) as T[] | { cases: T[] };
  return Array.isArray(file) ? file : file.cases;
}

function liveDecisions(): Decisions {
  const key = readFileSync(keyFile!, 'utf8').trim();
  return new Decisions({
    saved: () => [{ connection: 'openai', model }],
    save: () => {},
    readKey: async provider => provider === 'openai' ? key : null,
    adapter: async () => { throw new Error('Only the OpenAI Decisions API is used here.'); },
  });
}

/** Accuracy at the shipped threshold, and the threshold over the tune split that gets the most right. */
function summarise(scored: { score: number; expected: boolean; split: string }[], threshold: number) {
  const correctAt = (cut: number, rows: typeof scored) => rows.filter(row => (row.score >= cut) === row.expected).length;
  const tune = scored.filter(row => row.split === 'tune');
  const test = scored.filter(row => row.split !== 'tune');
  let best = threshold;
  for (let cut = 0.05; cut < 1; cut += 0.05) {
    if (correctAt(cut, tune) > correctAt(best, tune)) best = Math.round(cut * 100) / 100;
  }
  return {
    answered: scored.length,
    shipped: { threshold, tune: `${correctAt(threshold, tune)}/${tune.length}`, test: `${correctAt(threshold, test)}/${test.length}` },
    bestOnTune: { threshold: best, tune: `${correctAt(best, tune)}/${tune.length}`, test: `${correctAt(best, test)}/${test.length}` },
  };
}

function timing(milliseconds: number[]) {
  const sorted = [...milliseconds].sort((left, right) => left - right);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return { median: at(0.5), p90: at(0.9), max: sorted.at(-1) };
}

describe.skipIf(!keyFile)('decision model, live', () => {
  it('scores the browser and desktop steps', async () => {
    const decisions = liveDecisions();
    const scored: { score: number; expected: boolean; split: string }[] = [];
    const milliseconds: number[] = [];
    for (const item of readCases<ActionCase>('action_cases.json')) {
      const began = Date.now();
      const opinion = await askActionRisk(decisions, actionOf(item), 15_000);
      milliseconds.push(Date.now() - began);
      if (opinion) scored.push({ score: opinion.score, expected: item.risky, split: item.split });
    }
    console.log('action risk', JSON.stringify({ model, ...summarise(scored, ACTION_RISK_THRESHOLD), timing: timing(milliseconds) }));
    expect(scored.length).toBeGreaterThan(0);
  }, 600_000);

  it('scores whether a quiet schedule answer is worth announcing', async () => {
    const decisions = liveDecisions();
    const scored: { score: number; expected: boolean; split: string }[] = [];
    const milliseconds: number[] = [];
    for (const item of readCases<QuietCase>('quiet_run_cases.json')) {
      const began = Date.now();
      const response = await decisions.decide(quietRunState({ brief: item.request }, item.answer), NOTEWORTHY_QUESTION, 512, { background: true });
      milliseconds.push(Date.now() - began);
      const verdict = response?.answers.attention;
      if (verdict?.type === 'score') scored.push({ score: Math.min(1, Math.max(0, verdict.score / 2)), expected: item.noteworthy, split: item.split });
    }
    console.log('quiet runs', JSON.stringify({ model, ...summarise(scored, NOTEWORTHY_THRESHOLD), timing: timing(milliseconds) }));
    expect(scored.length).toBeGreaterThan(0);
  }, 600_000);
});
