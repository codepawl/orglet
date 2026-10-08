import { useState, type ReactNode } from 'react';
import type { Run, TaskDetail } from '../../shared/contracts';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { changedFilesOf } from '../changedFiles';
import { DiffDialog, type DiffReview } from './DiffViewer';
import { ChangedFilesCard } from './ChangedFilesCard';
import { confirmAction } from './confirm';
import { toast } from './toast';
import { orglet } from '../api';
import { t } from '../i18n';

/**
 * The diff viewer of one chat and the Apply and Discard it offers while a run's changes wait for review (COD-279). The
 * thread's files lines and the Changes view open the same viewer through `open`, so both decide the same way.
 */
export function useDiffReview({ detail, recovery, action, busy }: {
  detail: TaskDetail;
  recovery: WorkspaceRecoveryView | undefined;
  action: (perform: () => Promise<unknown>) => void;
  /** A run of this chat is under way, so nothing can be applied or discarded yet. */
  busy: boolean;
}): { open: (run: Run, focusPath?: string) => void; dialog: ReactNode } {
  const [diffRun, setDiffRun] = useState<Run>();
  // The file a row of the card asked for; the viewer opens scrolled to it.
  const [focusPath, setFocusPath] = useState<string>();
  const [deciding, setDeciding] = useState(false);
  const waiting = diffRun ? changedFilesOf([diffRun], recovery)[0]?.review?.state === 'pending' : false;
  const decide = (perform: () => Promise<void>) => {
    setDeciding(true);
    action(async () => {
      try {
        await perform();
      } finally {
        setDeciding(false);
      }
    });
  };
  const apply = (run: Run, paths?: string[]) => decide(async () => {
    await orglet.call('applyWorkspaceReview', { taskId: detail.task.id, runId: run.id, ...(paths ? { paths } : {}) });
    setDiffRun(undefined);
    toast(t('Đã áp dụng thay đổi vào thư mục.'), 'success');
  });
  const discard = async (run: Run) => {
    const confirmed = await confirmAction({ title: t('Bỏ các thay đổi này?'), description: t('Thư mục của bạn không bị sửa, và không áp dụng lại được.'),
      confirmLabel: t('Bỏ thay đổi'), cancelLabel: t('Giữ lại'), tone: 'danger' });
    if (!confirmed) return;
    decide(async () => {
      await orglet.call('discardWorkspaceReview', { taskId: detail.task.id, runId: run.id });
      setDiffRun(undefined);
      toast(t('Đã bỏ thay đổi. Thư mục của bạn không đổi.'), 'success');
    });
  };
  const review: DiffReview | undefined = diffRun && waiting ? {
    busy: deciding || busy,
    onApply: paths => { if (!deciding) apply(diffRun, paths); },
    onDiscard: () => { if (!deciding) void discard(diffRun); },
  } : undefined;
  const dialog = diffRun ? <DiffDialog taskId={detail.task.id} run={diffRun} review={review} focusPath={focusPath} onClose={() => setDiffRun(undefined)} /> : null;
  const open = (run: Run, path?: string) => {
    setFocusPath(path);
    setDiffRun(run);
  };
  return { open, dialog };
}

/** The person's words that started a turn, on one line, to head that turn's changes. */
function turnHeadline(detail: TaskDetail, revision: number): string {
  const latest = detail.task.inputRevision ?? 0;
  const brief = revision === latest
    ? detail.task.currentInput?.brief ?? detail.task.brief
    : detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision)?.snapshot.input?.brief ?? detail.task.brief;
  return brief.replace(/\s+/g, ' ').trim();
}

/** The runs that changed files, grouped by the turn they answered, newest turn first. */
function changedTurns(detail: TaskDetail, recovery: WorkspaceRecoveryView | undefined) {
  const lines = changedFilesOf(detail.runs, recovery);
  const revisions = [...new Set(lines.map(line => line.run.snapshot.inputRevision ?? 0))].sort((first, second) => second - first);
  return revisions.map(revision => ({ revision, lines: lines.filter(line => (line.run.snapshot.inputRevision ?? 0) === revision) }));
}

/** How many runs of the chat changed files: the Changes view's count. */
export function changedRunCount(detail: TaskDetail | undefined, recovery: WorkspaceRecoveryView | undefined): number {
  if (!detail || recovery?.taskId !== detail.task.id) return 0;
  return changedFilesOf(detail.runs, recovery).length;
}

/**
 * The Changes view (COD-355): every turn whose runs changed files in a working copy, newest first, headed by what the
 * person asked, with the same files line the thread shows under the answer. A line opens the diff viewer, where held
 * changes are applied or discarded. A crew's lines name their orglet.
 */
export function ChangesView({ detail, recovery, action }: { detail: TaskDetail; recovery: WorkspaceRecoveryView | undefined; action: (perform: () => Promise<unknown>) => void }) {
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const diff = useDiffReview({ detail, recovery, action, busy });
  const named = detail.runs.some(run => run.stage);
  return <div className="chat-view-list">
    {changedTurns(detail, recovery).map(turn => <section key={turn.revision} className="changes-turn" aria-label={turnHeadline(detail, turn.revision)}>
      <p className="changes-turn-brief" title={turnHeadline(detail, turn.revision)}>{turnHeadline(detail, turn.revision)}</p>
      {turn.lines.map(({ run, summary, review, restored }) => <ChangedFilesCard key={run.id} summary={summary} review={review} restored={restored}
        workerName={named ? run.snapshot.worker.name : undefined} onOpen={path => diff.open(run, path)} />)}
    </section>)}
    {diff.dialog}
  </div>;
}
