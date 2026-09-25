import { useEffect, useState } from 'react';
import type { Run, Worker } from '../../shared/contracts';
import type { RunMemory } from '../../shared/knowledge';
import type { ActivityStep, HarnessProgress, RunProgressUpdate } from '../../shared/progress';

import type { IslandState, IslandView } from './LiveIsland';
import { Markdown } from './Markdown';
import { orglet } from '../api';
import { t } from '../i18n';
import { liveTraceOf } from '../turnTrace';
import { turnNotices } from './turnNotices';
import { TurnTrace } from './TurnTrace';

/** Live progress for each streaming run of one task, keyed by run ID. */
export function useRunProgress(taskId: string) {
  const [updates, setUpdates] = useState<Record<string, RunProgressUpdate>>({});

  useEffect(() => {
    setUpdates({});
    return orglet.onProgress(update => {
      if (update.taskId !== taskId) return;
      setUpdates(current => {
        const next = { ...current };
        if (update.progress) next[update.runId] = update;
        else delete next[update.runId];
        return next;
      });
    });
  }, [taskId]);

  return updates;
}

/**
 * The run whose live progress this turn should show: a team's synthesis when it is streaming, otherwise whichever run
 * of the turn is streaming. A worker chat has no synthesis run, so without the fallback nothing would show.
 */
export function liveRunOf(runs: Run[], updates: Record<string, RunProgressUpdate>) {
  const streaming = (run: Run) => updates[run.id] !== undefined;
  const run = runs.find(item => item.stage === 'synthesis' && streaming(item)) ?? runs.find(streaming);
  return run ? { run, update: updates[run.id] } : undefined;
}

/**
 * The workers whose runs of this turn are really running (COD-169): streaming now, or reported running by the core.
 * The island shows their faces and counts them, so the count is evidence of work, never the team roster; a worker
 * with two such runs is one worker.
 */
export function workingWorkers(runs: readonly Run[], updates: Record<string, RunProgressUpdate>): Worker[] {
  const workers = new Map<string, Worker>();
  for (const run of runs) {
    const working = updates[run.id] !== undefined || run.status === 'running';
    if (working && !workers.has(run.snapshot.worker.id)) workers.set(run.snapshot.worker.id, run.snapshot.worker);
  }
  return [...workers.values()];
}

/** Seconds since a moment, refreshed every second while shown. */
function useElapsedSeconds(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * A worker's run as it happens: what it said it will do, and the answer appearing as it is written. What it is doing
 * now is the island, which sits on the prompt bar rather than here (COD-167, `islandOf` below and `IslandDock`). The
 * step list, the timer and the worker's notes are the receipt, not the headline, so they sit behind the same trace
 * control the finished answer keeps above its text (COD-220), so nothing appears under an answer that already reads
 * as complete (COD-212). With no rows and no notes there is nothing to open, and the timer is the line. `memories`
 * are the ones frozen with the run's context, the trace's first rows as soon as the run row carries them (COD-217).
 */
export function LiveRun({ update, memories }: { update: RunProgressUpdate; memories?: readonly RunMemory[] }) {
  const progress = update.progress!;
  const answering = progress.answer.length > 0;
  const entries = liveTraceOf(memories, progress.activity);
  const hasReceipt = entries.length > 0 || !!progress.thinking;
  const trace = hasReceipt
    ? <TurnTrace key="trace" entries={entries}>
      <ElapsedLine since={update.startedAt} />
      {progress.thinking && <p className="activity-notes">{progress.thinking}</p>}
    </TurnTrace>
    : <ElapsedLine key="trace" since={update.startedAt} plain />;
  const notices = turnNotices({ trace });

  return <div className="live-run">
    {notices.before}
    {progress.preamble && <Markdown className="prose" text={progress.preamble} />}
    {answering && <Markdown className="prose live-answer" text={progress.answer} />}
  </div>;
}

/**
 * The island's state from what the harness has streamed. Only steps the core observed are named: a read shows the
 * file, a search its pattern, and any other step is just a step, because its target is the tool's name, which says
 * nothing to the person reading. Pausing and writing win over an open step, since they are what happens next.
 */
export function islandOf(progress: HarnessProgress, pausing: boolean, workers: readonly Worker[]): IslandView {
  const receipt = receiptOf(progress.activity.findLast(step => step.done));
  return islandFor(doingOf(progress, pausing), workers, receipt);
}

/**
 * What a run is doing, with the sentence that names the worker doing it, and the same step without the name for a
 * row that already shows the worker (the Running view, COD-244).
 */
type Doing = { state: IslandState; sentence: (name: string) => string; line: () => string };

const pausingDoing: Doing = { state: 'pausing', sentence: () => t('Đang dừng sau bước này…'), line: () => t('Đang dừng sau bước này…') };
const thinkingDoing: Doing = { state: 'thinking', sentence: name => t('{0} đang suy nghĩ…', [name]), line: () => t('Đang suy nghĩ…') };
const writingDoing: Doing = { state: 'writing', sentence: name => t('{0} đang viết câu trả lời…', [name]), line: () => t('Đang viết câu trả lời…') };

function doingOf(progress: HarnessProgress, pausing: boolean): Doing {
  if (pausing) return pausingDoing;
  if (progress.writing) return writingDoing;
  const current = progress.activity.findLast(step => !step.done);
  if (current) return stepDoing(current);
  return thinkingDoing;
}

function stepDoing(step: ActivityStep): Doing {
  const target = step.target;
  if (step.kind === 'read') return { state: 'reading', sentence: name => target ? t('{0} đang đọc {1}…', [name, target]) : t('{0} đang đọc tệp…', [name]), line: () => target ? t('Đang đọc {0}…', [target]) : t('Đang đọc tệp…') };
  if (step.kind === 'search') return { state: 'searching', sentence: name => target ? t('{0} đang tìm {1}…', [name, target]) : t('{0} đang tìm…', [name]), line: () => target ? t('Đang tìm {0}…', [target]) : t('Đang tìm…') };
  if (step.kind === 'list') return { state: 'listing', sentence: name => t('{0} đang liệt kê tệp…', [name]), line: () => t('Đang liệt kê tệp…') };
  return { state: 'tool', sentence: name => t('{0} đang chạy một bước…', [name]), line: () => t('Đang chạy một bước…') };
}

/**
 * The island says who (COD-169): one worker is named with what it is doing; several are counted, with every face
 * shown, since the step on screen belongs to one of them. Pausing is the task's, not a worker's, so it has no name.
 * `workers` are the ones whose runs are really running (`workingWorkers`), never the roster.
 */
function islandFor(doing: Doing, workers: readonly Worker[], receipt?: string): IslandView {
  if (doing.state === 'pausing') return { state: doing.state, label: doing.sentence(''), receipt, workers };
  if (workers.length > 1) return { state: doing.state, label: t('{0} Tí đang làm việc…', [workers.length]), receipt, workers };
  const name = workers[0]?.name ?? 'Orglet';
  return { state: doing.state, label: doing.sentence(name), named: namedSentence(doing, name), receipt, workers };
}

/** Stands in for the name while the sentence is translated, so the words either side of it can be cut out. */
const NAME_SLOT = '\u0000';

/**
 * The sentence in three parts around the worker's name (COD-250), so the island can shorten a long name and keep
 * the action whole. Found in the translated sentence rather than assumed at its start: "Working with {0}…" puts
 * the name in the middle.
 */
function namedSentence(doing: Doing, name: string): IslandView['named'] {
  const parts = doing.sentence(NAME_SLOT).split(NAME_SLOT);
  if (parts.length !== 2) return undefined;
  const [before, after] = parts;
  return { before, name, after };
}

/** The line above the label: the last finished step, or nothing while none has finished. */
function receiptOf(step: ActivityStep | undefined): string {
  if (!step) return '';
  if (step.kind === 'read') return step.target ? t('Đã đọc {0}', [step.target]) : t('Đã đọc một tệp');
  if (step.kind === 'search') return step.target ? t('Đã tìm {0}', [step.target]) : t('Đã tìm xong');
  if (step.kind === 'list') return t('Đã liệt kê tệp');
  return t('Đã xong một bước');
}

/**
 * The island for a run that has not streamed anything yet, or never will: the few states the core's own events give
 * (planning, handing out, combining, a read it did itself, waiting for a turn). No receipt, because nothing finer
 * than these is observed. Details (versions, paths, costs) stay in Chi tiết. The first of `workers` is the run's own.
 */
export function islandBeforeStreaming({ workers, stage, message, pausing }: { workers: readonly Worker[]; stage?: Run['stage']; message?: string; pausing: boolean }): IslandView {
  return islandFor(doingBeforeStreaming({ stage, message, pausing }), workers);
}

function doingBeforeStreaming({ stage, message, pausing }: { stage?: Run['stage']; message?: string; pausing: boolean }): Doing {
  const read = message?.match(/^Đã đọc (.+)$/);
  if (pausing) return pausingDoing;
  if (stage === 'plan' || message === 'Đang phân việc.') return { state: 'thinking', sentence: name => t('{0} đang phân việc…', [name]), line: () => t('Đang phân việc…') };
  if (stage === 'member') return { state: 'thinking', sentence: name => t('Đang giao {0}…', [name]), line: () => t('Đang làm phần việc được giao…') };
  if (stage === 'synthesis' || message?.startsWith('Đang tổng hợp')) return { state: 'writing', sentence: name => t('{0} đang tổng hợp…', [name]), line: () => t('Đang tổng hợp…') };
  if (read) return { state: 'reading', sentence: name => t('{0} đang đọc {1}…', [name, read[1]]), line: () => t('Đang đọc {0}…', [read[1]]) };
  if (message?.startsWith('Đang chờ lượt')) return { state: 'waiting', sentence: name => t('{0} đang chờ lượt…', [name]), line: () => t('Đang chờ lượt…') };
  if (message === 'Model đang trả kết quả…') return writingDoing;
  return thinkingDoing;
}

/**
 * What a run is doing now as one line without the worker's name (COD-244): the streamed step when there is live
 * progress, otherwise what the core's own events say, in the same words the island uses.
 */
export function runStepLine({ progress, stage, message, pausing }: { progress?: HarnessProgress | null; stage?: Run['stage']; message?: string; pausing: boolean }): string {
  if (progress) return doingOf(progress, pausing).line();
  return doingBeforeStreaming({ stage, message, pausing }).line();
}

/** The live timer; `plain` is the line standing on its own above the text, in the folded control's place and colour. */
function ElapsedLine({ since, plain }: { since: number; plain?: boolean }) {
  const seconds = useElapsedSeconds(since);
  return <p className={plain ? 'activity-elapsed activity-elapsed-plain' : 'activity-elapsed'}>{t('Đã chạy {0}s', [seconds])}</p>;
}
