import { useEffect, useRef, useState } from 'react';
import { Input, Textarea, Checkbox } from '@codepawl/orglet-ui';
import { ChevronRight, Cpu, Eye, FileText, Globe, Languages, RefreshCw, Send, Tags, Type, Upload, X } from 'lucide-react';
import { BuiltInProviderId, type Workspace } from '../../shared/contracts';
import { isMemory } from '../../shared/knowledge';
import type { PublishingAction, PublishingOwnView, PublishingPreview, PublishingOperationView } from '../../shared/market-desktop';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { Button, Drawer, FieldLabel } from './ui';
import { Select } from './Select';
import { confirmAction } from './confirm';
import { providerName } from './workerModel';
import type { MarketSubmission } from '../../shared/market-publishing';

type Source = { kind: 'orglet' | 'crew'; entityId: string; name: string };

export function publishingRequiresSuggestion(workspace: Workspace, source: Source): boolean {
  const team = source.kind === 'crew' ? workspace.teams.find(item => item.id === source.entityId) : undefined;
  const ids = team ? [...team.memberIds, team.synthesizerId] : [source.entityId];
  return workspace.workers.some(worker => ids.includes(worker.id) && worker.provider.startsWith('custom:'));
}

/** UI invalidation signal only; core independently verifies full persisted rows before dispatch. */
export function publishingSourceRevision(workspace: Workspace, source: Source): string {
  const team = source.kind === 'crew' ? workspace.teams.find(item => item.id === source.entityId) : undefined;
  const memberIds = team ? [...new Set([...team.memberIds, team.synthesizerId])] : [source.entityId];
  const workers = workspace.workers.filter(worker => memberIds.includes(worker.id));
  const skillIds = new Set(workers.map(worker => worker.skillId));
  return JSON.stringify({
    team: team ? [team.id, team.revision] : null,
    workers: workers.map(worker => [worker.id, worker.revision, worker.skillId]),
    skills: workspace.skills.filter(skill => skillIds.has(skill.id)).map(skill => [skill.id, skill.revision]),
    notes: team ? workspace.knowledge.filter(note => note.scope.type === 'team' && note.scope.id === team.id && note.status === 'approved' && !isMemory(note)).map(note => [note.id, note.revision, note.hash]) : [],
  });
}

function operationLabel(operation: PublishingOperationView): string {
  if (operation.state === 'acceptedPending') return t('Đã gửi để duyệt');
  if (operation.state === 'unpublished') return t('Đã ngừng xuất bản; bản trên máy vẫn giữ nguyên.');
  if (operation.state === 'unknown') return t('Chưa rõ kết quả. Thử lại sẽ dùng đúng nội dung đã gửi.');
  if (operation.state === 'notSent') return t('Chưa gửi đến marketplace.');
  return t('Marketplace đã từ chối lần gửi này.');
}

function capabilityLabel(status: string): string {
  if (status === 'local') return t('Đăng nhập để gửi; bạn vẫn có thể xem trước trên máy.');
  if (status === 'upgradeRequired') return t('Đăng nhập lại trong trình duyệt để cho phép marketplace.');
  if (status === 'unverified') return t('Xác minh email, rồi làm mới trạng thái trước khi gửi.');
  return t('Dịch vụ xuất bản chưa sẵn sàng. Nội dung trên máy vẫn giữ nguyên.');
}

function decodedPreviewFiles(requestText: string): { path: string; text: string }[] {
  const submission = JSON.parse(requestText);
  const skills = submission.kind === 'orglet' ? [submission.template.skill] : submission.template.skills;
  return skills.flatMap((skill: { name: string; package?: { files: { path: string; base64: string }[] } }) =>
    (skill.package?.files ?? []).map(file => ({
      path: `${skill.name}/${file.path}`,
      text: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))),
    })),
  );
}

/** Readable public prose first; the complete original request remains inspectable without reconstruction. */
export function PublicContentPreview({ requestText }: { requestText: string }) {
  const submission = JSON.parse(requestText) as MarketSubmission;
  const workers = submission.kind === 'orglet' ? [submission.template.worker] : submission.template.workers;
  const skills = submission.kind === 'orglet' ? [submission.template.skill] : submission.template.skills;
  const kindName = submission.kind === 'space' ? t('Không gian') : submission.kind === 'crew' ? t('Nhóm Tí') : t('Tí');
  return <div className="market-content-preview">
    <section className="market-preview-summary"><h3>{submission.name}</h3><p>{submission.summary}</p><p className="muted">{kindName} · {submission.language.toUpperCase()} · {submission.license}{submission.tags.length > 0 && ` · ${submission.tags.join(', ')}`}</p>{submission.changelog && <p>{submission.changelog}</p>}</section>
    {submission.kind === 'space' && <section><h3>{submission.template.space.name}</h3>
      <ul className="market-space-channels">
        {submission.template.space.channels.map((channel, index) => {
          const category = submission.template.space.categories.find(item => item.key === channel.categoryKey)?.name;
          const members = channel.memberKeys?.map(key => submission.template.workers.find(worker => worker.key === key)?.name ?? key).join(', ');
          return <li key={index}><span className="market-space-channel">#{channel.name}</span>{category && <span className="muted">{category}</span>}<span className="muted">{members ?? t('Mọi Tí của không gian')}</span>{channel.topic && <span>{channel.topic}</span>}</li>;
        })}
      </ul>
    </section>}
    {submission.kind === 'crew' && <section><h3>{t('Hướng dẫn crew')}</h3><pre className="market-public-prose">{submission.template.team.instructions}</pre></section>}
    {workers.map((worker, index) => <section key={index}><h3>{worker.name}</h3>{worker.description && <p>{worker.description}</p>}<p className="muted">{providerName(worker.provider)}{worker.modelId && ` · ${worker.modelId}`}</p><pre className="market-public-prose">{worker.instructions}</pre></section>)}
    {skills.map((skill, index) => <section key={index}><h3>{skill.name}</h3><pre className="market-public-prose">{skill.content}</pre></section>)}
    {submission.kind === 'crew' && submission.template.knowledge?.map((note, index) => <section key={index}><h3>{note.title}</h3><pre className="market-public-prose">{note.content}</pre></section>)}
    {decodedPreviewFiles(requestText).map((file, index) => <details className="market-publishing-disclosure" key={`${index}-${file.path}`}><summary><ChevronRight size={14} aria-hidden="true" />{file.path}</summary><pre className="market-public-preview">{file.text}</pre></details>)}
    <details className="market-publishing-disclosure market-exact-request"><summary><ChevronRight size={14} aria-hidden="true" />{t('Xem toàn bộ JSON sẽ gửi')}</summary><pre className="market-public-preview" aria-label={t('Nội dung công khai chính xác')}>{requestText}</pre></details>
  </div>;
}

/** A local form, then every public byte as escaped text; sending is a separate explicit button. */
export function MarketPublishingDialog({ source, sourceRevision, requiresSuggestion = false, onClose }: { source: Source; sourceRevision: string; requiresSuggestion?: boolean; onClose: () => void }) {
  const [name, setName] = useState(source.name);
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState<'en' | 'vi'>('en');
  const [changelog, setChangelog] = useState('');
  const [target, setTarget] = useState('new');
  const [suggestedProvider, setSuggestedProvider] = useState('source');
  const [suggestedModel, setSuggestedModel] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(requiresSuggestion);
  const [own, setOwn] = useState<PublishingOwnView>();
  const [preview, setPreview] = useState<PublishingPreview>();
  const [license, setLicense] = useState(false);
  const [pendingAcknowledged, setPendingAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<PublishingOperationView>();
  const previewGeneration = useRef(0);
  const accountGeneration = useRef(0);
  const accountView = useRef<string | undefined>(undefined);
  const formSnapshot = useRef('');
  formSnapshot.current = JSON.stringify({ name, summary, tags, language, changelog, target, suggestedProvider, suggestedModel });
  const invalidate = () => {
    previewGeneration.current += 1;
    setPreview(undefined);
    setLicense(false);
    setPendingAcknowledged(false);
  };
  useEffect(() => {
    void orglet.accountState().then(state => {
      if (accountView.current === undefined) accountView.current = JSON.stringify(state);
    });
    const unsubscribeAccount = orglet.onAccount(state => {
      const next = JSON.stringify(state);
      if (accountView.current === next) return;
      accountView.current = next;
      accountGeneration.current += 1;
      invalidate();
      setOwn(undefined);
      setOperation(undefined);
      setError('');
      setBusy(false);
    });
    return () => {
      unsubscribeAccount();
      accountGeneration.current += 1;
    };
  }, []);
  useEffect(invalidate, [sourceRevision]);
  useEffect(() => { if (requiresSuggestion && suggestedProvider === 'source') setOptionsOpen(true); }, [requiresSuggestion, suggestedProvider]);
  const run = async (action: PublishingAction) => {
    const generation = previewGeneration.current;
    const account = accountGeneration.current;
    const reviewedForm = formSnapshot.current;
    setBusy(true);
    setError('');
    try {
      const result = await orglet.marketPublishing(action);
      if (account !== accountGeneration.current) return;
      if (result.kind === 'preview' && generation === previewGeneration.current && reviewedForm === formSnapshot.current) setPreview(result.preview);
      if (result.kind === 'own') setOwn(result.view);
      if (result.kind === 'operation') {
        setOperation(result.operation);
        invalidate();
      }
      if (result.kind === 'blocked') setError(`${result.diagnostics.map(item => `${tMessage(item.message)} ${item.path}:${item.line} · ${item.rule}`).join('\n')}\n${t('Sửa nội dung ở mục gốc, rồi xem trước lại. Không gửi thông tin đăng nhập.')}`);
    } catch (reason) {
      if (account === accountGeneration.current) setError(tMessage(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (account === accountGeneration.current) setBusy(false);
    }
  };
  return <Drawer open title={t('Xuất bản lên marketplace')} description={source.name} onClose={onClose}>
    <div className="market-publishing form">
      {operation && <p role="status">{operationLabel(operation)}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!preview ? <>
        <label className="field"><FieldLabel icon={Type} required>{t('Tên công khai')}</FieldLabel><Input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label className="field"><FieldLabel icon={FileText} required>{t('Mô tả ngắn')}</FieldLabel><Textarea value={summary} rows={3} maxLength={240} placeholder={t('Mẫu này giúp làm việc gì?')} onChange={event => setSummary(event.target.value)} /></label>
        <div className="field-grid">
        <label className="field"><FieldLabel icon={Tags}>{t('Thẻ, cách nhau bằng dấu phẩy')}</FieldLabel><Input value={tags} placeholder="research, writing" onChange={event => setTags(event.target.value)} /></label>
        <Select label={<FieldLabel icon={Languages} required>{t('Ngôn ngữ nội dung')}</FieldLabel>} value={language} onChange={value => setLanguage(value as 'en' | 'vi')} options={[{ value: 'en', label: 'English' }, { value: 'vi', label: 'Tiếng Việt' }]} />
        </div>
        <details className="market-publishing-disclosure" open={optionsOpen} onToggle={event => setOptionsOpen(event.currentTarget.open)}><summary><ChevronRight size={14} aria-hidden="true" />{t('Phiên bản và model gợi ý')}</summary><div className="market-publishing-options">
        <label className="field"><FieldLabel icon={FileText}>{t('Thay đổi trong phiên bản này')}</FieldLabel><Textarea value={changelog} rows={3} maxLength={2000} onChange={event => setChangelog(event.target.value)} /></label>
        {requiresSuggestion && <p className="muted">{t('Kết nối riêng không được chia sẻ. Chọn một kết nối gợi ý trong mục phiên bản và model trước khi xem trước.')}</p>}
        <Select label={<FieldLabel icon={Cpu} required={requiresSuggestion}>{t('Kết nối gợi ý trong mẫu')}</FieldLabel>} value={suggestedProvider} onChange={setSuggestedProvider} options={[{ value: 'source', label: requiresSuggestion ? t('Chọn kết nối gợi ý') : t('Giữ gợi ý từ mục gốc') }, ...BuiltInProviderId.options.map(provider => ({ value: provider, label: providerName(provider) }))]} />
        {suggestedProvider !== 'source' && <label className="field"><FieldLabel icon={Cpu}>{t('Model gợi ý')}</FieldLabel><Input value={suggestedModel} maxLength={200} onChange={event => setSuggestedModel(event.target.value)} /><span className="muted">{t('Gợi ý này áp dụng cho các Tí trong mẫu; kết nối trên máy không thay đổi.')}</span></label>}
        </div></details>
        <div className="market-publishing-target">
        <Select label={<FieldLabel icon={Globe} required>{t('Mục xuất bản')}</FieldLabel>} value={target} onChange={setTarget} options={[{ value: 'new', label: t('Tạo mục mới') }, ...(own?.summaries?.listings.filter(item => item.kind === source.kind).map(item => ({ value: item.listingId, label: `${item.latest.listing.name} · v${item.latest.listing.version}` })) ?? [])]} />
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ action: 'listOwn' })}><RefreshCw size={16} />{t('Làm mới mục của tôi')}</Button>
        </div>
        <p className="muted">{t('Chỉ hướng dẫn, skill và ghi chú đã duyệt được chia sẻ. Quyền, kết nối riêng và cuộc trò chuyện ở lại trên máy.')}</p>
        <div className="actions sticky-actions"><Button type="button" disabled={busy || !name.trim() || !summary.trim() || (requiresSuggestion && suggestedProvider === 'source')} onClick={() => void run({ action: 'preview', source: { kind: source.kind, entityId: source.entityId }, metadata: { name, summary, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), language, license: 'CC-BY-4.0', changelog }, target: target === 'new' ? null : target, ...(suggestedProvider !== 'source' ? { suggestion: { provider: BuiltInProviderId.parse(suggestedProvider), ...(suggestedModel.trim() ? { modelId: suggestedModel.trim() } : {}) } } : {}) })}><Eye size={16} />{t('Xem trước nội dung công khai')}</Button></div>
      </> : <>
        <p>{t('Toàn bộ nội dung bên dưới sẽ công khai sau khi được duyệt.')}</p>
        <PublicContentPreview requestText={preview.requestText} />
        <Checkbox required checked={license} onChange={event => setLicense(event.target.checked)}>{t('Tôi có quyền chia sẻ nội dung này theo CC BY 4.0.')}</Checkbox>
        <Checkbox required checked={pendingAcknowledged} onChange={event => setPendingAcknowledged(event.target.checked)}>{t('Tôi hiểu mỗi phiên bản đều chờ duyệt trước khi xuất hiện công khai.')}</Checkbox>
        {preview.capability.status !== 'available' && <p className="muted" role="status">{capabilityLabel(preview.capability.status)}</p>}
        <div className="actions sticky-actions"><Button type="button" variant="outline" disabled={busy} onClick={invalidate}><X size={16} />{t('Sửa nội dung')}</Button><Button type="button" disabled={busy || !license || !pendingAcknowledged || preview.capability.status !== 'available'} onClick={() => void run({ action: 'submit', previewId: preview.previewId })}><Send size={16} />{t('Gửi để duyệt')}</Button></div>
        {(preview.capability.status === 'local' || preview.capability.status === 'upgradeRequired') && <Button type="button" variant="outline" disabled={busy} onClick={() => {
          invalidate();
          void orglet.accountSignIn().catch(reason => setError(tMessage(reason.message)));
        }}><Upload size={16} />{t('Đăng nhập trong trình duyệt')}</Button>}
      </>}
    </div>
  </Drawer>;
}

export function MarketOwnListings() {
  const accountGeneration = useRef(0);
  const accountView = useRef<string | undefined>(undefined);
  const [view, setView] = useState<PublishingOwnView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ operation: PublishingOperationView; requestText: string }>();
  const run = async (action: PublishingAction) => {
    const account = accountGeneration.current;
    setBusy(true);
    setError('');
    try {
      const result = await orglet.marketPublishing(action);
      if (account !== accountGeneration.current) return;
      if (result.kind === 'own') setView(result.view);
      if (result.kind === 'saved') setSaved(result);
      else if (result.kind === 'operation') {
        setSaved(undefined);
        const next = await orglet.marketPublishing({ action: 'listOwn' });
        if (account === accountGeneration.current && next.kind === 'own') setView(next.view);
      }
    } catch (reason) {
      if (account === accountGeneration.current) setError(tMessage(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (account === accountGeneration.current) setBusy(false);
    }
  };
  useEffect(() => {
    void orglet.accountState().then(state => {
      if (accountView.current === undefined) accountView.current = JSON.stringify(state);
    });
    const unsubscribe = orglet.onAccount(state => {
      const next = JSON.stringify(state);
      if (accountView.current === next) return;
      accountView.current = next;
      accountGeneration.current += 1;
      setView(undefined);
      setSaved(undefined);
      setError('');
      setBusy(false);
      void run({ action: 'listOwn' });
    });
    void run({ action: 'listOwn' });
    return () => {
      unsubscribe();
      accountGeneration.current += 1;
    };
  }, []);
  return <section className="market-own" aria-label={t('Mục của tôi')}>
    <div className="market-own-content">
    <p className="muted">{t('Để chia sẻ mẫu, mở menu của một Tí hoặc crew rồi chọn Xuất bản lên marketplace. Bạn luôn xem trước nội dung trước khi gửi.')}</p>
    <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ action: 'listOwn' })}><RefreshCw size={16} />{t('Làm mới mục của tôi')}</Button>
    {!view && busy && <div className="marketplace-loading" aria-label={t('Đang tải mục của tôi')}><div /><div /></div>}
    {error && <p className="error" role="alert">{error}</p>}
    {view?.capability.status !== undefined && view.capability.status !== 'available' && <p className="muted">{capabilityLabel(view.capability.status)}</p>}
    {view?.summaries && <p className="muted">{t('{0}/{1} mục; {2}/5 lần gửi trong giờ qua.', [view.summaries.allowance.listingCount, view.summaries.allowance.listingLimit, view.summaries.allowance.submissionsInHour])}</p>}
    {view?.summaries?.listings.length === 0 && view.operations.length === 0 && <p className="muted">{t('Chưa có mục xuất bản. Mở menu của một Tí hoặc crew để xem trước và gửi mẫu.')}</p>}
    {view?.summaries?.listings.map(item => <div className="friend-source market-own-listing" key={item.listingId}>
      <span className="friend-source-text"><span className="friend-name">{item.latest.listing.name}</span><span className="friend-status">{t('Phiên bản mới nhất')} · v{item.latest.listing.version} · {item.latest.state === 'pending' ? t('Đang chờ duyệt') : item.latest.state === 'approved' ? t('Đã duyệt') : t('Đã từ chối')}</span><span className="friend-status">{item.published ? `${t('Đang công khai')} · v${item.published.version}` : item.hidden ? t('Đã bị ẩn') : item.publicationEpoch > 0 ? t('Đã ngừng xuất bản') : t('Hiện không công khai')}</span>{item.latest.reason && <span className="friend-status">{item.latest.reason}</span>}{item.hidden && <span className="friend-status">{t('Mục đã bị ẩn. Gửi phiên bản mới không mở lại mục.')} {item.hiddenReason}</span>}</span>
      {item.published && <Button type="button" variant="outline" disabled={busy || view.capability.status !== 'available'} onClick={() => void confirmAction({ title: t('Ngừng xuất bản {0}?', [item.latest.listing.name]), description: t('Các bản đã thêm trên máy vẫn giữ nguyên. Đây là thao tác cho toàn bộ mục, không chỉ phiên bản đang xem.'), confirmLabel: t('Ngừng xuất bản') }).then(confirmed => {
        if (confirmed) void run({ action: 'unpublish', listingId: item.listingId, confirmation: view.confirmations[item.listingId] });
      })}><X size={16} />{t('Ngừng xuất bản')}</Button>}
    </div>)}
    {view?.operations.map(operation => <div className="friend-source" key={operation.id}><span className="friend-source-text"><span className="friend-name">{operation.name}</span><span className="friend-status">{operationLabel(operation)}</span></span>{(operation.state === 'unknown' || operation.state === 'notSent') && <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ action: 'inspect', operationId: operation.id })}><Eye size={16} />{t('Xem nội dung đã gửi')}</Button>}</div>)}
    {saved && <Drawer open title={saved.operation.name} description={operationLabel(saved.operation)} onClose={() => setSaved(undefined)}>
      <div className="market-publishing form">{saved.operation.operation === 'unpublish' ? <pre className="market-public-preview">{saved.requestText}</pre> : <PublicContentPreview requestText={saved.requestText} />}{view?.capability.status !== 'available' && <p className="muted" role="status">{capabilityLabel(view?.capability.status ?? 'unavailable')}</p>}<div className="actions sticky-actions"><Button type="button" disabled={busy || view?.capability.status !== 'available'} onClick={() => void run({ action: 'retry', operationId: saved.operation.id })}><RefreshCw size={16} />{t('Thử lại nội dung đã gửi')}</Button></div></div>
    </Drawer>}
    </div>
  </section>;
}
