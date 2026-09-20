import type { ExactMatchAccuracy } from '../../shared/profiles';
import type { TaskDetail } from '../../shared/contracts';
import { currentLocale, t } from '../i18n';

function reasonLabel(reason: NonNullable<ExactMatchAccuracy['reason']>) {
  switch (reason) {
    case 'empty': return t('Một tệp không có dòng dữ liệu');
    case 'missing_column': return t('Thiếu cột đã chọn');
    case 'null_id': return t('Có ID trống');
    case 'duplicate_id': return t('Có ID trùng');
    case 'id_mismatch': return t('Hai tệp không có cùng tập ID');
    case 'null_value': return t('Có prediction hoặc answer trống');
    case 'type_mismatch': return t('Kiểu cột không tương thích');
    case 'unsupported_type': return t('Kiểu cột chưa được hỗ trợ');
  }
}

export function ExactMatchView({ score, sources }: { score: ExactMatchAccuracy; sources: TaskDetail['sources'] }) {
  const predictionName = sources.find(source => source.id === score.predictionSourceId)?.name ?? score.predictionSourceId;
  const answerName = sources.find(source => source.id === score.answerSourceId)?.name ?? score.answerSourceId;
  return <section>
    <h4>{t('Exact-match accuracy')}</h4>
    {score.status === 'complete'
      ? <p>{t('{0} / {1} đúng · accuracy {2}', [score.matched, score.total, new Intl.NumberFormat(currentLocale(), { style: 'percent', maximumFractionDigits: 2 }).format(score.accuracy!)])}</p>
      : <p>{t('Chưa có điểm: {0}', [reasonLabel(score.reason!)])}</p>}
    <p className="muted">{t('Predictions: {0} ({1}). Answers: {2} ({3}). ID: {4}.', [predictionName, score.predictionColumn, answerName, score.answerColumn, score.idColumn])}</p>
    <p className="muted">{score.version} · {t('Không xác nhận metric chính thức hoặc khả năng giải challenge.')}</p>
  </section>;
}
