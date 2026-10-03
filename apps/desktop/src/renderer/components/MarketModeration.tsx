import { useEffect, useRef, useState } from 'react';
import { Textarea, Checkbox } from '@codepawl/orglet-ui';
import { ChevronRight, FileText, Flag, RefreshCw, ShieldCheck } from 'lucide-react';
import { MarketDecisionInput, MarketReportInput, MarketResolveInput, type MarketModerationAction, type MarketModerationResult, type MarketReviewDetail, type MarketModerationWrite } from '../../shared/market-moderation';
import type { MarketListingV2 } from '../../shared/market';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { Button, Drawer, FieldLabel } from './ui';
import { Select } from './Select';
import { PublicContentPreview } from './MarketPublishing';
import { confirmAction } from './confirm';
import { toast } from './toast';

type Capability = Extract<MarketModerationResult, { kind: 'capability' }>['capability'] & { status: Extract<MarketModerationResult, { kind: 'capability' }>['status'] };
type Detail = Extract<MarketModerationResult, { kind: 'detail' }>;
type Reports = Extract<MarketModerationResult, { kind: 'reports' }>['page'];
type Queue = Extract<MarketModerationResult, { kind: 'queue' }>['page'];
type Audit = Extract<MarketModerationResult, { kind: 'audit' }>['page'];
type Write = Extract<MarketModerationAction, { action: 'report' | 'decision' | 'resolve' }>;

function errorText(code: string): string {
  if (code === 'stale_review' || code === 'stale_report') return t('Nội dung đã đổi. Mở lại phiên bản để xem trước khi quyết định.');
  if (code === 'pending_limit') return t('Máy này đang giữ 10 thao tác chưa rõ kết quả. Đăng nhập tài khoản đã gửi để kiểm tra trước khi gửi thêm.');
  if (code === 'report_limit') return t('Bạn đã gửi 10 report trong 24 giờ. Hãy thử lại sau.');
  if (code === 'already_reported') return t('Bạn đã report phiên bản này.');
  if (code === 'report_unavailable') return t('Phiên bản này hiện không công khai hoặc đã đổi.');
  if (code === 'review_forbidden') return t('Tài khoản hiện không có quyền duyệt.');
  if (code === 'account_changed' || code === 'account_unavailable' || code === 'invalid_token') return t('Đăng nhập tài khoản đã xác minh để tiếp tục.');
  if (code === 'listing_hidden') return t('Mục đã bị ẩn. Gửi phiên bản mới không mở lại mục.');
  return t('Dịch vụ duyệt và report chưa sẵn sàng. Hãy thử lại sau.');
}
function reportReason(reason: 'security' | 'privacy' | 'license' | 'other'): string {
  if (reason === 'security') return t('An toàn');
  if (reason === 'privacy') return t('Riêng tư');
  if (reason === 'license') return t('Giấy phép');
  return t('Khác');
}

/** Server capability is a UI hint; main and Worker independently check every action. */
export function useMarketModeration() {
  const [capability, setCapability] = useState<Capability>();
  const [session, setSession] = useState(0);
  const [report, setReport] = useState<MarketListingV2>();
  const [review, setReview] = useState<{ listingId: string; version: number }>();
  const [queueOpen, setQueueOpen] = useState(false);
  const [resume, setResume] = useState<string>();
  const [operations, setOperations] = useState<MarketModerationWrite[]>([]);
  const [journalError, setJournalError] = useState(false);
  const generation = useRef(0);
  const journalGeneration = useRef(0);
  const refreshCapability = useRef<() => Promise<void>>(async () => {});
  const openReview = (value: { listingId: string; version: number }) => setReview({ listingId: value.listingId, version: value.version });
  const refreshJournal = async () => {
    const current = generation.current;
    const request = ++journalGeneration.current;
    try {
      const result = await orglet.marketModeration({ action: 'journal' });
      if (current === generation.current && request === journalGeneration.current) {
        setJournalError(result.kind !== 'journal' && !(result.kind === 'error' && result.code === 'account_unavailable'));
        if (result.kind === 'journal') setOperations(result.operations);
      }
    } catch { if (current === generation.current && request === journalGeneration.current) setJournalError(true); }
  };
  useEffect(() => {
    let snapshot: string | undefined;
    let mounted = true;
    const refresh = async () => {
      const current = ++generation.current;
      setCapability(undefined);
      try {
        const result = await orglet.marketModeration({ action: 'capability' });
        if (mounted && current === generation.current && result.kind === 'capability') setCapability({ ...result.capability, status: result.status });
      } catch { /* Discovery remains usable if account services are unavailable. */ }
    };
    refreshCapability.current = refresh;
    void orglet.accountState().then(state => { if (mounted && snapshot === undefined) snapshot = JSON.stringify(state); });
    const unsubscribe = orglet.onAccount(state => {
      const next = JSON.stringify(state);
      if (next === snapshot) return;
      snapshot = next;
      setSession(value => value + 1);
      setReport(undefined); setReview(undefined); setQueueOpen(false); setOperations([]); setJournalError(false); setResume(undefined);
      void refresh();
    });
    void refresh();
    return () => { mounted = false; generation.current += 1; refreshCapability.current = async () => {}; unsubscribe(); };
  }, []);
  useEffect(() => { void refreshJournal(); }, [session, capability, report, review]);
  return { capability, setReport, setReview: openReview, refresh: () => refreshCapability.current(),
    entry: capability?.canReview ? <Button type="button" variant="ghost" onClick={() => setQueueOpen(true)}><ShieldCheck size={16} />{t('Duyệt marketplace')}</Button> : null,
    recovery: <>
      {journalError && <p className="muted" role="status">{t('Không đọc được thao tác đã lưu. Thử lại để kiểm tra kết quả.')} <Button type="button" variant="ghost" onClick={() => void refreshJournal()}>{t('Thử lại')}</Button></p>}
      {operations.length > 0 && <MarketPendingOperations key={session} operations={operations} capability={capability} onChanged={refreshJournal} />}
    </>,
    dialogs: <>
      {report && <MarketReportDialog key={`report-${session}`} listing={report} capability={capability} onClose={() => setReport(undefined)} />}
      {queueOpen && <MarketReviewQueue key={`queue-${session}`} active={!review} resume={resume} onClose={() => setQueueOpen(false)} onSelect={value => { setResume(`${value.listingId}:${value.version}`); openReview(value); }} />}
      {review && <MarketReviewDialog key={`${session}-${review.listingId}-${review.version}`} selected={review} canWrite={capability?.canReview === true && capability.canWrite === true} onClose={() => setReview(undefined)} />}
    </>,
  };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const active = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: MarketModerationAction) => {
    if (active.current) return undefined;
    active.current = true; setBusy(true); setError('');
    try {
      const result = await orglet.marketModeration(action);
      if (!mounted.current) return undefined;
      if (result.kind === 'error') { setError(errorText(result.code)); return result; }
      return result;
    } catch (reason) {
      if (mounted.current) {
        setError(tMessage(reason instanceof Error ? reason.message : String(reason)));
        if (action.action === 'report' || action.action === 'decision' || action.action === 'resolve') return { kind: 'unknown' } as const;
      }
    }
    finally { active.current = false; if (mounted.current) setBusy(false); }
    return undefined;
  };
  return { run, busy, error };
}

function Outcome({ unknown, receipt }: { unknown: boolean; receipt: boolean }) {
  return unknown ? <p className="muted" role="status">{t('Chưa rõ kết quả. Thử lại sẽ dùng đúng nội dung đã gửi.')}</p> : receipt ? <p role="status">{t('Đã ghi nhận thao tác.')}</p> : null;
}

function MarketReportDialog({ listing, capability, onClose }: { listing: MarketListingV2; capability: Capability | undefined; onClose: () => void }) {
  const canReport = capability?.canReport === true;
  const { run, busy, error } = useAction();
  const [reason, setReason] = useState<'security' | 'privacy' | 'license' | 'other'>('other');
  const [explanation, setExplanation] = useState('');
  const [pending, setPending] = useState<Write>();
  const [unknown, setUnknown] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const input = { listingId: listing.listingId, version: listing.version, sha256: listing.sha256, reviewDigest: listing.reviewDigest, reason, explanation };
  const valid = MarketReportInput.safeParse(input).success;
  const send = async () => {
    const action: Write = pending ?? { action: 'report', input: MarketReportInput.parse(input), key: crypto.randomUUID() };
    setPending(action);
    const result = await run(action);
    if (result?.kind === 'receipt') { setUnknown(false); setReceipt(true); }
    else if (result?.kind === 'unknown') setUnknown(true);
    else if (!unknown) setPending(undefined);
  };
  const footer = <div className="actions sticky-actions">
    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Đóng')}</Button>
    {!receipt && <Button type="button" disabled={busy || !canReport || (!unknown && !valid)} onClick={() => void send()}><Flag size={16} />{unknown ? t('Thử lại đúng thao tác') : t('Gửi report')}</Button>}
  </div>;
  return <Drawer open title={t('Report phiên bản')} onClose={onClose}><div className="market-publishing form">
    <p><strong>{listing.name}</strong> · v{listing.version}</p>
    <p className="muted">{t('Report chỉ gửi cho người duyệt; không tự ẩn mục. Đừng đưa thông tin riêng tư hoặc khóa truy cập vào lý do.')}</p>
    {!canReport && <p role="status" className="muted">{capability?.status === 'accountRequired' ? t('Đăng nhập tài khoản đã xác minh để tiếp tục.') : t('Dịch vụ duyệt và report chưa sẵn sàng. Hãy thử lại sau.')}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <Outcome unknown={unknown} receipt={receipt} />
    <Select label={t('Lý do report')} value={reason} disabled={busy || !!pending || receipt} onChange={value => setReason(value as typeof reason)} options={[
      { value: 'security', label: t('An toàn') }, { value: 'privacy', label: t('Riêng tư') }, { value: 'license', label: t('Giấy phép') }, { value: 'other', label: t('Khác') },
    ]} />
    <label className="field"><FieldLabel icon={FileText} required>{t('Giải thích ngắn')}</FieldLabel><Textarea value={explanation} maxLength={2048} disabled={busy || !!pending || receipt} onChange={event => setExplanation(event.target.value)} placeholder={t('Nêu nội dung cần kiểm tra, không dán dữ liệu riêng tư.')} /></label>
    {explanation.trim() && !valid && <p className="muted" role="status">{t('Lý do quá dài hoặc có thông tin không thể chia sẻ.')}</p>}
    {footer}
  </div></Drawer>;
}

function ReviewVersion({ detail }: { detail: MarketReviewDetail }) {
  return <><p><strong>{detail.listing.name}</strong> · v{detail.listing.version} · {detail.state === 'pending' ? t('Đang chờ duyệt') : detail.state === 'approved' ? t('Đã duyệt') : t('Đã từ chối')}</p>
    {detail.hidden && <p role="status">{t('Mục đã bị ẩn. Gửi phiên bản mới không mở lại mục.')} {detail.hiddenReason}</p>}
    {detail.reason && <p>{detail.reason}</p>}
    {detail.selfReview && <p className="muted">{t('Đây là mục của bạn. Quyết định vẫn cần kiểm tra và được ghi vào lịch sử duyệt.')}</p>}
  </>;
}

function MarketReviewQueue({ active, resume, onClose, onSelect }: { active: boolean; resume?: string; onClose: () => void; onSelect: (value: { listingId: string; version: number }) => void }) {
  const { run, busy, error } = useAction();
  const [page, setPage] = useState<Queue>();
  const [cursor, setCursor] = useState<string>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!active || !resume) return;
    const frame = requestAnimationFrame(() => buttons.current.get(resume)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, resume]);
  const load = async (next?: string) => {
    const result = await run({ action: 'queue', cursor: next });
    if (result?.kind === 'queue') { setPage(result.page); setCursor(next); }
  };
  useEffect(() => { void load(); }, []);
  return <Drawer open={active} title={t('Duyệt marketplace')} onClose={onClose}><div className="market-publishing">
    <p className="muted">{t('Xem phiên bản chờ duyệt và phiên bản có report chưa xử lý, kể cả mục đã gỡ.')}</p>
    <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={16} />{t('Làm mới')}</Button>
    {error && <p className="error" role="alert">{error}</p>}
    {!page ? busy && <div className="marketplace-loading" aria-label={t('Đang tải danh mục')}><div /><div /></div> : page.items.length === 0 ? <p role="status">{t('Không có phiên bản chờ duyệt trên trang này.')}</p> : <ul className="friends-sources">
      {page.items.map(item => <li className="friend-source" key={`${item.listing.listingId}-${item.listing.version}`}><span className="friend-source-text"><strong>{item.listing.name}</strong><span className="friend-status">v{item.listing.version} · {item.listing.author.displayName} · {item.state === 'pending' ? t('Đang chờ duyệt') : item.state === 'approved' ? t('Đã duyệt') : t('Đã từ chối')} · {t('Report của phiên bản')}: {item.reportCount}</span><span className="friend-status">{item.listing.summary}</span></span><Button ref={element => { const id = `${item.listing.listingId}:${item.listing.version}`; if (element) buttons.current.set(id, element); else buttons.current.delete(id); }} type="button" variant="outline" disabled={busy} onClick={() => onSelect(item.expected)}>{t('Xem để duyệt')}</Button></li>)}
    </ul>}
    {(cursor || page?.nextCursor) && <div className="marketplace-pagination"><Button type="button" variant="outline" disabled={busy || !cursor} onClick={() => void load()}>{t('Trang đầu')}</Button><Button type="button" variant="outline" disabled={busy || !page?.nextCursor} onClick={() => void load(page!.nextCursor!)}>{t('Trang tiếp theo')}</Button></div>}
  </div></Drawer>;
}

function MarketReviewDialog({ selected, canWrite, onClose }: { selected: { listingId: string; version: number }; canWrite: boolean; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const [view, setView] = useState<Detail>();
  const [reports, setReports] = useState<Reports>();
  const [reportsBusy, setReportsBusy] = useState(false);
  const [reportsError, setReportsError] = useState(false);
  const [reportsCursor, setReportsCursor] = useState<string>();
  const [reportsComplete, setReportsComplete] = useState(false);
  const [audit, setAudit] = useState<Audit>();
  const [auditBusy, setAuditBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState<Write>();
  const [unknown, setUnknown] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const loadReports = async (cursor?: string) => {
    setReportsCursor(cursor); setReportsBusy(true); setReportsError(false);
    try {
      const result = await run({ action: 'reports', ...selected, cursor });
      if (result?.kind === 'reports') { setReports(result.page); if (!result.page.nextCursor) setReportsComplete(true); }
      else setReportsError(true);
    } finally { setReportsBusy(false); }
  };
  const loadAudit = async (cursor?: string) => {
    setAuditBusy(true);
    try {
      const result = await run({ action: 'audit', ...selected, cursor });
      if (result?.kind === 'audit') setAudit(result.page);
    } finally { setAuditBusy(false); }
  };
  const load = async () => {
    setView(undefined); setReports(undefined); setReportsError(false); setReportsCursor(undefined); setReportsComplete(false); setAudit(undefined); setChecked(false); setReason('');
    const result = await run({ action: 'detail', ...selected });
    if (result?.kind !== 'detail') return;
    setView(result);
    await loadReports();
  };
  useEffect(() => { void load(); }, []);
  const send = async (action: Write) => {
    setPending(action);
    const result = await run(action);
    if (result?.kind === 'receipt') { setUnknown(false); setReceipt(true); }
    else if (result?.kind === 'unknown') setUnknown(true);
    else if (!unknown) { setPending(undefined); setChecked(false); }
  };
  const decide = async (decision: 'approve' | 'reject' | 'hide') => {
    if (!view) return;
    const input = MarketDecisionInput.parse({ expected: view.detail.expected, decision, reason });
    if (!await confirmAction({ title: decision === 'approve' ? t('Duyệt đúng phiên bản này?') : decision === 'reject' ? t('Từ chối đúng phiên bản này?') : t('Ẩn toàn bộ mục này?'), description: `${view.detail.listing.name} · v${view.detail.listing.version}`, confirmLabel: t('Xác nhận'), tone: decision !== 'approve' ? 'danger' : 'default' })) return;
    await send({ action: 'decision', input, key: crypto.randomUUID() });
  };
  const validReason = view && MarketDecisionInput.safeParse({ expected: view.detail.expected, decision: 'approve', reason }).success;
  const disabled = busy || !canWrite || !reports || reportsError || !reportsComplete || !checked || !validReason || !!pending || receipt;
  const footer = <div className="actions sticky-actions market-review-footer">
    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Đóng')}</Button>
    {unknown && pending ? <Button type="button" disabled={busy || !canWrite} onClick={() => void send(pending)}>{t('Thử lại đúng thao tác')}</Button> : !receipt && view && <>
      <Button type="button" variant="outline" disabled={disabled || view.detail.hidden} onClick={() => void decide('hide')}>{t('Ẩn mục')}</Button>
      <Button type="button" variant="outline" disabled={disabled || view.detail.state !== 'pending'} onClick={() => void decide('reject')}>{t('Từ chối')}</Button>
      <Button type="button" disabled={disabled || view.detail.state !== 'pending' || view.detail.hidden} onClick={() => void decide('approve')}>{t('Duyệt')}</Button>
    </>}
  </div>;
  return <Drawer open title={t('Xem để duyệt')} onClose={onClose}><div className="market-publishing form">
    {error && <p className="error" role="alert">{error}</p>}
    <Outcome unknown={unknown} receipt={receipt} />
    {!view ? busy ? <div className="marketplace-loading" aria-label={t('Đang tải danh mục')}><div /><div /></div> : <Button type="button" variant="outline" onClick={() => void load()}>{t('Mở lại phiên bản')}</Button> : <>
      <ReviewVersion detail={view.detail} />
      {!canWrite && <p className="muted" role="status">{t('Dịch vụ duyệt và report chưa sẵn sàng. Hãy thử lại sau.')}</p>}
      {!pending && <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={16} />{t('Mở lại phiên bản')}</Button>}
      <PublicContentPreview requestText={view.requestText} />
      {view.previousText && <details className="market-publishing-disclosure"><summary><ChevronRight size={14} aria-hidden="true" />{t('Phiên bản đang công khai')}</summary><PublicContentPreview requestText={view.previousText} /></details>}
      <details className="market-publishing-disclosure"><summary><ChevronRight size={14} aria-hidden="true" />{t('Chi tiết phiên bản')}</summary><pre className="market-public-prose">{JSON.stringify(view.detail.expected, null, 2)}</pre></details>
      <details className="market-publishing-disclosure" onToggle={event => { if (event.currentTarget.open && !audit) void loadAudit(); }}><summary><ChevronRight size={14} aria-hidden="true" />{t('Lịch sử duyệt')}</summary>
        {!audit && (auditBusy ? <div className="marketplace-loading" aria-label={t('Đang tải lịch sử duyệt')}><div /></div> : <Button type="button" variant="outline" disabled={busy} onClick={() => void loadAudit()}>{t('Tải lại lịch sử duyệt')}</Button>)}
        {audit?.items.map(event => <article key={event.id} className="market-review-report"><p><strong>{event.actorName}</strong> · {event.decision === 'approve' ? t('Đã duyệt') : event.decision === 'reject' ? t('Đã từ chối') : event.decision === 'hide' ? t('Ẩn mục') : t('Đã xử lý')}{event.selfReview && ` · ${t('Tự duyệt')}`}</p><pre className="market-public-prose">{event.reason}</pre></article>)}
        {audit?.items.length === 0 && <p className="muted">{t('Chưa có quyết định.')}</p>}
        {audit?.nextCursor && <Button type="button" variant="outline" disabled={busy || !!pending} onClick={() => void loadAudit(audit.nextCursor!)}>{t('Trang tiếp theo')}</Button>}
      </details>
      <section className="market-review-reports"><h3>{t('Report của phiên bản')} · {view.detail.reportCount}</h3>
        {reportsError && <><p className="error" role="alert">{t('Không tải được report. Thử lại để kiểm tra trước khi quyết định.')}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void loadReports(reportsCursor)}>{t('Tải lại report')}</Button></>}
        {!reports ? reportsBusy && <div className="marketplace-loading" aria-label={t('Đang tải report')}><div /><div /></div> : reports.items.length === 0 ? <p className="muted">{t('Chưa có report.')}</p> : reports.items.map(report => <article key={report.id} className="market-review-report">
          <p><strong>{reportReason(report.reason)}</strong> · {report.state === 'open' ? t('Chưa xử lý') : report.state === 'dismissed' ? t('Không cần xử lý') : t('Đã xử lý')}</p><pre className="market-public-prose">{report.explanation}</pre>
          {report.reference && <p className="muted">{report.reference.path}:{report.reference.line}</p>}
          {report.state === 'open' && <div className="marketplace-pagination">{(['dismissed', 'resolved'] as const).map(resolution => <Button key={resolution} type="button" variant="outline" disabled={disabled} onClick={() => void send({ action: 'resolve', input: MarketResolveInput.parse({ reportId: report.id, revision: report.revision, resolution, reason }), key: crypto.randomUUID() })}>{resolution === 'dismissed' ? t('Không cần xử lý') : t('Đã xử lý')}</Button>)}</div>}
        </article>)}
        {(reportsCursor || reports?.nextCursor) && <div className="marketplace-pagination"><Button type="button" variant="outline" disabled={busy || !!pending || !reportsCursor} onClick={() => void loadReports()}>{t('Trang đầu')}</Button><Button type="button" variant="outline" disabled={busy || !!pending || !reports?.nextCursor} onClick={() => void loadReports(reports!.nextCursor!)}>{t('Trang tiếp theo')}</Button></div>}
      </section>
      {reports?.nextCursor && !reportsComplete && <p className="muted" role="status">{t('Xem các trang report còn lại trước khi quyết định.')}</p>}
      <label className="field"><FieldLabel icon={FileText} required>{t('Lý do quyết định')}</FieldLabel><Textarea value={reason} maxLength={2048} disabled={busy || !!pending || receipt} onChange={event => setReason(event.target.value)} placeholder={t('Ghi lý do sau khi kiểm tra nội dung. Không dán dữ liệu riêng tư.')} /></label>
      {reason.trim() && !validReason && <p className="muted" role="status">{t('Lý do quá dài hoặc có thông tin không thể chia sẻ.')}</p>}
      <Checkbox checked={checked} disabled={busy || !!pending || receipt || !reports || reportsError || !reportsComplete} onChange={event => setChecked(event.target.checked)}>{t('Tôi đã kiểm tra nội dung của đúng phiên bản này.')}</Checkbox>
    </>}
    {footer}
  </div></Drawer>;
}

function MarketPendingOperations({ operations, capability, onChanged }: { operations: MarketModerationWrite[]; capability: Capability | undefined; onChanged: () => Promise<void> }) {
  const { run, busy, error } = useAction();
  const [selected, setSelected] = useState<MarketModerationWrite>();
  const allowed = selected?.action === 'report' ? capability?.canReport : capability?.canReview && capability.canWrite;
  return <details className="market-publishing-disclosure market-moderation-pending"><summary><ChevronRight size={14} aria-hidden="true" />{t('Duyệt và report chưa rõ kết quả ({0})', [operations.length])}</summary>
    <p className="muted">{t('Nội dung đã lưu trên máy. Chỉ thử lại khi bạn chọn; mỗi lần giữ nguyên nội dung và mã yêu cầu.')}</p>
    <ul className="friends-sources">{operations.map(operation => <li className="friend-source" key={operation.key}><span className="friend-source-text">{operation.action === 'report' ? t('Report phiên bản') : operation.action === 'resolve' ? t('Report đã lưu') : t('Quyết định đã lưu')}{operation.action !== 'resolve' && ` · v${operation.action === 'report' ? operation.input.version : operation.input.expected.version}`}</span><Button type="button" variant="outline" onClick={() => setSelected(operation)}>{t('Xem thao tác đã lưu')}</Button></li>)}</ul>
    {selected && <Drawer open title={t('Thao tác chưa rõ kết quả')} onClose={() => setSelected(undefined)}><div className="market-publishing">
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted">{t('Chưa rõ kết quả. Thử lại sẽ dùng đúng nội dung đã gửi.')}</p>
      <pre className="market-public-prose">{JSON.stringify(selected.input, null, 2)}</pre>
      <div className="actions sticky-actions"><Button type="button" disabled={busy || !allowed} onClick={() => void run({ action: 'retry', operationId: selected.key }).then(async result => {
        if (result?.kind === 'receipt') { toast(t('Đã ghi nhận thao tác.')); setSelected(undefined); }
        await onChanged();
      })}>{t('Thử lại đúng thao tác')}</Button></div>
    </div></Drawer>}
  </details>;
}
