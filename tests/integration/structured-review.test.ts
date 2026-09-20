import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Report, type Artifact } from '../../apps/desktop/src/shared/contracts';
import { applyReviewPolicy, downgradePrematureRecommendation, downgradeUncitedWorkspaceChecks, validateReview } from '../../apps/desktop/src/core/review';

const source = randomUUID();
const finding = () => ({ title: 'Observed issue', severity: 'warning' as const, detail: 'Evidence differs.', coverage: 'Selected source', sourceIds: [source], provenance: { findingId: randomUUID(), writerId: randomUUID(), runId: randomUUID() } });
const member = (): Artifact => ({ id: randomUUID(), runId: randomUUID(), hash: 'fixture', createdAt: '2026-09-14T00:00:00.000Z', report: { title: 'Member', summary: 'Observation', findings: [finding()], limitations: [] } });
const report = () => Report.parse({ title: 'Review', summary: 'Summary', findings: [], limitations: [], review: { checks: [{ name: 'Schema', status: 'pass', coverage: 'Selected schema', sourceIds: [source], checkerIds: [] }], recommendation: 'ready_for_human_review', draftFeedback: 'Review the evidence before deciding.', upstreamFindingIds: [], conflicts: [] } });
const validate = (value: Report, upstream: Artifact[] = []) => validateReview(value, upstream, new Set([source]), () => { throw new Error('Unknown checker'); });

describe('structured review gates', () => {
  it('keeps a workspace report while downgrading an uncited command check', () => {
    const value = report();
    value.review!.checks[0].sourceIds = [];
    downgradeUncitedWorkspaceChecks(value);
    expect(value.review!.checks[0].status).toBe('not_assessed');
    expect(value.review!.recommendation).toBe('insufficient_evidence');
    expect(value.limitations).toContain('Chưa xác minh độc lập check: Schema.');
    validate(value);
  });
  it('accepts only a same-run completed process as command evidence', () => {
    const value = report();
    const processId = randomUUID();
    value.review!.checks[0].sourceIds = [];
    value.review!.checks[0].processIds = [processId];
    expect(() => validate(value)).toThrow('tiến trình');
    validateReview(value, [], new Set(), () => {}, (id, status) => {
      expect(id).toBe(processId);
      expect(status).toBe('pass');
    });
    expect(value.review!.checks[0].status).toBe('pass');
  });
  it('retains a member deliverable when its upstream report is not ready', () => {
    const value = report();
    const upstream = [member()];
    upstream[0].report.review = { checks: [], recommendation: 'insufficient_evidence', draftFeedback: 'Needs review', upstreamFindingIds: [], conflicts: [] };
    value.review!.upstreamFindingIds = upstream.map(item => item.report.findings[0].provenance!.findingId);
    expect(() => validate(value, upstream)).toThrow('Chưa thể');
    downgradePrematureRecommendation(value, upstream);
    expect(value.review!.recommendation).toBe('insufficient_evidence');
    expect(value.limitations).toContain('Báo cáo đầu vào còn mục chưa đủ bằng chứng; chưa thể khuyến nghị sẵn sàng review.');
    validate(value, upstream);
  });
  it('retains a legacy report without manufacturing review metadata', () => {
    const value = Report.parse({ title: 'Old', summary: 'Old report', findings: [], limitations: [] });
    validate(value); expect(value.review).toBeUndefined();
  });
  it('accepts a supported check and keeps both disputed member references', () => {
    validate(report());
    const upstream = [member(), member()]; const value = report();
    value.review!.upstreamFindingIds = upstream.map(item => item.report.findings[0].provenance!.findingId);
    value.review!.conflicts = [{ findingIds: [...value.review!.upstreamFindingIds], reason: 'The member interpretations disagree.' }];
    value.review!.recommendation = 'revision_required';
    validate(value, upstream); expect(upstream.map(item => item.report.findings[0].detail)).toEqual(['Evidence differs.', 'Evidence differs.']);
  });
  it.each(['not_assessed', 'fail'] as const)('rejects a ready recommendation with %s checks', status => {
    const value = report(); value.review!.checks[0].status = status;
    expect(() => validate(value)).toThrow('Chưa thể');
  });
  it('rejects unsupported, duplicate, and unread check evidence', () => {
    const value = report(); value.review!.checks[0].checkerIds = [randomUUID()];
    expect(() => validate(value)).toThrow('Unknown checker');
    value.review!.checks[0].checkerIds = []; value.review!.checks[0].sourceIds = [];
    expect(() => validate(value)).toThrow('cần nguồn');
    value.review!.checks[0].sourceIds = [randomUUID()]; expect(() => validate(value)).toThrow('cần nguồn');
    value.review!.checks[0].sourceIds = [source]; value.review!.checks.push(structuredClone(value.review!.checks[0]));
    expect(() => validate(value)).toThrow('trùng');
  });
  it('rejects omitted or invented upstream findings and repeated conflict sides', () => {
    const upstream = [member(), member()]; const value = report();
    expect(() => validate(value, upstream)).toThrow('join');
    value.review!.upstreamFindingIds = [randomUUID(), randomUUID()]; expect(() => validate(value, upstream)).toThrow('join');
    value.review!.upstreamFindingIds = upstream.map(item => item.report.findings[0].provenance!.findingId);
    const id = value.review!.upstreamFindingIds[0]; value.review!.conflicts = [{ findingIds: [id, id], reason: 'Fake pair' }];
    expect(() => validate(value, upstream)).toThrow('khác nhau');
  });
  it('carries unresolved ancestor conflicts through another synthesis', () => {
    const upstream = member(); const ancestorIds = [randomUUID(), randomUUID()];
    upstream.report.review = { ...report().review!, upstreamFindingIds: ancestorIds, conflicts: [{ findingIds: ancestorIds, reason: 'Unresolved' }], recommendation: 'revision_required' };
    const value = report(); value.review!.recommendation = 'revision_required';
    value.review!.upstreamFindingIds = [upstream.report.findings[0].provenance!.findingId, ...ancestorIds];
    expect(() => validate(value, [upstream])).toThrow('bỏ mất');
    value.review!.conflicts = structuredClone(upstream.report.review.conflicts); validate(value, [upstream]);
  });
  it('does not wash out an upstream critical finding or unresolved recommendation', () => {
    const upstream = member(); const value = report();
    value.review!.upstreamFindingIds = [upstream.report.findings[0].provenance!.findingId];
    upstream.report.findings[0].severity = 'critical';
    expect(() => validate(value, [upstream])).toThrow('Chưa thể');
    upstream.report.findings[0].severity = 'info';
    upstream.report.review = { ...report().review!, recommendation: 'rerun_required' };
    expect(() => validate(value, [upstream])).toThrow('Chưa thể');
    value.review!.recommendation = 'rerun_required'; validate(value, [upstream]);
  });
});

it('fills omitted required checks and downgrades unsupported run stability without changing the original', () => {
  const value = report();
  const policy = { requiredChecks: [{ name: 'Run stability', checker: 'run_audit' as const }] };
  const filled = applyReviewPolicy(value, policy, []);
  expect(value.review!.checks).toHaveLength(1);
  expect(filled.review!.recommendation).toBe('insufficient_evidence');
  expect(filled.review!.checks.at(-1)).toMatchObject({ name: 'Run stability', status: 'not_assessed', sourceIds: [] });
  const claimed = report(); claimed.review!.checks[0].name = 'Run stability';
  const checked = applyReviewPolicy(claimed, policy, []);
  expect(checked.review!.checks[0].status).toBe('not_assessed');
  expect(checked.review!.checks[0].coverage).toContain('Chưa có kết quả kiểm tra run-log');
  expect(applyReviewPolicy(checked, policy, [])).toEqual(checked);
});
it('passes submission alignment only with a cited two-dataset profile showing matching columns, rows and ID sets', () => {
  const answers = randomUUID(); const checker = randomUUID();
  const policy = { requiredChecks: [{ name: 'Submission and answer alignment', checker: 'pair_alignment' as const }] };
  const dataset = (sourceId: string) => ({ sourceId, rows: 2, columns: [{ name: 'id', type: 'VARCHAR', nulls: 0, distinctNonNull: 2 }], id: { column: 'id', nulls: 0, duplicateNonNull: 0 } });
  const profile = (comparison: Record<string, unknown>) => ({ id: checker, taskId: randomUUID(), createdAt: '2026-09-15T00:00:00.000Z', sourceHashes: { [source]: 'a'.repeat(64), [answers]: 'b'.repeat(64) }, result: { engine: 'fixture', coverage: 'full' as const, checks: [], limitations: [], datasets: [dataset(source), dataset(answers)], comparison: { schemaMatches: true, overlappingDistinctIds: 2, sameIdOrder: false, columnsMatch: true, rowCountsMatch: true, onlyInFirst: 0, onlyInSecond: 0, ...comparison } } });
  const claimed = () => { const value = report(); value.review!.checks[0] = { name: 'Submission and answer alignment', status: 'pass', coverage: 'Profiled both files', sourceIds: [source, answers], checkerIds: [checker] }; return value; };
  expect(applyReviewPolicy(claimed(), policy, [profile({})]).review!.checks[0].status).toBe('pass');
  for (const broken of [{ onlyInSecond: 1 }, { rowCountsMatch: false }, { columnsMatch: false }, { columnsMatch: undefined }]) {
    expect(applyReviewPolicy(claimed(), policy, [profile(broken)]).review!.checks[0].status).toBe('not_assessed');
  }
  const oneSource = claimed(); oneSource.review!.checks[0].sourceIds = [source];
  expect(applyReviewPolicy(oneSource, policy, [profile({})]).review).toMatchObject({ recommendation: 'insufficient_evidence', checks: [{ status: 'not_assessed' }] });
});
it('creates conservative structured metadata for a legacy reply under a new required policy', () => {
  const value = report(); delete value.review;
  const checked = applyReviewPolicy(value, { requiredChecks: [{ name: 'Objective', checker: 'none' }] }, []);
  expect(checked.review).toMatchObject({ recommendation: 'insufficient_evidence', checks: [{ name: 'Objective', status: 'not_assessed' }] });
  expect(applyReviewPolicy(value, undefined, [])).toBe(value);
});
