import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { TaskDetail } from '../../shared/contracts';
import type { ProfileRecord } from '../../shared/profiles';
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
import { tableSizeLabel } from './TablePreview';
import { columnKindLabel, columnRangeLabel, datasetHasNotesCheck, datasetNotes, formatNumber } from './checkNotes';
import { Input } from '@codepawlhq/orglet-ui';

export type SourceTarget = { type: 'source' | 'checker'; id: string; lines?: [number, number] };

type Dataset = ProfileRecord['result']['datasets'][number];
type Comparison = NonNullable<ProfileRecord['result']['comparison']>;

const sameOrDifferent = (same: boolean) => same ? t('khớp') : t('khác');

/** How the two checked files compare, in one plain sentence per thing that was compared. */
function ComparisonLine({ comparison }: { comparison: Comparison }) {
  const parts = [t('Cấu trúc cột: {0}.', [sameOrDifferent(comparison.schemaMatches)])];
  if (comparison.columnsMatch !== undefined) {
    parts.push(t('Tên cột: {0}. Số dòng: {1}.', [sameOrDifferent(comparison.columnsMatch), comparison.rowCountsMatch ? t('bằng nhau') : t('khác nhau')]));
  }
  if (comparison.overlappingDistinctIds !== null) {
    parts.push(t('ID chung: {0}. Thứ tự ID: {1}.', [comparison.overlappingDistinctIds, sameOrDifferent(Boolean(comparison.sameIdOrder))]));
  }
  if (comparison.onlyInFirst != null) {
    parts.push(t('ID chỉ có ở tệp 1: {0}. ID chỉ có ở tệp 2: {1}.', [comparison.onlyInFirst, comparison.onlyInSecond]));
  }
  return <p>{parts.join(' ')}</p>;
}

/**
 * One checked file: its size, a row per column (what it holds, empty cells, different values, lowest to highest
 * number), then one plain sentence for each thing worth a second look (COD-297).
 */
function DatasetResult({ dataset, name }: { dataset: Dataset; name?: string }) {
  const notes = datasetNotes(dataset);
  return <section>
    <h4>{name}</h4>
    <p>{tableSizeLabel(dataset.rows, dataset.columns.length)}</p>
    <div className="profile-table"><table>
      <thead><tr><th>{t('Cột')}</th><th>{t('Kiểu')}</th><th>{t('Ô trống')}</th><th>{t('Giá trị khác nhau')}</th><th>{t('Khoảng giá trị')}</th></tr></thead>
      <tbody>{dataset.columns.map(column => <tr key={column.name}>
        <th>{column.name}</th>
        <td>{columnKindLabel(column)}</td>
        <td>{formatNumber(column.nulls)}</td>
        <td>{formatNumber(column.distinctNonNull)}</td>
        <td className="profile-range">{columnRangeLabel(column)}</td>
      </tr>)}</tbody>
    </table></div>
    {dataset.id && <p>{t('Cột mã {0}: ô trống {1} · dòng trùng mã {2}.', [dataset.id.column, dataset.id.nulls, dataset.id.duplicateNonNull])}</p>}
    {notes.length > 0 && <ul className="check-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {notes.length === 0 && datasetHasNotesCheck(dataset) && <p>{t('Không thấy dòng trùng, số âm hay ô lạc kiểu.')}</p>}
  </section>;
}

/** A saved check, folded under its time; the newest one opens by itself once a check finishes (COD-292). */
function CheckResult({ profile, sources }: { profile: ProfileRecord; sources: TaskDetail['sources'] }) {
  const { result } = profile;
  const title = result.runAudit ? t('Kết quả run-log') : t('Kết quả kiểm tra');
  const sourceName = (id: string) => sources.find(source => source.id === id)?.name;
  return <details className="check-result" id={`checker-${profile.id}`} tabIndex={-1}>
    <summary className="activity-summary"><ChevronRight size={13} aria-hidden="true" className="activity-chevron" />{title} · {new Date(profile.createdAt).toLocaleString(currentLocale())}</summary>
    <div className="check-result-body">
      {result.runAudit && <RunAuditView audit={result.runAudit} />}
      {result.exactMatch && <ExactMatchView score={result.exactMatch} sources={sources} />}
      {result.datasets.map(dataset => <DatasetResult key={dataset.sourceId} dataset={dataset} name={sourceName(dataset.sourceId)} />)}
      {result.comparison && <ComparisonLine comparison={result.comparison} />}
      <ul className="muted">{result.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul>
      <p className="muted">{t('Đọc bằng {0}', [result.engine])}</p>
    </div>
  </details>;
}

/**
 * The chat's sources as a list of rows, each opening that one file in its own viewer, followed by the task-level
 * checks (preflight, the data check, and the matching and run-log checks folded under "More checks") and their
 * results. A file's content is never poured into this list (user, 2026-09-21).
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
  // The results saved before the check the person just ran; the first one not in it is that check's answer.
  const [resultsBefore, setResultsBefore] = useState<string[] | null>(null);
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(`${target.type}-${target.id}`);
    if (!element) { setError(t('Tham chiếu không có trong công việc này.')); return; }
    if (element instanceof HTMLDetailsElement) element.open = true;
    element.scrollIntoView({ block: 'start' }); element.focus({ preventScroll: true });
  }, [target?.id, target?.type, detail.task.id]);
  useEffect(() => {
    if (!resultsBefore) return;
    const fresh = detail.profiles.find(profile => !resultsBefore.includes(profile.id));
    if (!fresh) return;
    setResultsBefore(null);
    const element = document.getElementById(`checker-${fresh.id}`);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: 'nearest' });
  }, [detail.profiles, resultsBefore]);
  async function check(call: () => Promise<unknown>) {
    setBusy(true); setChecking(true); setError('');
    try {
      const before = detail.profiles.map(profile => profile.id);
      await call();
      setResultsBefore(before);
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setChecking(false); }
  }
  const audit = () => {
    if (!direction || selected.length !== 1) return;
    void check(() => orglet.call('auditRunLog', { taskId: detail.task.id, sourceId: selected[0], direction }));
  };
  const profile = () => void check(() => orglet.call('profileSources', { taskId: detail.task.id, sourceIds: selected, idColumn: idColumn.trim() || null }));
  const score = () => void check(() => orglet.call('scoreExactMatch', { taskId: detail.task.id, predictionSourceId, answerSourceId,
    idColumn: scoreIdColumn.trim(), predictionColumn: predictionColumn.trim(), answerColumn: answerColumn.trim() }));
  const dataSources = detail.sources.filter(source => source.format);
  const readableDataSources = dataSources.filter(source => !source.revoked);
  const selectedRevoked = selected.some(id => detail.sources.find(source => source.id === id)?.revoked);
  const newestFirst = [...detail.profiles].reverse();
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
    {Boolean(detail.task.excludedSources?.length) && <details><summary>{detail.task.excludedSources!.length === 1 ? t('1 mục bị loại khi nhập nguồn') : t('{0} mục bị loại khi nhập nguồn', [detail.task.excludedSources!.length])}</summary><p className="muted">{t('Chỉ lưu trên máy; model chỉ nhận số lượng mục bị loại.')}</p><ul>{detail.task.excludedSources!.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
    {detail.preflights.map(record => <section key={record.id}><h3>{t('Kiểm tra trước review')}</h3>
      <p>{({ running: t('Đang kiểm tra'), paused: t('Đã tạm dừng'), cancelled: t('Đã hủy'), failed: t('Không xác minh được nguồn'), complete: t('Các checker đã hoàn tất'), partial: t('Một phần kiểm tra chưa hoàn tất'), insufficient_evidence: t('Chưa có dataset để kiểm tra') } as const)[record.status]}</p>
      <p className="muted">{record.profileIds.length === 1 ? t('Đã lưu 1 kết quả kiểm tra. Kiểm tra xong chưa có nghĩa là dữ liệu đúng.') : t('Đã lưu {0} kết quả kiểm tra. Kiểm tra xong chưa có nghĩa là dữ liệu đúng.', [record.profileIds.length])}</p>
      <ul>{record.notices.map((notice, index) => <li key={index}>{notice.sourceId && <strong>{detail.sources.find(source => source.id === notice.sourceId)?.name}: </strong>}{tMessage(notice.message)}</li>)}</ul>
    </section>)}
    {dataSources.length > 0 && <section className="form">
      <h3>{t('Kiểm tra dữ liệu trên máy')}</h3>
      <p className="muted">{t('Chọn một hoặc hai tệp dữ liệu. Ngay trên máy này, Orglet đếm dòng, cột và ô trống, tìm dòng trùng, số âm và ô lạc kiểu, không gửi đi đâu.')}</p>
      {dataSources.map(source => <Checkbox key={source.id} checked={selected.includes(source.id)} disabled={source.revoked || busy || (!selected.includes(source.id) && selected.length >= 2)} onChange={event => setSelected(event.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))}>{source.name}</Checkbox>)}
      <label>{t('Cột ID (không bắt buộc)')}<Input value={idColumn} onChange={event => setIdColumn(event.target.value)} maxLength={256} placeholder={t('Ví dụ: id')} /></label>
      <p className="muted">{t('Có cột mã thì Orglet đếm mã trùng hoặc trống, và so mã giữa hai tệp.')}</p>
      <Button variant="outline" disabled={busy || !selected.length || selectedRevoked} onClick={profile}>{busy ? t('Đang kiểm tra…') : t('Kiểm tra dữ liệu')}</Button>
    </section>}
    {error && <p role="alert" className="error">{error}</p>}
    {checking && <Button onClick={() => void orglet.call('cancelCheckers', { id: detail.task.id }).catch(err => setError((err as Error).message))}>{t('Hủy kiểm tra')}</Button>}
    {newestFirst.length > 0 && <div className="check-results">{newestFirst.map(record => <CheckResult key={record.id} profile={record} sources={detail.sources} />)}</div>}
    {dataSources.length > 0 && <details className="more-checks">
      <summary className="activity-summary"><ChevronRight size={13} aria-hidden="true" className="activity-chevron" />{t('Kiểm tra khác')}</summary>
      <div className="more-checks-body">
        {readableDataSources.length >= 2 && <section className="form"><h3>{t('So với đáp án')}</h3>
          <p className="muted">{t('Đếm bao nhiêu dòng khớp đáp án, ghép hai tệp theo cột mã. Đây là phép đếm đơn giản, không phải điểm chính thức.')}</p>
          <Select label={t('Tệp cần so')} value={predictionSourceId} onChange={setPredictionSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...readableDataSources.map(source => ({ value: source.id, label: source.name, disabled: source.id === answerSourceId }))]} />
          <Select label={t('Tệp đáp án')} value={answerSourceId} onChange={setAnswerSourceId} options={[{ value: '', label: t('Chọn tệp') }, ...readableDataSources.map(source => ({ value: source.id, label: source.name, disabled: source.id === predictionSourceId }))]} />
          <label>{t('Cột ID')}<Input value={scoreIdColumn} onChange={event => setScoreIdColumn(event.target.value)} maxLength={256} placeholder="id" /></label>
          <label>{t('Cột cần so')}<Input value={predictionColumn} onChange={event => setPredictionColumn(event.target.value)} maxLength={256} placeholder="prediction" /></label>
          <label>{t('Cột đáp án')}<Input value={answerColumn} onChange={event => setAnswerColumn(event.target.value)} maxLength={256} placeholder="answer" /></label>
          <Button variant="outline" disabled={busy || !predictionSourceId || !answerSourceId || predictionSourceId === answerSourceId || !scoreIdColumn.trim() || !predictionColumn.trim() || !answerColumn.trim()} onClick={score}>{busy ? t('Đang kiểm tra…') : t('Đếm dòng khớp')}</Button>
        </section>}
        <section className="form"><h3>{t('Kiểm tra run-log')}</h3>
          <p className="muted">{t('Cho tệp ghi điểm của nhiều lần chạy thử (cột solution, run, split, metric, status và score): chọn đúng một tệp ở trên, Orglet xếp hạng từng cách làm và xem thứ hạng có giữ nguyên giữa các phần dữ liệu không.')}</p>
          <Select label={t('Chiều tối ưu của metric')} value={direction} onChange={value => setDirection(value as typeof direction)} options={[{ value: '', label: t('Chọn theo định nghĩa metric'), icon: <HelpCircle size={16} /> }, { value: 'higher', label: t('Điểm cao hơn tốt hơn'), icon: <TrendingUp size={16} /> }, { value: 'lower', label: t('Điểm thấp hơn tốt hơn'), icon: <TrendingDown size={16} /> }]} />
          <Button variant="outline" disabled={busy || !direction || selected.length !== 1 || selectedRevoked} onClick={audit}>{t('Kiểm tra run-log local')}</Button>
          <p className="muted">{t('Orglet chỉ đọc điểm có sẵn trong tệp, không chạy lại gì. Thứ hạng đổi chưa chắc là dữ liệu có vấn đề.')}</p>
        </section>
      </div>
    </details>}
  </div>;
}
