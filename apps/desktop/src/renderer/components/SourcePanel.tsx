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

export type SourceTarget = { type: 'source' | 'checker'; id: string; lines?: [number, number] };
export function SourcePanel({ detail, refresh, target }: { detail: TaskDetail; refresh: () => void; target?: SourceTarget }) {
  const [preview, setPreview] = useState<{ id: string; text: string }>();
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
    let active = true;
    const element = document.getElementById(`${target.type}-${target.id}`);
    if (!element) { setError(t('Tham chiếu không có trong công việc này.')); return; }
    if (element instanceof HTMLDetailsElement) element.open = true;
    element.scrollIntoView({ block: 'start' }); element.focus({ preventScroll: true });
    if (target.type === 'source') {
      const source = detail.sources.find(source => source.id === target.id);
      if (source && !source.revoked && source.format !== 'parquet' && source.bytes <= 262144) {
        void orglet.call('previewSource', { taskId: detail.task.id, id: source.id }).then(result => { if (active) setPreview({ id: source.id, text: result.text }); }).catch(err => { if (active) setError((err as Error).message); });
      }
    }
    return () => { active = false; };
  }, [target?.id, target?.type, target?.lines?.[0], target?.lines?.[1], detail.task.id]);
  useEffect(() => {
    if (target?.lines && preview?.id === target.id) document.querySelector(`#source-${target.id} .line-highlight`)?.scrollIntoView({ block: 'center' });
  }, [preview, target?.id, target?.lines?.[0]]);
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
  async function show(id: string) {
    setBusy(true); setError('');
    try { const result = await orglet.call('previewSource', { taskId: detail.task.id, id }); setPreview({ id, text: result.text }); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setError('');
    try { await orglet.call('revoke', { id }); if (preview?.id === id) setPreview(undefined); refresh(); }
    catch (err) { setError((err as Error).message); }
  }
  return <div className="form">
    {!detail.sources.length && <p>{t('Task này không có tệp đính kèm.')}</p>}
    {Boolean(detail.task.excludedSources?.length) && <details><summary>{t('{0} mục bị loại khi nhập nguồn', [detail.task.excludedSources!.length])}</summary><p className="muted">{t('Danh sách này chỉ lưu trên máy. Model nhận số lượng mục bị loại; không nhận tên hoặc nội dung các mục này.')}</p><ul>{detail.task.excludedSources!.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
    {detail.preflights.map(record => <section key={record.id}><h3>{t('Kiểm tra trước review')}</h3>
      <p>{({ running: t('Đang kiểm tra'), paused: t('Đã tạm dừng'), cancelled: t('Đã hủy'), failed: t('Không xác minh được nguồn'), complete: t('Các checker đã hoàn tất'), partial: t('Một phần kiểm tra chưa hoàn tất'), insufficient_evidence: t('Chưa có dataset để kiểm tra') } as const)[record.status]}</p>
      <p className="muted">{t('{0} kết quả đã lưu. Hoàn tất checker không đồng nghĩa dữ liệu hoặc scoring đã đạt yêu cầu.', [record.profileIds.length])}</p>
      <ul>{record.notices.map((notice, index) => <li key={index}>{notice.sourceId && <strong>{detail.sources.find(source => source.id === notice.sourceId)?.name}: </strong>}{tMessage(notice.message)}</li>)}</ul>
    </section>)}
    {error && <p role="alert" className="error">{error}</p>}
    {checking && <Button onClick={() => void orglet.call('cancelCheckers', { id: detail.task.id }).catch(err => setError((err as Error).message))}>{t('Hủy checker')}</Button>}
    {detail.sources.some(source => source.format) && <section className="form"><h3>{t('Kiểm tra dữ liệu trên máy')}</h3><p className="muted">{t('Chọn một hoặc hai dataset. Đối chiếu ID cần tên cột chung. Checker không gọi model.')}</p>{detail.sources.filter(source => source.format).map(source => <Checkbox key={source.id} checked={selected.includes(source.id)} disabled={source.revoked || busy || (!selected.includes(source.id) && selected.length >= 2)} onChange={event => setSelected(event.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))}>{source.name}</Checkbox>)}<label>{t('Cột ID (không bắt buộc)')}<input value={idColumn} onChange={event => setIdColumn(event.target.value)} maxLength={256} placeholder={t('Ví dụ: id')} /></label><Button variant="outline" disabled={busy || !selected.length || selected.some(id => detail.sources.find(source => source.id === id)?.revoked)} onClick={() => void profile()}>{busy ? t('Đang kiểm tra…') : t('Chạy checker local')}</Button></section>}
    {detail.sources.filter(source => source.format && !source.revoked).length >= 2 && <section className="form"><h3>{t('Tính exact-match accuracy')}</h3>
      <p className="muted">{t('Chọn rõ tệp predictions, tệp answers và ba cột. Chỉ tính khi ID ghép một-một và giá trị cùng kiểu; đây không phải điểm chính thức của challenge.')}</p>
      <Select label={t('Tệp predictions')} value={predictionSourceId} onChange={setPredictionSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...detail.sources.filter(source => source.format && !source.revoked).map(source => ({ value: source.id, label: source.name, disabled: source.id === answerSourceId }))]} />
      <Select label={t('Tệp answers')} value={answerSourceId} onChange={setAnswerSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...detail.sources.filter(source => source.format && !source.revoked).map(source => ({ value: source.id, label: source.name, disabled: source.id === predictionSourceId }))]} />
      <label>{t('Cột ID')}<input value={scoreIdColumn} onChange={event => setScoreIdColumn(event.target.value)} maxLength={256} placeholder="id" /></label>
      <label>{t('Cột prediction')}<input value={predictionColumn} onChange={event => setPredictionColumn(event.target.value)} maxLength={256} placeholder="prediction" /></label>
      <label>{t('Cột answer')}<input value={answerColumn} onChange={event => setAnswerColumn(event.target.value)} maxLength={256} placeholder="answer" /></label>
      <Button variant="outline" disabled={busy || !predictionSourceId || !answerSourceId || predictionSourceId === answerSourceId || !scoreIdColumn.trim() || !predictionColumn.trim() || !answerColumn.trim()} onClick={() => void score()}>{busy ? t('Đang kiểm tra…') : t('Tính accuracy local')}</Button>
    </section>}
    {detail.sources.some(source => source.format) && <section className="form"><h3>{t('Kiểm tra run-log')}</h3>
      <p className="muted">{t('Chọn đúng một dataset ở trên. Tệp cần các cột solution, run, split, metric, status và score; tùy chọn error_code. Status: completed, failed hoặc cancelled. Mỗi dòng là một lần chạy trên một split; tối đa 10.000 dòng và một metric.')}</p>
      <Select label={t('Chiều tối ưu của metric')} value={direction} onChange={value => setDirection(value as typeof direction)} options={[{ value: '', label: t('Chọn theo định nghĩa metric'), icon: <HelpCircle size={16} /> }, { value: 'higher', label: t('Điểm cao hơn tốt hơn'), icon: <TrendingUp size={16} /> }, { value: 'lower', label: t('Điểm thấp hơn tốt hơn'), icon: <TrendingDown size={16} /> }]} />
      <Button variant="outline" disabled={busy || !direction || selected.length !== 1 || selected.some(id => detail.sources.find(source => source.id === id)?.revoked)} onClick={() => void audit()}>{t('Kiểm tra run-log local')}</Button>
      <p className="muted">{t('Không tự chạy metric hoặc solution. Thiếu rerun không được kết luận ổn định; rank thay đổi không tự chứng minh challenge lỗi.')}</p>
    </section>}
    {detail.profiles.map(profile => <details key={profile.id} id={`checker-${profile.id}`} tabIndex={-1}><summary>{profile.result.runAudit ? 'Run-log' : t('Kết quả checker')} · {new Date(profile.createdAt).toLocaleString(currentLocale())}</summary><>{profile.result.runAudit && <RunAuditView audit={profile.result.runAudit} />}{profile.result.exactMatch && <ExactMatchView score={profile.result.exactMatch} sources={detail.sources} />}</><p>{t('{0} · đọc toàn bộ nguồn trong giới hạn', [profile.result.engine])}</p>{profile.result.datasets.map(dataset => <section key={dataset.sourceId}><h4>{detail.sources.find(source => source.id === dataset.sourceId)?.name}</h4><p>{t('{0} dòng · {1} cột', [dataset.rows.toLocaleString(), dataset.columns.length])}</p><div className="profile-table"><table><thead><tr><th>{t('Cột')}</th><th>{t('Kiểu')}</th><th>Null</th><th>{t('Phân biệt')}</th></tr></thead><tbody>{dataset.columns.map(column => <tr key={column.name}><th>{column.name}</th><td>{column.type}</td><td>{column.nulls}</td><td>{column.distinctNonNull}</td></tr>)}</tbody></table></div>{dataset.id && <p>{t('ID {0}: {1} null, {2} dòng trùng ID không null.', [dataset.id.column, dataset.id.nulls, dataset.id.duplicateNonNull])}</p>}</section>)}{profile.result.comparison && <p>Schema: {profile.result.comparison.schemaMatches ? t('khớp') : t('khác')}.{profile.result.comparison.columnsMatch !== undefined && <> {' '}{t('Tên cột: {0}. Số dòng: {1}.', [profile.result.comparison.columnsMatch ? t('khớp') : t('khác'), profile.result.comparison.rowCountsMatch ? t('bằng nhau') : t('khác nhau')])}</>} {profile.result.comparison.overlappingDistinctIds !== null && <>{t('ID chung: {0}. Thứ tự ID: {1}.', [profile.result.comparison.overlappingDistinctIds, profile.result.comparison.sameIdOrder ? t('khớp') : t('khác')])}</>}{profile.result.comparison.onlyInFirst != null && <> {' '}{t('ID chỉ có ở tệp 1: {0}. ID chỉ có ở tệp 2: {1}.', [profile.result.comparison.onlyInFirst, profile.result.comparison.onlyInSecond])}</>}</p>}<p className="muted">Checks: {profile.result.checks.join(', ')}</p><ul>{profile.result.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul></details>)}
    {detail.sources.map(source => <section key={source.id} id={`source-${source.id}`} tabIndex={-1}>
      <h3>{source.name}</h3><p className="muted">{source.bytes.toLocaleString()} bytes · {source.revoked ? t('Đã thu hồi quyền đọc') : t('Chỉ đọc trong task')}</p>
      <code className="hash">ID: {source.id}<br />SHA-256: {source.hash}</code>
      <div className="actions"><Button variant="outline" disabled={source.revoked || busy || source.format === 'parquet' || source.bytes > 262144} onClick={() => void show(source.id)}>{t('Đọc nội dung')}</Button><Button disabled={source.revoked} onClick={() => void revoke(source.id)}>{t('Thu hồi quyền đọc')}</Button></div>
      {preview?.id === source.id && !source.revoked && <pre className="source-preview">{preview.text.split('\n').map((line, index) => { const cited = target?.type === 'source' && target.id === source.id && target.lines && index + 1 >= target.lines[0] && index + 1 <= target.lines[1]; return <span key={index} className={cited ? 'line-highlight' : undefined} data-line={index + 1}><span className="line-number">{index + 1}</span>{line}{'\n'}</span>; })}</pre>}
    </section>)}
    <p className="muted">{t('Thu hồi chặn lần đọc và request kế tiếp. Không thể thu hồi nội dung đã gửi đến provider.')}</p>
  </div>;
}
