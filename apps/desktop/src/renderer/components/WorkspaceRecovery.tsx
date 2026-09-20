import { FolderOpen, Archive, FileText, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Run } from '../../shared/contracts';
import type { RecoveryFile, RecoveryOutput, WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { t, tMessage } from '../i18n';
import { Button } from './ui';
import { Select } from './Select';

export type ReadProcessOutput = (processId: string, stream: 'stdout' | 'stderr', offset: number) => Promise<RecoveryOutput>;
export type ReadPrivateFile = (runId: string, path: string, offset: number) => Promise<RecoveryFile>;

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

export function WorkspaceRecovery({ view, runs, busy, onRetire, readOutput, readFile }: { view: WorkspaceRecoveryView; runs: Run[];
  busy: boolean; onRetire: (runId: string, reviewToken: string) => void; readOutput: ReadProcessOutput; readFile: ReadPrivateFile }) {
  if (!view.copies.length && !view.processes.length && !view.uncertainCalls.length) return null;
  const labels: Record<string, string> = {
    preparing: t('Đang chuẩn bị bản làm việc'), ready: t('Bản làm việc sẵn sàng'), integrating: t('Đang tích hợp file'),
    integrated: t('Đã tích hợp'), conflict: t('Xung đột'), uncertain: t('Chưa rõ kết quả'),
    pending: t('Chưa áp dụng'), applied: t('Đã áp dụng'), blocked: t('Bị chặn'),
    running: t('Đang chạy'), exited: t('Đã dừng'), cancelled: t('Đã hủy'), timeout: t('Hết thời gian'), output_limit: t('Vượt giới hạn đầu ra'),
  };
  const owner = (runId: string) => runs.find(run => run.id === runId)?.snapshot.worker.name ?? runId;
  const retired = (runId: string) => view.attempts.some(attempt => attempt.runId === runId && attempt.retired);
  const unresolved = view.uncertainCalls.filter(call => !retired(call.runId));
  return <section className="details-section workspace-recovery" aria-labelledby="workspace-recovery-heading">
    <h3 id="workspace-recovery-heading"><FolderOpen size={15} aria-hidden="true" />{t('File và tiến trình')}</h3>
    {view.copies.map(copy => <details key={copy.runId} open={['conflict', 'uncertain'].includes(copy.state)}>
      <summary>{owner(copy.runId)} · {retired(copy.runId) ? t('Đã kết thúc bản làm việc') : labels[copy.state]}</summary>
      <ul>{copy.changes.map(change => <li key={change.path}>
        <code>{change.path}</code> · {labels[change.status]}
        {change.reason && <p>{tMessage(change.reason)}</p>}
        <PrivateFile runId={copy.runId} path={change.path} read={readFile} disabled={busy} />
      </li>)}</ul>
      {copy.changeCount > copy.changes.length && <p className="muted">{t('Đang hiển thị {0} trên {1} thay đổi.', [copy.changes.length, copy.changeCount])}</p>}
    </details>)}
    {view.processes.map(process => <details key={process.id}>
      <summary>{owner(process.runId)} · {labels[process.state]}{process.exitCode !== null ? ` (${process.exitCode})` : ''}</summary>
      <code>{process.command}</code>
      <ProcessOutput processId={process.id} read={readOutput} />
    </details>)}
    {unresolved.length > 0 && <div>
      <p>{t('Có thao tác chưa rõ kết quả. Cần kiểm tra đầu ra trước khi tiếp tục.')}</p>
      <ul>{unresolved.map(call => <li key={`${call.runId}:${call.callId}`}>{owner(call.runId)} · <code>{call.callId}</code></li>)}</ul>
    </div>}
    {view.attempts.filter(attempt => !attempt.retired && runs.some(run => run.id === attempt.runId && run.status !== 'completed')).map(attempt =>
      <div className="workspace-recovery-action" key={attempt.runId}>
        <Button variant="outline" disabled={busy} onClick={() => onRetire(attempt.runId, attempt.reviewToken)}>
          <Archive size={15} />{t('Giữ file hiện tại · {0}', [owner(attempt.runId)])}
        </Button>
      </div>)}
    {view.truncated && <p className="muted">{t('Chỉ hiển thị 100 mục gần nhất trong mỗi nhóm.')}</p>}
  </section>;
}
