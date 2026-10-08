import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleEntry, runBundle, stressRoot } from './bundle.mjs';

/**
 * `pnpm stress` (node scripts/stress/run.mjs): seeds a synthetic profile for each tier, measures the core on it and,
 * with `--exe`, the packaged app, then prints one table. Everything is made under `ORGLET_STRESS_DIR` (default: the
 * system temp folder) and removed again unless `--keep` is given.
 *
 *   --tiers=x1,x10,x100   which tiers to run (default x1,x10)
 *   --exe=<Orglet.exe>    also measure this packaged app on each tier (real environment, isolated --user-data-dir)
 *   --reuse               use a profile already seeded in the folder instead of seeding again
 *   --keep                leave the seeded profiles and bundles in place
 *   --save=<name>         write the numbers to <folder>/results-<name>.json
 *   --compare=<name>      add a column with the numbers saved under that name
 *   --only=a,b            measure only these groups (commands, tick, context, writes, sources, backup, destructive)
 */
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, value] = argument.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
const tiers = String(options.tiers ?? 'x1,x10').split(',');
const executable = typeof options.exe === 'string' ? options.exe : undefined;

mkdirSync(stressRoot, { recursive: true });
const seedBundle = await bundleEntry('seed-cli');
const measureBundle = await bundleEntry('measure-core');
const results = {};

for (const tier of tiers) {
  const dataDirectory = join(stressRoot, tier, 'data');
  const summaryPath = join(stressRoot, `seed-${tier}.json`);
  if (!(options.reuse && existsSync(summaryPath))) {
    console.error(`[${tier}] seeding`);
    const seeded = await runBundle(seedBundle, [tier, dataDirectory], { inherit: false });
    if (seeded.status !== 0) throw new Error(`Seeding ${tier} failed.`);
    writeFileSync(summaryPath, seeded.output.trim().split('\n').at(-1));
  }
  console.error(`[${tier}] measuring the core`);
  const core = await runBundle(measureBundle, [summaryPath, join(stressRoot, tier, 'copy'), ...(typeof options.only === 'string' ? [options.only] : [])], { inherit: false });
  const line = core.output.split('\n').find(candidate => candidate.startsWith('RESULT '));
  if (!line) throw new Error(`Measuring ${tier} produced no result.`);
  results[tier] = { core: JSON.parse(line.slice('RESULT '.length)) };
  if (executable) {
    console.error(`[${tier}] measuring the app`);
    const app = await runBundle(fileURLToPath(new URL('./measure-app.mjs', import.meta.url)), [executable, summaryPath], { inherit: false });
    const appLine = app.output.split('\n').find(candidate => candidate.startsWith('APP_RESULT '));
    if (appLine) results[tier].app = JSON.parse(appLine.slice('APP_RESULT '.length));
  }
  if (!options.keep) rmSync(join(stressRoot, tier), { recursive: true, force: true });
}

if (typeof options.save === 'string') writeFileSync(join(stressRoot, `results-${options.save}.json`), JSON.stringify(results, null, 2));
const earlier = typeof options.compare === 'string' ? JSON.parse(readFileSync(join(stressRoot, `results-${options.compare}.json`), 'utf8')) : undefined;

/** [label, where in a result, how to show it] */
const rows = [
  ['database size (MB)', core => core.files?.databaseMB],
  ['core start: store open (ms)', core => core.start?.storeMilliseconds],
  ['workspace command (ms)', core => core.workspace?.milliseconds],
  ['workspace payload (KB)', core => core.workspace?.payloadBytes / 1024],
  ['task, heaviest chat (ms)', core => core.task_heavy?.milliseconds],
  ['task payload (KB)', core => core.task_heavy?.payloadBytes / 1024],
  ['task, ordinary chat (ms)', core => core.task_ordinary?.milliseconds],
  ['search, common word (ms)', core => core.search_common?.milliseconds],
  ['search, phrase (ms)', core => core.search_phrase?.milliseconds],
  ['core tick (ms)', core => core.tick?.milliseconds],
  ['schedule tick (ms)', core => core.routines_tick?.milliseconds],
  ['notes compile (ms)', core => core.notes_compile?.milliseconds],
  ['thread compaction, heaviest chat (ms)', core => core.thread_compact_heavy?.milliseconds],
  ['write: event in heaviest chat (ms)', core => core.write_event_heavy?.milliseconds],
  ['write: task row of heaviest chat (ms)', core => core.write_task_heavy?.milliseconds],
  ['app-wide usage totals (ms)', core => core.usage_all?.milliseconds],
  ['backup export (ms)', core => core.backup_export?.milliseconds ?? core.backup_export?.error?.slice(0, 40)],
  ['backup restore, onto the same data (ms)', core => core.backup_roundtrip?.restoreMilliseconds ?? core.backup_roundtrip?.error?.slice(0, 40)],
  ['backup restore, onto an erased profile (ms)', core => core.backup_restore_fresh?.milliseconds ?? core.backup_restore_fresh?.error?.slice(0, 40)],
  ['erase everything (ms)', core => core.erase?.milliseconds],
  ['core process memory after commands (MB RSS)', core => core.after_writes?.memory?.rssMB],
];
const appRows = [
  ['app: launch to first window (ms)', app => app?.firstWindowMs],
  ['app: launch to usable sidebar (ms)', app => app?.interactiveMs],
  ['app: core spawn to window (ms)', app => app?.coreSpawnToWindowMs],
  ['app: workspace call in the window (ms)', app => app?.workspaceCall?.milliseconds],
  ['app: task call in the window (ms)', app => app?.taskCall?.milliseconds],
  ['app: heaviest chat, first message painted (ms)', app => app?.openHeavyChat?.firstPaintMs],
  ['app: heaviest chat, settled (ms)', app => app?.openHeavyChat?.settledMs],
  ['app: messages in the DOM', app => app?.openHeavyChat?.userMessages],
  ['app: longest task while opening (ms)', app => app?.openHeavyChat?.longestTaskMs],
  ['app: search results (ms)', app => app?.search?.firstResultMs],
  ['app: one message, reads repeated (workspace + task calls)', app => app?.callsWhileSending ? `${app.callsWhileSending.byCommand.workspace?.count ?? 0} + ${app.callsWhileSending.byCommand.task?.count ?? 0}` : undefined],
  ['app: one message, bytes moved (KB)', app => app?.callsWhileSending ? app.callsWhileSending.totalBytes / 1024 : undefined],
  ['app: renderer memory after opening (MB)', app => app?.memoryAfterOpen?.rendererMB],
  ['app: core memory after opening (MB)', app => app?.memoryAfterOpen?.coreMB],
];
const show = value => value === undefined || Number.isNaN(value) ? '-' : typeof value === 'number' ? (Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en-US') : String(Math.round(value * 10) / 10)) : String(value);
const header = ['measurement', ...tiers.flatMap(tier => earlier?.[tier] ? [`${tier} (before)`, `${tier} (now)`] : [tier])];
const lines = [header, header.map(() => '---')];
for (const [label, pick] of rows) {
  lines.push([label, ...tiers.flatMap(tier => earlier?.[tier] ? [show(pick(earlier[tier].core)), show(pick(results[tier].core))] : [show(pick(results[tier].core))])]);
}
if (executable) {
  for (const [label, pick] of appRows) {
    lines.push([label, ...tiers.flatMap(tier => earlier?.[tier] ? [show(pick(earlier[tier].app)), show(pick(results[tier].app))] : [show(pick(results[tier].app))])]);
  }
}
console.log(lines.map(line => `| ${line.join(' | ')} |`).join('\n'));
if (!options.keep) rmSync(join(stressRoot, 'build'), { recursive: true, force: true });
