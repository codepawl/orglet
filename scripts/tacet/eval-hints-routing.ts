/**
 * Scores the permission hints and the group-chat routing (COD-305) on their labelled sets with the real model, through
 * the same worker thread and service the app uses, and measures how long each answer takes on this machine.
 *
 *   node node_modules/esbuild/bin/esbuild scripts/tacet/eval-hints-routing.ts --bundle --platform=node --format=esm \
 *       --external:onnxruntime-node --outfile=scripts/tacet/.eval-hints-routing.mjs
 *   node node_modules/esbuild/bin/esbuild apps/desktop/src/core/decisions/worker.ts --bundle --platform=node \
 *       --format=cjs --external:onnxruntime-node --outfile=scripts/tacet/.decisions-worker.cjs
 *   node scripts/tacet/.eval-hints-routing.mjs <folder holding tacet-sonata-int8-embeddings.onnx and tokenizer.json>
 *
 * The bundles sit beside this file, ignored by git, so they find onnxruntime-node in the checkout. The model folder is
 * only read; the worker checks both files against their pinned hashes before loading them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { workerRuntime } from '../../apps/desktop/src/core/decisions/worker-runtime';
import { PermissionSuggestions } from '../../apps/desktop/src/core/orchestration/permission-suggestions';
import { ROUTING_MAX_LENGTH, routedOrglet, routingQuestion, type RoutableOrglet } from '../../apps/desktop/src/core/decisions/group-routing';
import { isFolderNeed, type PermissionNeed } from '../../apps/desktop/src/shared/permission-needs';

type NeedCase = { split: 'tune' | 'held'; need: 'none' | 'web' | 'read' | 'edit' | 'run' | 'browser'; text: string };
type RoutingCase = { split: 'tune' | 'held'; group: string; expect: string; text: string };

const fixtures = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'tacet');
const needCases = (JSON.parse(readFileSync(join(fixtures, 'permission-needs.json'), 'utf8')) as { cases: NeedCase[] }).cases;
const routing = JSON.parse(readFileSync(join(fixtures, 'group-routing.json'), 'utf8')) as { groups: Record<string, Omit<RoutableOrglet, 'id'>[]>; cases: RoutingCase[] };

/** The labelled need as the hint would offer it: the folder's levels by their app names. */
const expectedNeed: Record<NeedCase['need'], PermissionNeed | undefined> = { none: undefined, web: 'web', read: 'read', edit: 'write', run: 'execute', browser: 'browser' };

function percentile(samples: number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

async function main() {
  const modelFolder = process.argv[2];
  const decisions = new Decisions({ directory: modelFolder, runtime: workerRuntime(join(import.meta.dirname, '.decisions-worker.cjs')) });
  if (!decisions.isInstalled()) throw new Error(`No Tacet files of the pinned size in ${modelFolder}`);
  const suggestions = new PermissionSuggestions(() => decisions);

  let started = performance.now();
  await decisions.decide('warm up', { warm: { type: 'noul', instructions: 'Is this a test?' } }, 256);
  console.log(`first answer (hash checks + load) ${(performance.now() - started).toFixed(0)} ms`);

  // Needs: the first need the core lists is the one a chat with nothing on would be offered.
  const tally = { tune: { right: 0, wrongKind: 0, falseHint: 0, silent: 0, total: 0 }, held: { right: 0, wrongKind: 0, falseHint: 0, silent: 0, total: 0 } };
  const kindRight = { tune: 0, held: 0 };
  const hintTimes: number[] = [];
  for (const item of needCases) {
    started = performance.now();
    const answer = await suggestions.suggest(item.text);
    hintTimes.push(performance.now() - started);
    const offered = answer?.needs[0];
    const expected = expectedNeed[item.need];
    const counts = tally[item.split];
    counts.total++;
    if (!offered) counts.silent += expected ? 1 : 0;
    else if (!expected) counts.falseHint++;
    else if (offered === expected) counts.right++;
    else counts.wrongKind++;
    const sameControl = offered && expected && (offered === expected || (isFolderNeed(offered) && isFolderNeed(expected)));
    if (sameControl) kindRight[item.split]++;
    if (!expected && !offered) counts.right++;
    console.log(`${offered === expected ? ' ' : 'X'} ${item.split} ${item.need.padEnd(8)} -> ${(answer?.needs.join(',') || '-').padEnd(16)} ${item.text.slice(0, 64)}`);
  }
  for (const split of ['tune', 'held'] as const) {
    const counts = tally[split];
    console.log(`needs ${split}: ${counts.right}/${counts.total} exactly right (a hint for the labelled need, or silence for none); ${kindRight[split]} offered the right control; ${counts.wrongKind} a wrong permission; ${counts.falseHint} a hint on a message that needed none; ${counts.silent} silent on a message that needed one`);
  }
  const warmHints = hintTimes.slice(1);
  console.log(`hint latency (suggest, core side, both passes when needed): p50 ${percentile(warmHints, 0.5).toFixed(0)} ms, p95 ${percentile(warmHints, 0.95).toFixed(0)} ms, max ${Math.max(...warmHints).toFixed(0)} ms over ${warmHints.length}`);

  // Routing: a pick is right when it names the labelled orglet; "kept" means everyone answers.
  const routes = { tune: { right: 0, wrong: 0, keptRight: 0, keptWrong: 0 }, held: { right: 0, wrong: 0, keptRight: 0, keptWrong: 0 } };
  const routeTimes: number[] = [];
  for (const item of routing.cases) {
    const orglets = routing.groups[item.group].map((orglet, index) => ({ ...orglet, id: `${item.group}-${index}` }));
    started = performance.now();
    const response = await decisions.decide(item.text, routingQuestion(orglets), ROUTING_MAX_LENGTH);
    routeTimes.push(performance.now() - started);
    const pick = routedOrglet(response, orglets);
    const counts = routes[item.split];
    if (pick && pick.orglet.name === item.expect) counts.right++;
    else if (pick) counts.wrong++;
    else if (item.expect === 'everyone') counts.keptRight++;
    else counts.keptWrong++;
    console.log(`${(pick?.orglet.name ?? 'everyone') === item.expect ? ' ' : 'X'} ${item.split} ${item.expect.padEnd(9)} -> ${(pick ? `${pick.orglet.name} ${pick.probability.toFixed(2)}` : 'everyone').padEnd(16)} ${item.text.slice(0, 60)}`);
  }
  for (const split of ['tune', 'held'] as const) {
    const counts = routes[split];
    console.log(`routing ${split}: ${counts.right} routed to the right orglet, ${counts.wrong} to a wrong one, ${counts.keptRight} kept everyone as labelled, ${counts.keptWrong} kept everyone where one orglet was labelled`);
  }
  console.log(`routing latency: p50 ${percentile(routeTimes, 0.5).toFixed(0)} ms, p95 ${percentile(routeTimes, 0.95).toFixed(0)} ms over ${routeTimes.length}`);
  await decisions.shutdown();
}

await main();
