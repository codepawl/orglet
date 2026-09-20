import type { Artifact, Report } from '../shared/contracts';
import type { ReviewPolicy } from '../shared/review';
import type { ProfileRecord } from '../shared/profiles';

/** Necessary evidence for a submission/answers PASS. It does not show the metric or labels are correct. */
function alignedPair(profile: ProfileRecord) {
  const { datasets, comparison } = profile.result;
  return datasets.length === 2 && !!comparison && comparison.columnsMatch === true && comparison.rowCountsMatch === true && comparison.onlyInFirst === 0 && comparison.onlyInSecond === 0 && datasets.every(dataset => dataset.id && dataset.id.nulls === 0 && dataset.id.duplicateNonNull === 0);
}

export function applyReviewPolicy(report: Report, policy: ReviewPolicy | undefined, profiles: ProfileRecord[], upstream: Artifact[] = []): Report {
  if (!policy) return report;
  const result = structuredClone(report);
  result.review ??= { checks: [], recommendation: 'insufficient_evidence', draftFeedback: 'Chưa có feedback từ model. Cần hoàn tất các mục kiểm tra còn thiếu.', upstreamFindingIds: [...new Set(upstream.flatMap(artifact => [...artifact.report.findings.flatMap(finding => finding.provenance ? [finding.provenance.findingId] : []), ...(artifact.report.review?.upstreamFindingIds ?? [])]))], conflicts: upstream.flatMap(artifact => artifact.report.review?.conflicts ?? []) };
  const review = result.review;
  for (const required of policy.requiredChecks) {
    let check = review.checks.find(check => check.name.trim().toLowerCase() === required.name.toLowerCase());
    if (!check) {
      check = { name: required.name, status: 'not_assessed', coverage: 'Báo cáo chưa đánh giá mục bắt buộc này.', sourceIds: [], checkerIds: [] };
      review.checks.push(check);
    }
    if (required.checker === 'run_audit' && check.status === 'pass') {
      const audited = profiles.some(profile => check!.checkerIds.includes(profile.id) && profile.result.runAudit && profile.result.runAudit.status === 'observations' && check!.sourceIds.some(id => Object.hasOwn(profile.sourceHashes, id)));
      if (!audited) { check.status = 'not_assessed'; check.coverage += '\nChưa có kết quả kiểm tra run-log đủ bằng chứng cho mục này.'; }
    }
    if (required.checker === 'pair_alignment' && check.status === 'pass' && !profiles.some(profile => check!.checkerIds.includes(profile.id) && alignedPair(profile) && profile.result.datasets.every(dataset => check!.sourceIds.includes(dataset.sourceId)))) {
      check.status = 'not_assessed'; check.coverage += '\nChưa có kết quả đối chiếu hai dataset (cột, số dòng, tập ID không trùng/thiếu) cho mục này.';
    }
  }
  if (review.checks.some(check => check.status === 'not_assessed')) review.recommendation = 'insufficient_evidence';
  return result;
}

/** Workspace command output has no source ID yet. Keep the work, but never publish an uncited pass. */
export function downgradeUncitedWorkspaceChecks(report: Report) {
  if (!report.review) return;
  for (const check of report.review.checks) {
    if (check.status === 'not_assessed' || check.sourceIds.length || check.processIds?.length) continue;
    check.status = 'not_assessed';
    check.coverage += '\nKết quả công cụ workspace chưa có mã bằng chứng để trích dẫn trong báo cáo.';
    report.limitations.push(`Chưa xác minh độc lập check: ${check.name}.`);
  }
  if (report.review.checks.some(check => check.status === 'not_assessed')) report.review.recommendation = 'insufficient_evidence';
}

// Structural evidence gates cannot establish that a model's interpretation is correct.
export function validateReview(report: Report, upstream: Artifact[], sourceIds: ReadonlySet<string>, validateChecker: (id: string, sources: string[]) => void,
  validateProcess: (id: string, status: 'pass' | 'fail' | 'not_assessed') => void = () => { throw new Error('Check tham chiếu tiến trình chưa được cung cấp cho lần chạy.'); }) {
  const review = report.review;
  if (!review) return; // Historical reports have no structured review contract.
  const available = new Set(upstream.flatMap(artifact => [...artifact.report.findings.flatMap(finding => finding.provenance ? [finding.provenance.findingId] : []), ...(artifact.report.review?.upstreamFindingIds ?? [])]));
  const referenced = new Set(review.upstreamFindingIds);
  if (referenced.size !== review.upstreamFindingIds.length || referenced.size !== available.size || [...referenced].some(id => !available.has(id))) throw new Error('Review phải giữ tham chiếu tới mọi finding đã khóa ở join.');
  const names = new Set<string>();
  for (const check of review.checks) {
    const name = check.name.trim().toLowerCase();
    if (names.has(name)) throw new Error('Review có check bị trùng.');
    names.add(name);
    if (check.sourceIds.some(id => !sourceIds.has(id)) || (check.status !== 'not_assessed' && !check.sourceIds.length && !check.processIds?.length)) throw new Error('Check đã đánh giá cần nguồn được cung cấp cho lần chạy.');
    for (const id of check.checkerIds) validateChecker(id, check.sourceIds);
    for (const id of check.processIds ?? []) validateProcess(id, check.status);
  }
  for (const conflict of review.conflicts) {
    const ids = new Set(conflict.findingIds);
    if (ids.size !== conflict.findingIds.length || [...ids].some(id => !available.has(id))) throw new Error('Bất đồng phải tham chiếu các finding khác nhau trong join đã khóa.');
  }
  // An earlier explicit disagreement cannot disappear merely because another worker summarizes it.
  for (const conflict of upstream.flatMap(artifact => artifact.report.review?.conflicts ?? [])) {
    if (!review.conflicts.some(item => conflict.findingIds.every(id => item.findingIds.includes(id)))) throw new Error('Review đã bỏ mất bất đồng chưa được phân xử.');
  }
  const upstreamNeedsReview = upstream.some(artifact => artifact.report.findings.some(finding => finding.severity === 'critical') || (artifact.report.review && artifact.report.review.recommendation !== 'ready_for_human_review'));
  if (review.recommendation === 'ready_for_human_review' && (!review.checks.length || review.checks.some(check => check.status !== 'pass') || review.conflicts.length || report.findings.some(finding => finding.severity === 'critical') || upstreamNeedsReview)) throw new Error('Chưa thể khuyến nghị sẵn sàng khi còn check thiếu/lỗi, bất đồng hoặc finding nghiêm trọng.');
}
