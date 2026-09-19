import { useEffect, useState } from 'react';
import { ChevronRight, FileText, FolderSearch, Search, Wrench } from 'lucide-react';
import type { Activity, Run } from '../../shared/contracts';
import type { ActivityKind, ActivityStep, RunProgressUpdate } from '../../shared/progress';

import { Markdown } from './Markdown';
import { WorkingLine } from './Working';
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
 * A worker's run as it happens, modelled on streaming coding agents: what it said it will do, the files it reads and
 * searches (open while it works, folded into one line once it writes), a timer while it thinks, and the answer
 * appearing as it is written.
 */
export function LiveRun({ update, pausing, onStop }: { update: RunProgressUpdate; pausing: boolean; onStop: () => void }) {
  const progress = update.progress!;
  const answering = progress.answer.length > 0;

  return <div className="live-run">
    {progress.preamble && <Markdown className="prose" text={progress.preamble} />}
    {progress.activity.length > 0 && <ActivityGroup steps={progress.activity} folded={progress.writing} />}
    {answering && <Markdown className="prose live-answer" text={progress.answer} />}
    <WorkingRow
      startedAt={update.startedAt}
      label={pausing ? t('Đang dừng sau bước này…') : progress.writing ? t('Đang viết câu trả lời…') : t('Đang suy nghĩ…')}
      thinking={progress.thinking}
      onStop={onStop}
    />
  </div>;
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

export function ActivityGroup({ steps, folded }: { steps: ActivityStep[]; folded: boolean }) {
  // The group follows the run (open while working, folded once writing) until the user opens or closes it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !folded;

  return <div className="activity-group">
    <button type="button" className="activity-summary" aria-expanded={open} onClick={() => setChoice(!open)}>
      <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
      <span>{activitySummary(steps)}</span>
    </button>
    {open && <ul className="activity-steps">
      {steps.map(step => <li key={step.id} className={step.done ? 'activity-step' : 'activity-step running'}>
        <StepIcon kind={step.kind} />
        <span className="activity-verb">{stepVerb(step.kind)}</span>
        {step.target && <span className="activity-target">{step.target}</span>}
      </li>)}
    </ul>}
  </div>;
}

function WorkingRow({ startedAt, label, thinking, onStop }: { startedAt: number; label: string; thinking: string; onStop: () => void }) {
  const seconds = useElapsedSeconds(startedAt);
  const [showThinking, setShowThinking] = useState(false);

  return <div className="live-working">
    <WorkingLine label={label} seconds={seconds} expanded={showThinking}
      onToggleThinking={thinking ? () => setShowThinking(!showThinking) : undefined} onStop={onStop} />
    {thinking && showThinking && <p className="thinking-notes">{thinking}</p>}
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
