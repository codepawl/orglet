import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { TaskDetail } from '../../shared/contracts';
import { Button } from './ui';
import { Select } from './Select';
import { HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { RunAuditView } from './RunAuditView';
import { ExactMatchView } from './ExactMatchView';
import { currentLocale, tMessage } from '../i18n';
import { orglet } from '../api';
import { Checkbox } from './Checkbox';
import { ChevronRight } from './icons';
import { fileKindIcon, fileKindLabel, fileSize } from './Attachment';
import { Input } from '@codepawl/orglet-ui';

export type SourceTarget = { type: 'source' | 'checker'; id: string; lines?: [number, number] };

/**
 * The chat's sources as a list of rows, each opening that one file in its own viewer, followed by the task-level
 * checks (preflight, local dataset checker, exact-match accuracy, run-log audit) and their results. A file's
 * content is never poured into this list (user, 2026-09-21).
 */
export function SourcePanel({ detail, refresh, target, openSource }: { detail: TaskDetail; refresh: () => void; target?: SourceTarget; openSource: (id: string) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); const [idColumn, setIdColumn] = useState('');
  const [direction, setDirection] = useState<'' | 'higher' | 'lower'>('');
  const [predictionSourceId, setPredictionSourceId] = useState('');
  const [answerSourceId, setAnswerSourceId] = useState('');
  const [scoreIdColumn, setScoreIdColumn] = useState('');
  const [predictionColumn, setPredictionColumn] = useState('');
  const [answerColumn, setAnswerColumn] = useState('');
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(`${target.type}-${target.id}`);
    if (!element) { setError(t('Tham chiếu không có trong công việc này.')); return; }
    if (element instanceof HTMLDetailsElement) element.open = true;
    element.scrollIntoView({ block: 'start' }); element.focus({ preventScroll: true });
  }, [target?.id, target?.type, detail.task.id]);
  async function audit() {
    if (!direction || selected.length !== 1) return;
    setBusy(true); setChecking(true); setError('');
    try { await orglet.call('auditRunLog', { taskId: detail.task.id, sourceId: selected[0], direction }); refresh(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); setChecking(false); }
  }
  async function profile() {
    setBusy(true); setChecking(true); setError('');
    try { await orglet.call('profileSources', { taskId: detail.task.id, sourceIds: selected, idColumn: idColumn.trim() || null }); refresh(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); setChecking(false); }
  }
  async function score() {
    setBusy(true); setChecking(true); setError('');
    try {
      await orglet.call('scoreExactMatch', { taskId: detail.task.id, predictionSourceId, answerSourceId,
        idColumn: scoreIdColumn.trim(), predictionColumn: predictionColumn.trim(), answerColumn: answerColumn.trim() });
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setChecking(false); }
  }
  return <div className="form">
    {!detail.sources.length && <p>{t('Task này không có tệp đính kèm.')}</p>}
    {detail.sources.length > 0 && <ul className="source-list" aria-label={t('Tệp đính kèm')}>
      {detail.sources.map(source => {
        const KindIcon = fileKindIcon(source.name);
        return <li key={source.id} id={`source-${source.id}`}>
          <button type="button" className="source-row" aria-haspopup="dialog" onClick={() => openSource(source.id)}>
            <KindIcon size={18} className="source-kind" />
            <span className="source-row-text">
              <span className="source-name">{source.name}</span>
              <span className={source.revoked ? 'source-meta revoked' : 'source-meta'}>{source.revoked ? t('Đã thu hồi quyền đọc') : `${fileKindLabel(source.name)} · ${fileSize(source.bytes)}`}</span>
            </span>
            <ChevronRight size={16} className="source-row-open" />
          </button>
        </li>;
      })}
    </ul>}
    {Boolean(detail.task.excludedSources?.length) && <details><summary>{t('{0} mục bị loại khi nhập nguồn', [detail.task.excludedSources!.length])}</summary><p className="muted">{t('Chỉ lưu trên máy; model chỉ nhận số lượng mục bị loại.')}</p><ul>{detail.task.excludedSources!.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
    {detail.preflights.map(record => <section key={record.id}><h3>{t('Kiểm tra trước review')}</h3>
      <p>{({ running: t('Đang kiểm tra'), paused: t('Đã tạm dừng'), cancelled: t('Đã hủy'), failed: t('Không xác minh được nguồn'), complete: t('Các checker đã hoàn tất'), partial: t('Một phần kiểm tra chưa hoàn tất'), insufficient_evidence: t('Chưa có dataset để kiểm tra') } as const)[record.status]}</p>
      <p className="muted">{t('{0} kết quả đã lưu. Checker xong không có nghĩa dữ liệu đạt yêu cầu.', [record.profileIds.length])}</p>
      <ul>{record.notices.map((notice, index) => <li key={index}>{notice.sourceId && <strong>{detail.sources.find(source => source.id === notice.sourceId)?.name}: </strong>}{tMessage(notice.message)}</li>)}</ul>
    </section>)}
    {error && <p role="alert" className="error">{error}</p>}
    {checking && <Button onClick={() => void orglet.call('cancelCheckers', { id: detail.task.id }).catch(err => setError((err as Error).message))}>{t('Hủy checker')}</Button>}
    {detail.sources.some(source => source.format) && <section className="form"><h3>{t('Kiểm tra dữ liệu trên máy')}</h3><p className="muted">{t('Chọn một hoặc hai dataset; đối chiếu ID cần tên cột chung.')}</p>{detail.sources.filter(source => source.format).map(source => <Checkbox key={source.id} checked={selected.includes(source.id)} disabled={source.revoked || busy || (!selected.includes(source.id) && selected.length >= 2)} onChange={event => setSelected(event.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))}>{source.name}</Checkbox>)}<label>{t('Cột ID (không bắt buộc)')}<Input value={idColumn} onChange={event => setIdColumn(event.target.value)} maxLength={256} placeholder={t('Ví dụ: id')} /></label><Button variant="outline" disabled={busy || !selected.length || selected.some(id => detail.sources.find(source => source.id === id)?.revoked)} onClick={() => void profile()}>{busy ? t('Đang kiểm tra…') : t('Chạy checker local')}</Button></section>}
    {detail.sources.filter(source => source.format && !source.revoked).length >= 2 && <section className="form"><h3>{t('Tính exact-match accuracy')}</h3>
      <p className="muted">{t('Chỉ tính trên cặp tệp và cột đã chọn; đây không phải điểm chính thức.')}</p>
      <Select label={t('Tệp predictions')} value={predictionSourceId} onChange={setPredictionSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...detail.sources.filter(source => source.format && !source.revoked).map(source => ({ value: source.id, label: source.name, disabled: source.id === answerSourceId }))]} />
      <Select label={t('Tệp answers')} value={answerSourceId} onChange={setAnswerSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...detail.sources.filter(source => source.format && !source.revoked).map(source => ({ value: source.id, label: source.name, disabled: source.id === predictionSourceId }))]} />
      <label>{t('Cột ID')}<Input value={scoreIdColumn} onChange={event => setScoreIdColumn(event.target.value)} maxLength={256} placeholder="id" /></label>
      <label>{t('Cột prediction')}<Input value={predictionColumn} onChange={event => setPredictionColumn(event.target.value)} maxLength={256} placeholder="prediction" /></label>
      <label>{t('Cột answer')}<Input value={answerColumn} onChange={event => setAnswerColumn(event.target.value)} maxLength={256} placeholder="answer" /></label>
      <Button variant="outline" disabled={busy || !predictionSourceId || !answerSourceId || predictionSourceId === answerSourceId || !scoreIdColumn.trim() || !predictionColumn.trim() || !answerColumn.trim()} onClick={() => void score()}>{busy ? t('Đang kiểm tra…') : t('Tính accuracy local')}</Button>
    </section>}
    {detail.sources.some(source => source.format) && <section className="form"><h3>{t('Kiểm tra run-log')}</h3>
      <p className="muted">{t('Chọn đúng một dataset ở trên, có các cột solution, run, split, metric, status và score.')}</p>
      <Select label={t('Chiều tối ưu của metric')} value={direction} onChange={value => setDirection(value as typeof direction)} options={[{ value: '', label: t('Chọn theo định nghĩa metric'), icon: <HelpCircle size={16} /> }, { value: 'higher', label: t('Điểm cao hơn tốt hơn'), icon: <TrendingUp size={16} /> }, { value: 'lower', label: t('Điểm thấp hơn tốt hơn'), icon: <TrendingDown size={16} /> }]} />
      <Button variant="outline" disabled={busy || !direction || selected.length !== 1 || selected.some(id => detail.sources.find(source => source.id === id)?.revoked)} onClick={() => void audit()}>{t('Kiểm tra run-log local')}</Button>
      <p className="muted">{t('Không chạy metric hay solution; rank đổi không tự chứng minh challenge lỗi.')}</p>
    </section>}
    {detail.profiles.map(profile => <details key={profile.id} id={`checker-${profile.id}`} tabIndex={-1}><summary>{profile.result.runAudit ? 'Run-log' : t('Kết quả checker')} · {new Date(profile.createdAt).toLocaleString(currentLocale())}</summary><>{profile.result.runAudit && <RunAuditView audit={profile.result.runAudit} />}{profile.result.exactMatch && <ExactMatchView score={profile.result.exactMatch} sources={detail.sources} />}</><p>{t('{0} · đọc toàn bộ nguồn trong giới hạn', [profile.result.engine])}</p>{profile.result.datasets.map(dataset => <section key={dataset.sourceId}><h4>{detail.sources.find(source => source.id === dataset.sourceId)?.name}</h4><p>{t('{0} dòng · {1} cột', [dataset.rows.toLocaleString(), dataset.columns.length])}</p><div className="profile-table"><table><thead><tr><th>{t('Cột')}</th><th>{t('Kiểu')}</th><th>Null</th><th>{t('Phân biệt')}</th></tr></thead><tbody>{dataset.columns.map(column => <tr key={column.name}><th>{column.name}</th><td>{column.type}</td><td>{column.nulls}</td><td>{column.distinctNonNull}</td></tr>)}</tbody></table></div>{dataset.id && <p>{t('ID {0}: {1} null, {2} dòng trùng ID không null.', [dataset.id.column, dataset.id.nulls, dataset.id.duplicateNonNull])}</p>}</section>)}{profile.result.comparison && <p>Schema: {profile.result.comparison.schemaMatches ? t('khớp') : t('khác')}.{profile.result.comparison.columnsMatch !== undefined && <> {' '}{t('Tên cột: {0}. Số dòng: {1}.', [profile.result.comparison.columnsMatch ? t('khớp') : t('khác'), profile.result.comparison.rowCountsMatch ? t('bằng nhau') : t('khác nhau')])}</>} {profile.result.comparison.overlappingDistinctIds !== null && <>{t('ID chung: {0}. Thứ tự ID: {1}.', [profile.result.comparison.overlappingDistinctIds, profile.result.comparison.sameIdOrder ? t('khớp') : t('khác')])}</>}{profile.result.comparison.onlyInFirst != null && <> {' '}{t('ID chỉ có ở tệp 1: {0}. ID chỉ có ở tệp 2: {1}.', [profile.result.comparison.onlyInFirst, profile.result.comparison.onlyInSecond])}</>}</p>}<p className="muted">Checks: {profile.result.checks.join(', ')}</p><ul>{profile.result.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul></details>)}
  </div>;
}
