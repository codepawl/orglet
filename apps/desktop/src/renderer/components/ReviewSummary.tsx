import type { Report, TaskDetail } from '../../shared/contracts';
import type { SourceTarget } from './SourcePanel';
import { Button } from './ui';
import { useState } from 'react';
import { toast } from './toast';
import { t, tMessage, translated } from '../i18n';
import { orglet } from '../api';

const recommendations = translated({ ready_for_human_review: 'Sẵn sàng để người dùng review', revision_required: 'Cần chỉnh sửa', rerun_required: 'Cần chạy lại để kiểm chứng', insufficient_evidence: 'Chưa đủ bằng chứng' });
const statuses = translated({ pass: 'Đạt trong phạm vi kiểm tra', fail: 'Có vấn đề', not_assessed: 'Chưa đánh giá' });

export function ReviewSummary({ report, artifactId, detail, showSources }: { report: Report; artifactId: string; detail: TaskDetail; showSources: (target?: SourceTarget) => void }) {
  const [copying, setCopying] = useState(false);
  const review = report.review;
  if (!review) return null;
  const originals = detail.artifacts.flatMap(artifact => artifact.report.findings);
  return <section>
    <h3>{recommendations[review.recommendation]}</h3>
    <p className="muted">{t('Đây là khuyến nghị của báo cáo; quyết định chấp nhận thuộc về người dùng.')}</p>
    <h3>{t('Các mục kiểm tra')}</h3>
    {!review.checks.length && <p>{t('Chưa có mục kiểm tra được ghi nhận.')}</p>}
    {review.checks.map(check => <details key={check.name}><summary>{check.name} · {statuses[check.status]}</summary>
      <p className="prose">{check.coverage}</p>
      <div className="source-links">{check.sourceIds.map(id => <Button key={id} onClick={() => showSources({ type: 'source', id })}>{detail.sources.find(source => source.id === id)?.name ?? id}</Button>)}{check.checkerIds.map((id, index) => <Button key={id} onClick={() => showSources({ type: 'checker', id })}>Xem checker {index + 1}</Button>)}</div>
    </details>)}
    {review.conflicts.length > 0 && <section><h3>{t('Bất đồng cần phân xử')}</h3>{review.conflicts.map((conflict, index) => <details key={index}><summary>{conflict.reason}</summary>{conflict.findingIds.map(id => {
      const original = originals.find(finding => finding.provenance?.findingId === id);
      const author = detail.runs.find(run => run.id === original?.provenance?.runId);
      return <section key={id}><h4>{original?.title ?? t('Finding không có trong dữ liệu hiện tại')}</h4><p className="muted">{author?.snapshot.worker.name} · {id}</p><p className="prose">{original?.detail}</p><p className="muted">{original?.coverage}</p>{original?.sourceIds.map(sourceId => <Button key={sourceId} onClick={() => showSources({ type: 'source', id: sourceId })}>{detail.sources.find(source => source.id === sourceId)?.name ?? sourceId}</Button>)}</section>;
    })}</details>)}</section>}
    <h3>{t('Feedback nháp')}</h3><p className="prose">{review.draftFeedback}</p>
    <Button variant="outline" disabled={copying} onClick={async () => {
      setCopying(true);
      try { await orglet.copyFeedback(artifactId); toast(t('Đã sao chép feedback'), 'success', tMessage(report.title)); }
      catch (error) { toast(error instanceof Error ? error.message : t('Không thể sao chép feedback'), 'error', tMessage(report.title)); }
      finally { setCopying(false); }
    }}>{t('Sao chép feedback')}</Button>
    <p className="muted">{t('Chưa gửi ra ngoài. Kiểm tra và chỉnh nội dung trước khi sử dụng.')}</p>
  </section>;
}
