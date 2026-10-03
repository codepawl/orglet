import { useEffect, useState, type ReactNode } from 'react';
import { Settings2, X } from 'lucide-react';
import type { TaskDetail } from '../../shared/contracts';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { orglet } from '../api';
import { taskDetails } from '../caches';
import { t } from '../i18n';
import { focusMessage } from './messageMarks';
import { ThreadSkeleton } from './TaskThread';
import { Button } from './ui';

/**
 * A side thread open in the right panel beside its main chat (COD-365, after Slack's threads): the main chat stays in
 * view while the thread is read and answered here. The panel takes the place Details uses, so opening one closes the
 * other. It reads its own chat and what its runs changed, keeps both fresh on every change the core announces, marks
 * it seen while it is open, and hands them to `children`, which draws the thread and its prompt bar.
 */
export function SideThreadPanel({ taskId, title, orgletName, focusMessageId, onSettings, onClose, onSeen, children }: {
  taskId: string;
  title: string;
  orgletName: string;
  /** A message to bring into view once the thread is on screen (a search result or a notice that points into it). */
  focusMessageId?: string;
  onSettings: () => void;
  onClose: () => void;
  /** Called after the thread was marked seen, so the sidebar's unread mark can follow. */
  onSeen: () => void;
  children: (detail: TaskDetail, recovery: WorkspaceRecoveryView | undefined) => ReactNode;
}) {
  const { detail, recovery } = useSideThreadDetail(taskId);
  useMarkSeen(taskId, detail, onSeen);
  useFocusOnce(detail, focusMessageId);
  return <aside className="details-pane thread-pane" aria-label={t('Chat phụ: {0}', [title])}>
    <div className="details-head thread-pane-head">
      <div className="thread-pane-title">
        <h2>{title}</h2>
        <p>{t('Chat phụ với {0}', [orgletName])}</p>
      </div>
      <Button size="icon" aria-label={t('Thiết lập chat')} title={t('Thiết lập chat')} onClick={onSettings}><Settings2 size={18} /></Button>
      <Button size="icon" aria-label={t('Đóng chat phụ')} title={t('Đóng chat phụ')} onClick={onClose}><X size={18} /></Button>
    </div>
    <div className="thread-pane-body">
      {detail ? children(detail, recovery) : <ThreadSkeleton />}
    </div>
  </aside>;
}

/**
 * The thread's chat, from the shared cache at once and then read fresh on open and on every change, with what its
 * runs changed in their working copies, so its answers carry their changed-files lines as in the main pane.
 */
function useSideThreadDetail(taskId: string) {
  const [detail, setDetail] = useState<TaskDetail | undefined>(() => taskDetails.get(taskId));
  const [recovery, setRecovery] = useState<WorkspaceRecoveryView>();
  useEffect(() => {
    let live = true;
    setDetail(taskDetails.get(taskId));
    setRecovery(undefined);
    const load = () => {
      taskDetails.refresh(taskId)
        .then(next => { if (live) setDetail(next); })
        .catch(() => { /* the main chat's refresh reports anything that is actually wrong */ });
      orglet.call('workspaceRecovery', { taskId })
        .then(next => { if (live) setRecovery(next); })
        .catch(() => { /* without it the answers only lose their changed-files lines */ });
    };
    load();
    const stop = orglet.onChange(load);
    return () => {
      live = false;
      stop();
    };
  }, [taskId]);
  return { detail: detail?.task.id === taskId ? detail : undefined, recovery };
}

/** Marks the thread seen when it opens and again when a new answer lands while it is open. */
function useMarkSeen(taskId: string, detail: TaskDetail | undefined, onSeen: () => void) {
  const lastAnswer = detail?.task.lastArtifactId;
  useEffect(() => {
    if (!detail) return;
    void orglet.call('markTaskSeen', { id: taskId }).then(onSeen).catch(() => undefined);
  }, [taskId, Boolean(detail), lastAnswer]);
}

/** Brings one message into view the first time the thread is drawn with it. */
function useFocusOnce(detail: TaskDetail | undefined, messageId: string | undefined) {
  const loaded = Boolean(detail);
  useEffect(() => {
    if (!loaded || !messageId) return;
    const frame = requestAnimationFrame(() => focusMessage(messageId));
    return () => cancelAnimationFrame(frame);
  }, [loaded, messageId]);
}
