import type { RunAudit } from '../../shared/run-audit';
import { t } from '../i18n';
import { currentLocale } from '../i18n';

const number = (value: number | null) => value === null ? t('Chưa đủ dữ liệu') : new Intl.NumberFormat(currentLocale(), { maximumSignificantDigits: 6 }).format(value);
export function RunAuditView({ audit }: { audit: RunAudit }) {
  return <section aria-label={t('Kết quả run-log')}>
    <h3>Run-log · {({ observations: t('Đã ghi nhận thống kê'), insufficient_evidence: t('Thiếu bằng chứng'), needs_review: t('Cần xem lại failure') } as const)[audit.status]}</h3>
    <p>{audit.metric} · {audit.direction === 'higher' ? t('Điểm cao hơn tốt hơn') : t('Điểm thấp hơn tốt hơn')}</p>
    <p>{t('{0} completed · {1} failed · {2} cancelled. {3} score của lần lỗi/hủy bị loại.', [audit.completed, audit.failed, audit.cancelled, audit.ignoredFailureScores])}</p>
    <details><summary>{t('Thống kê {0} nhóm solution/split', [audit.groups.length])}</summary><div className="profile-table"><table><caption>{t('Thống kê trong cùng solution và split')}</caption><thead><tr><th>Solution / split</th><th>{t('Completed / tổng')}</th><th>{t('Trung bình')}</th><th>Min / max</th><th>{t('Độ lệch chuẩn mẫu')}</th></tr></thead><tbody>{audit.groups.map(group => <tr key={JSON.stringify([group.solution, group.split])}><th>{group.solution} / {group.split}</th><td>{group.completed} / {group.total}</td><td>{number(group.mean)}</td><td>{number(group.minimum)} / {number(group.maximum)}</td><td>{number(group.sampleStdDev)}</td></tr>)}</tbody></table></div></details>
    {audit.failures.length > 0 && <details><summary>{t('Mã lỗi và trạng thái không hoàn tất')}</summary><ul>{audit.failures.map(item => <li key={item.code}>{item.code}: {item.count}</li>)}</ul></details>}
    {audit.ranks && <details><summary>{t('So sánh rank public/private')}</summary><div className="profile-table"><table><caption>{t('Thứ hạng từ điểm trung bình · tăng bậc = public − private')}</caption><thead><tr><th>Solution</th><th>Public</th><th>Private</th><th>{t('Tăng bậc')}</th></tr></thead><tbody>{audit.ranks.map(item => <tr key={item.solution}><th>{item.solution}</th><td>{item.publicRank}</td><td>{item.privateRank}</td><td>{item.improvement > 0 ? '+' : ''}{item.improvement}</td></tr>)}</tbody></table></div></details>}
    <ul>{audit.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>
    <p className="muted">Checker: {audit.version}</p>
  </section>;
}
