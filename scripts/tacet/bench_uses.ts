/**
 * Latency of Tacet's two COD-306 uses through the app's own path: the `Decisions` service, its worker thread and the
 * two pinned files, the way the core asks. Reports the first answer from a cold start (two hash checks and loading the
 * model), then warm answers for the knowledge question over the twenty measured notes and for the risk question.
 *
 *   node node_modules/esbuild/bin/esbuild apps/desktop/src/core/decisions/worker.ts --bundle --platform=node --format=esm \
 *       --external:onnxruntime-node --outfile=scripts/tacet/.decisions-worker.mjs
 *   node node_modules/esbuild/bin/esbuild scripts/tacet/bench_uses.ts --bundle --platform=node --format=esm \
 *       --external:onnxruntime-node --outfile=scripts/tacet/.bench_uses.mjs
 *   node scripts/tacet/.bench_uses.mjs <folder with the pinned ONNX file and tokenizer.json>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { workerRuntime } from '../../apps/desktop/src/core/decisions/worker-runtime';
import { askKnowledgeFit, type NoteCandidate } from '../../apps/desktop/src/core/decisions/knowledge-fit';
import { askActionRisk, type ActionToJudge } from '../../apps/desktop/src/core/decisions/action-risk';

type ActionCase = { surface: 'browser' | 'desktop'; name: string; role?: string; controlType?: string; site?: string; title?: string; program?: string; window?: string; inDialog?: boolean };

/** No budget: this measures how long an answer takes, so none may be cut short. */
const UNBOUNDED_MS = 600_000;

function percentile(samples: number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

async function timed(samples: number[], work: () => Promise<unknown>) {
  const started = performance.now();
  await work();
  samples.push(performance.now() - started);
}

async function main() {
  const [directory] = process.argv.slice(2);
  const decisions = new Decisions({ directory, runtime: workerRuntime(join(import.meta.dirname, '.decisions-worker.mjs')) });
  if (!decisions.isInstalled()) throw new Error(`No pinned Tacet files in ${directory}`);
  const knowledge = JSON.parse(readFileSync(join(import.meta.dirname, 'knowledge_cases.json'), 'utf8')) as { notes: Record<string, { title: string; tags: string[] }>; pairs: { message: string }[] };
  const notes: NoteCandidate[] = Object.entries(knowledge.notes).map(([key, note]) => ({ id: key, title: note.title, tags: note.tags }));
  const messages = [...new Set(knowledge.pairs.map(pair => pair.message))];
  const actions = (JSON.parse(readFileSync(join(import.meta.dirname, 'action_cases.json'), 'utf8')) as { cases: ActionCase[] }).cases.map((item): ActionToJudge => item.surface === 'browser'
    ? { surface: 'browser', kind: 'click', element: item.name, role: item.role ?? 'button', site: item.site ?? '', page: item.title ?? '' }
    : { surface: 'desktop', kind: 'invoke', element: item.name, controlType: item.controlType ?? 'button', program: item.program ?? '', window: item.window ?? '', inDialog: item.inDialog ?? false });

  const cold: number[] = [];
  await timed(cold, () => askActionRisk(decisions, actions[0], UNBOUNDED_MS));
  console.log(`cold first answer (hash checks, load, one risk question): ${cold[0].toFixed(0)} ms`);

  const knowledgeTimes: number[] = [];
  for (const message of messages) await timed(knowledgeTimes, () => askKnowledgeFit(decisions, message, notes, UNBOUNDED_MS));
  console.log(`knowledge, ${notes.length} notes, ${messages.length} messages: p50 ${percentile(knowledgeTimes, 0.5).toFixed(0)} ms, p95 ${percentile(knowledgeTimes, 0.95).toFixed(0)} ms, max ${Math.max(...knowledgeTimes).toFixed(0)} ms`);

  const riskTimes: number[] = [];
  for (const action of actions) await timed(riskTimes, () => askActionRisk(decisions, action, UNBOUNDED_MS));
  console.log(`risk, ${actions.length} steps: p50 ${percentile(riskTimes, 0.5).toFixed(0)} ms, p95 ${percentile(riskTimes, 0.95).toFixed(0)} ms, max ${Math.max(...riskTimes).toFixed(0)} ms`);
  await decisions.shutdown();
}

await main();
