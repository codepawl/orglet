import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, FileText, FolderSearch, Search, Wrench } from 'lucide-react';
import type { Activity, Run } from '../../shared/contracts';
import type { ActivityKind, ActivityStep, HarnessProgress, RunProgressUpdate } from '../../shared/progress';

import { LiveIsland, type IslandState } from './LiveIsland';
import { Markdown } from './Markdown';
import { orglet } from '../api';
import { t } from '../i18n';

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
 * A worker's run as it happens: what it said it will do, one island for what it is doing now and the last thing it
 * did, and the answer appearing as it is written. The full step list, the timer and the worker's notes are the
 * receipt, not the headline, so they sit behind one quiet control below.
 */
export function LiveRun({ update, pausing }: { update: RunProgressUpdate; pausing: boolean }) {
  const progress = update.progress!;
  const island = islandOf(progress, pausing);
  const answering = progress.answer.length > 0;

  return <div className="live-run">
    {progress.preamble && <Markdown className="prose" text={progress.preamble} />}
    <LiveIsland state={island.state} label={island.label} receipt={island.receipt} />
    {answering && <Markdown className="prose live-answer" text={progress.answer} />}
    <ActivityGroup steps={progress.activity}>
      <ElapsedLine since={update.startedAt} />
      {progress.thinking && <p className="activity-notes">{progress.thinking}</p>}
    </ActivityGroup>
  </div>;
}

export type IslandView = { state: IslandState; label: string; receipt: string };

/**
 * The island's state from what the harness has streamed. Only steps the core observed are named: a read shows the
 * file, a search its pattern, and any other step is just a step, because its target is the tool's name, which says
 * nothing to the person reading. Pausing and writing win over an open step, since they are what happens next.
 */
export function islandOf(progress: HarnessProgress, pausing: boolean): IslandView {
  const receipt = receiptOf(progress.activity.findLast(step => step.done));
  if (pausing) return { state: 'pausing', label: t('Đang dừng sau bước này'), receipt };
  if (progress.writing) return { state: 'writing', label: t('Đang viết câu trả lời'), receipt };
  const current = progress.activity.findLast(step => !step.done);
  if (current) return { ...stepView(current), receipt };
  return { state: 'thinking', label: t('Đang suy nghĩ'), receipt };
}

function stepView(step: ActivityStep): { state: IslandState; label: string } {
  if (step.kind === 'read') return { state: 'reading', label: step.target ? t('Đang đọc {0}', [step.target]) : t('Đang đọc tệp') };
  if (step.kind === 'search') return { state: 'searching', label: step.target ? t('Đang tìm {0}', [step.target]) : t('Đang tìm') };
  if (step.kind === 'list') return { state: 'listing', label: t('Đang liệt kê tệp') };
  return { state: 'tool', label: t('Đang chạy một bước') };
}

/** The line above the pill: the last finished step, or nothing while none has finished. */
function receiptOf(step: ActivityStep | undefined): string {
  if (!step) return '';
  if (step.kind === 'read') return step.target ? t('Đã đọc {0}', [step.target]) : t('Đã đọc một tệp');
  if (step.kind === 'search') return step.target ? t('Đã tìm {0}', [step.target]) : t('Đã tìm xong');
  if (step.kind === 'list') return t('Đã liệt kê tệp');
  return t('Đã xong một bước');
}

function ElapsedLine({ since }: { since: number }) {
  const seconds = useElapsedSeconds(since);
  return <p className="activity-elapsed">{t('Đã chạy {0}s', [seconds])}</p>;
}

const savedStepPatterns: { kind: ActivityKind; pattern: RegExp }[] = [
  { kind: 'read', pattern: /^Đã đọc (.+)$/ },
  { kind: 'search', pattern: /^Đã tìm (.+)$/ },
  { kind: 'list', pattern: /^Đã liệt kê tệp (.+)$/ },
];

/** The reads and searches a finished run saved as activity, oldest first. */
export function savedSteps(events: Activity[], runId: string): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const event of events) {
    if (event.runId !== runId) continue;
    for (const { kind, pattern } of savedStepPatterns) {
      const match = pattern.exec(event.message);
      if (match) steps.push({ id: event.id, kind, target: match[1], done: true });
    }
  }
  return steps;
}

/**
 * The step list behind one quiet control, closed until the user opens it. `children` are shown after the steps when
 * open, for anything else the run keeps out of the headline (the timer, the worker's notes). With no steps the
 * control just says Chi tiết.
 */
export function ActivityGroup({ steps, children }: { steps: ActivityStep[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return <div className="activity-group">
    <button type="button" className="activity-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
      <span>{activitySummary(steps) || t('Chi tiết')}</span>
    </button>
    {open && <div className="activity-detail">
      {steps.length > 0 && <ul className="activity-steps">
        {steps.map(step => <li key={step.id} className={step.done ? 'activity-step' : 'activity-step running'}>
          <StepIcon kind={step.kind} />
          <span className="activity-verb">{stepVerb(step.kind)}</span>
          {step.target && <span className="activity-target">{step.target}</span>}
        </li>)}
      </ul>}
      {children}
    </div>}
  </div>;
}

function StepIcon({ kind }: { kind: ActivityKind }) {
  const size = 14;
  if (kind === 'read') return <FileText size={size} aria-hidden="true" />;
  if (kind === 'search') return <Search size={size} aria-hidden="true" />;
  if (kind === 'list') return <FolderSearch size={size} aria-hidden="true" />;
  return <Wrench size={size} aria-hidden="true" />;
}

function stepVerb(kind: ActivityKind) {
  if (kind === 'read') return t('Đọc');
  if (kind === 'search') return t('Tìm');
  if (kind === 'list') return t('Liệt kê tệp');
  return t('Dùng công cụ');
}

function activitySummary(steps: ActivityStep[]) {
  const count = (kind: ActivityKind) => steps.filter(step => step.kind === kind).length;
  const reads = count('read');
  const searches = count('search');
  const lists = count('list');
  const others = count('other');

  const parts: string[] = [];
  if (reads === 1) parts.push(t('Đọc 1 tệp'));
  if (reads > 1) parts.push(t('Đọc {0} tệp', [reads]));
  if (searches === 1) parts.push(t('Tìm 1 lần'));
  if (searches > 1) parts.push(t('Tìm {0} lần', [searches]));
  if (lists === 1) parts.push(t('Liệt kê tệp 1 lần'));
  if (lists > 1) parts.push(t('Liệt kê tệp {0} lần', [lists]));
  if (others === 1) parts.push(t('1 bước khác'));
  if (others > 1) parts.push(t('{0} bước khác', [others]));
  return parts.join(' · ');
}
