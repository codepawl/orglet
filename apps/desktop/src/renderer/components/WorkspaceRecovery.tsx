import { FolderOpen, Archive, ArchiveRestore, FileText, ChevronRight, CircleAlert, SquareTerminal, FilePen, FileCheck, FolderInput, FolderPlus, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Run } from '../../shared/contracts';
import type { RecoveryFile, RecoveryOutput, WorkspaceConflictReason, WorkspaceRecoveryView, UncertainCall } from '../../shared/workspace-recovery';
import type { WorkspaceChangeKind } from '../../shared/workspace-tools';
import { groupRecoveryAttempts, uncertainCallLabel, type AttemptState, type RecoveryAttempt } from '../../shared/recovery-attempts';
import { t, tMessage, translated } from '../i18n';
import { Button } from './ui';
import { Select } from './Select';
import { timeMarkLabel } from './TimeMark';

/*
 * Files and processes in chat Details (COD-191): one row per attempt, newest first, saying who ran it, when, and
 * what became of its files in plain words; its commands and unknown calls sit under it, folded. An attempt whose
 * unknown effect blocks the chat is named as such, and only an attempt that still needs a decision carries the
 * "Keep current files" action. Settled attempts fold behind "Show N earlier attempts".
 */

export type ReadProcessOutput = (processId: string, stream: 'stdout' | 'stderr', offset: number) => Promise<RecoveryOutput>;
export type ReadPrivateFile = (runId: string, path: string, offset: number) => Promise<RecoveryFile>;
/** Which attempt Details should scroll to when it opens from the chat; `at` changes on every request so a repeat scrolls again. */
export type RecoveryFocus = { runId?: string; at: number };

export const attemptElementId = (runId: string) => `recovery-attempt-${runId}`;

function PrivateFile({ runId, path, read, disabled }: { runId: string; path: string; read: ReadPrivateFile; disabled: boolean }) {
  const [page, setPage] = useState<RecoveryFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (offset = 0) => {
    setBusy(true);
    setError('');
    try {
      const next = await read(runId, path, offset);
      if (offset && page && page.hash !== next.hash) {
        setPage(undefined);
        throw new Error(t('File đã thay đổi. Mở lại từ đầu để kiểm tra.'));
      }
      setPage(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  };
  return <div className="workspace-process-output" aria-busy={busy}>
    <Button disabled={disabled || busy} onClick={() => void load()}><FileText size={15} />{t('Xem bản sửa riêng')}</Button>
    {page && <pre>{page.content || t('File trống.')}</pre>}
    {page?.nextOffset != null && <Button disabled={disabled || busy} onClick={() => void load(page.nextOffset!)}>
      <ChevronRight size={15} />{t('Trang tiếp theo')}
    </Button>}
    {error && <p role="alert">{tMessage(error)}</p>}
  </div>;
}

function ProcessOutput({ processId, read }: { processId: string; read: ReadProcessOutput }) {
  const [stream, setStream] = useState<'stdout' | 'stderr'>('stdout');
  const [output, setOutput] = useState<RecoveryOutput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (offset = 0) => {
    setBusy(true);
    setError('');
    try { setOutput(await read(processId, stream, offset)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  return <div className="workspace-process-output" aria-busy={busy}>
    <Select ariaLabel={t('Luồng đầu ra')} size="sm" value={stream} disabled={busy}
      options={[{ value: 'stdout', label: 'stdout' }, { value: 'stderr', label: 'stderr' }]}
      onChange={value => { setStream(value as 'stdout' | 'stderr'); setOutput(undefined); }} />
    <Button disabled={busy} onClick={() => void load()}>{t('Xem đầu ra')}</Button>
    {output && <pre>{output.content || t('Chưa có đầu ra.')}</pre>}
    {output?.nextOffset != null && <Button disabled={busy} onClick={() => void load(output.nextOffset!)}>{t('Trang đầu ra tiếp theo')}</Button>}
    {error && <p role="alert">{tMessage(error)}</p>}
  </div>;
}

/** The attempt's files in one phrase: what happened to them, or how many never reached the folder. */
export function attemptStateLabel(state: AttemptState, pendingChanges: number): string {
  switch (state) {
    case 'kept': return t('Đã giữ file hiện tại');
    case 'integrated': return t('Đã tích hợp');
    case 'not_applied': return pendingChanges === 1 ? t('Thay đổi chưa áp dụng: 1 file') : t('Thay đổi chưa áp dụng: {0} file', [pendingChanges]);
    case 'no_changes': return t('Không thay đổi file');
    case 'conflict': return t('Xung đột file');
    case 'uncertain': return t('Bản làm việc chưa rõ kết quả');
    case 'preparing': return t('Đang chuẩn bị bản làm việc');
    case 'integrating': return t('Đang tích hợp file');
  }
}

/** "Write lib/http.js", "Run node --test", "Apply lib/http.js"; a call journaled before its name was kept says only that it is unknown. */
export function uncertainCallText(call: Pick<UncertainCall, 'tool' | 'summary'>): string {
  const label = uncertainCallLabel(call);
  if (label.action === 'write' && label.target) return t('Ghi {0}', [label.target]);
  if (label.action === 'folder' && label.target) return t('Tạo thư mục {0}', [label.target]);
  if (label.action === 'move' && label.target) return t('Chuyển {0}', [label.target]);
  if (label.action === 'delete' && label.target) return t('Xóa {0}', [label.target]);
  if (label.action === 'run' && label.target) return t('Chạy {0}', [label.target]);
  if (label.action === 'apply' && label.target) return t('Áp dụng {0}', [label.target]);
  if (label.action === 'restore' && label.target) return t('Khôi phục {0}', [label.target]);
  if (label.tool && label.target) return `${label.tool} ${label.target}`;
  return label.tool ?? t('Thao tác không rõ tên');
}

function uncertainCallIcon(call: Pick<UncertainCall, 'tool' | 'summary'>) {
  const action = uncertainCallLabel(call).action;
  if (action === 'write') return FilePen;
  if (action === 'folder') return FolderPlus;
  if (action === 'move') return FolderInput;
  if (action === 'delete') return Trash2;
  if (action === 'run') return SquareTerminal;
  if (action === 'apply') return FileCheck;
  if (action === 'restore') return ArchiveRestore;
  return Wrench;
}

/** "6 commands · 2 exited 0, 4 failed", counting only what finished one way or the other and naming the rest. */
function commandsSummary(commands: RecoveryAttempt['commands']): string {
  const parts = [
    commands.passed ? t('{0} thoát 0', [commands.passed]) : '',
    commands.failed ? t('{0} lỗi', [commands.failed]) : '',
    commands.unfinished ? t('{0} chưa hoàn tất', [commands.unfinished]) : '',
  ].filter(Boolean);
  const total = commands.total === 1 ? t('1 lệnh') : t('{0} lệnh', [commands.total]);
  return parts.length ? `${total} · ${parts.join(', ')}` : total;
}

const changeLabels: Record<string, () => string> = {
  pending: () => t('Chưa áp dụng'), applied: () => t('Đã áp dụng'), conflict: () => t('Xung đột'), blocked: () => t('Bị chặn'),
};
/** What a hand-in step does, beside its path (COD-254); a file edit needs no word. */
const changeKindLabels: Partial<Record<WorkspaceChangeKind, string>> = translated({
  folder: 'Tạo thư mục', move: 'Chuyển', delete: 'Xóa', remove_folder: 'Xóa thư mục',
});
/** Why a step stopped: something the person did in their folder meanwhile, which the hand-in left alone. */
const conflictLabels: Record<WorkspaceConflictReason, string> = translated({
  changed: 'Tệp trong thư mục của bạn đã được sửa sau khi Tí bắt đầu; không ghi đè.',
  missing: 'Tệp hoặc thư mục này không còn trong thư mục của bạn.',
  exists: 'Đã có tệp hoặc thư mục ở đường dẫn này; không ghi đè.',
  not_empty: 'Thư mục không trống nên được giữ lại.',
});

type RecoveryChange = WorkspaceRecoveryView['copies'][number]['changes'][number];

function ChangeRow({ runId, change, busy, readFile, onRestore }: { runId: string; change: RecoveryChange; busy: boolean;
  readFile: ReadPrivateFile; onRestore?: (runId: string, path: string) => void }) {
  const kind = change.kind ?? 'write';
  const isFolder = kind === 'folder' || kind === 'remove_folder';
  const target = change.from ? `${change.from} → ${change.path}` : isFolder ? `${change.path}/` : change.path;
  const action = changeKindLabels[kind];
  const status = change.restored ? t('Đã khôi phục') : changeLabels[change.status]();
  const restorable = kind === 'delete' && change.status === 'applied' && !change.restored && onRestore;
  // Only a written file has private bytes worth reading; a move keeps the snapshot's bytes, a folder has none.
  return <li className="recovery-change">
    <span><code>{target}</code><span className="recovery-change-state"> · {action ? `${action} · ` : ''}{status}</span></span>
    {change.conflict && <p className="recovery-change-note">{conflictLabels[change.conflict]}</p>}
    {change.reason && <p className="recovery-change-note">{tMessage(change.reason)}</p>}
    {kind === 'write' && <PrivateFile runId={runId} path={change.path} read={readFile} disabled={busy} />}
    {restorable && <div className="workspace-process-output">
      <Button disabled={busy} aria-label={t('Khôi phục {0}', [change.path])} onClick={() => onRestore(runId, change.path)}>
        <ArchiveRestore size={15} />{t('Khôi phục')}
      </Button>
    </div>}
  </li>;
}
const processLabels: Record<string, () => string> = {
  running: () => t('Đang chạy'), exited: () => t('Đã dừng'), cancelled: () => t('Đã hủy'), timeout: () => t('Hết thời gian'),
  output_limit: () => t('Vượt giới hạn đầu ra'), uncertain: () => t('Chưa rõ kết quả'),
};

function AttemptRow({ attempt, busy, onRetire, onRestore, readOutput, readFile }: { attempt: RecoveryAttempt; busy: boolean;
  onRetire: (runId: string, reviewToken: string) => void; onRestore?: (runId: string, path: string) => void;
  readOutput: ReadProcessOutput; readFile: ReadPrivateFile }) {
  const copy = attempt.copy;
  const stateClass = attempt.blocking ? 'recovery-attempt-state blocking' : attempt.state === 'integrated' ? 'recovery-attempt-state settled' : 'recovery-attempt-state';
  return <li id={attemptElementId(attempt.runId)} className={attempt.blocking ? 'recovery-attempt blocking' : 'recovery-attempt'} tabIndex={-1}>
    <div className="recovery-attempt-head">
      <span className="recovery-attempt-who">
        <strong>{attempt.workerName}</strong>
        {attempt.startedAt && <time dateTime={attempt.startedAt}>{timeMarkLabel(attempt.startedAt)}</time>}
      </span>
      <span className={stateClass}>{attemptStateLabel(attempt.state, attempt.pendingChanges)}</span>
    </div>
    {attempt.blocking && <p className="recovery-attempt-flag"><CircleAlert size={14} aria-hidden="true" />{t('Đang chặn cuộc trò chuyện: kiểm tra rồi giữ file hiện tại để Tí ghi tiếp.')}</p>}
    {attempt.uncertainCalls.length > 0 && <ul className="recovery-calls">
      {attempt.uncertainCalls.map(call => {
        const Icon = uncertainCallIcon(call);
        return <li key={call.callId} className="recovery-call">
          <Icon size={14} aria-hidden="true" />
          <span className="recovery-call-text">
            <span>{uncertainCallText(call)}</span>
            <span className="muted">{call.at ? `${timeMarkLabel(call.at)} · ` : ''}{t('chưa rõ kết quả')}</span>
          </span>
        </li>;
      })}
    </ul>}
    {copy && copy.changes.length > 0 && <details className="recovery-group">
      <summary>{copy.changeCount === 1 ? t('1 thay đổi trong bản làm việc') : t('{0} thay đổi trong bản làm việc', [copy.changeCount])}</summary>
      {/* A retired attempt takes no new effect, so it offers no restore. */}
      <ul className="recovery-changes">{copy.changes.map(change => <ChangeRow key={`${change.kind ?? 'write'}:${change.path}`} runId={attempt.runId} change={change}
        busy={busy} readFile={readFile} onRestore={attempt.retired ? undefined : onRestore} />)}</ul>
      {copy.changeCount > copy.changes.length && <p className="muted">{t('Đang hiển thị {0} trên {1} thay đổi.', [copy.changes.length, copy.changeCount])}</p>}
    </details>}
    {attempt.processes.length > 0 && <details className="recovery-group">
      <summary>{commandsSummary(attempt.commands)}</summary>
      {attempt.processes.map(process => <details key={process.id} className="recovery-process">
        <summary><code>{process.command}</code> · {processLabels[process.state]()}{process.exitCode !== null ? ` (${process.exitCode})` : ''}</summary>
        <ProcessOutput processId={process.id} read={readOutput} />
      </details>)}
    </details>}
    {attempt.needsDecision && <div className="workspace-recovery-action">
      <Button variant="outline" disabled={busy} aria-label={t('Giữ file hiện tại · {0}', [attempt.workerName])}
        onClick={() => onRetire(attempt.runId, attempt.reviewToken)}>
        <Archive size={15} />{t('Giữ file hiện tại')}
      </Button>
    </div>}
  </li>;
}

export function WorkspaceRecovery({ view, runs, busy, focus, onRetire, onRestore, readOutput, readFile }: { view: WorkspaceRecoveryView; runs: Run[];
  busy: boolean; focus?: RecoveryFocus; onRetire: (runId: string, reviewToken: string) => void;
  /** Puts a file the hand-in deleted back from its private backup (COD-254). */
  onRestore?: (runId: string, path: string) => void; readOutput: ReadProcessOutput; readFile: ReadPrivateFile }) {
  const grouped = groupRecoveryAttempts(view, runs);
  const [showEarlier, setShowEarlier] = useState(false);
  const focusRunId = focus?.runId ?? grouped.blocking?.runId;
  const focusInEarlier = Boolean(focusRunId && grouped.earlier.some(attempt => attempt.runId === focusRunId));
  useEffect(() => {
    if (!focus || !focusRunId) return;
    if (focusInEarlier) setShowEarlier(true);
    // The row may only exist after the fold opens, so look for it on the next frame.
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(attemptElementId(focusRunId));
      if (!element) return;
      element.scrollIntoView({ block: 'center' });
      element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus?.at, focusRunId, focusInEarlier]);
  if (!grouped.shown.length) return null;
  const row = (attempt: RecoveryAttempt) => <AttemptRow key={attempt.runId} attempt={attempt} busy={busy} onRetire={onRetire} onRestore={onRestore}
    readOutput={readOutput} readFile={readFile} />;
  return <section className="details-section workspace-recovery" aria-labelledby="workspace-recovery-heading">
    <h3 id="workspace-recovery-heading"><FolderOpen size={15} aria-hidden="true" />{t('File và tiến trình')}</h3>
    <ol className="recovery-attempts">{grouped.shown.map(row)}</ol>
    {grouped.earlier.length > 0 && <button type="button" className="tree-more" aria-expanded={showEarlier} onClick={() => setShowEarlier(value => !value)}>
      {showEarlier ? t('Ẩn các lần thử trước') : t('Hiện {0} lần thử trước', [grouped.earlier.length])}
    </button>}
    {showEarlier && grouped.earlier.length > 0 && <ol className="recovery-attempts">{grouped.earlier.map(row)}</ol>}
    {view.truncated && <p className="muted">{t('Chỉ hiển thị 100 mục gần nhất trong mỗi nhóm.')}</p>}
  </section>;
}
