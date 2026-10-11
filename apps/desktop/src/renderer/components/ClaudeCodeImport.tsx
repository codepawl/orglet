import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, CircleMinus, CircleX, FolderOpen, Home } from 'lucide-react';
import type { Connections, Workspace } from '../../shared/contracts';
import type { HarnessInfo } from '../../shared/harness';
import type { ClaudeCodeImportResult, ClaudeCodeItem, ClaudeCodeListing } from '../../shared/claude-code-import';
import { orgletFromSubagent, type OrgletImportContext } from '../../shared/claude-code-orglet';
import { Skeleton, SkeletonGroup } from '@codepawlhq/orglet-ui';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { Checkbox } from './Checkbox';
import { EmptyPanel } from './EmptyPanel';
import { readiness } from './providers';
import { Button, Drawer } from './ui';
import { defaultWorkerProvider, workerProviderOptions } from './WorkerDialog';
import { modelIdRequired } from './workerModel';

type Outcome = { id: string; kind: ClaudeCodeItem['kind']; name: string; status: ClaudeCodeImportResult['status']; reason?: string; notes: string[] };

const GROUPS: { kind: ClaudeCodeItem['kind']; title: () => string }[] = [
  { kind: 'skill', title: () => t('Skills') },
  { kind: 'agent', title: () => t('Tí (từ subagent)') },
  { kind: 'mcp', title: () => t('Máy chủ MCP') },
];

/** The context the subagent mapping needs, read from what the window already knows. */
function importContext(workspace: Workspace, connections: Connections, harnesses: HarnessInfo[] | undefined, listing: ClaudeCodeListing | undefined): OrgletImportContext {
  const ready = readiness(connections, harnesses, workspace.customConnections);
  const usableSkills = new Map<string, string>();
  const waitingSkills = new Set<string>();
  for (const skill of workspace.skills) {
    const waiting = !!skill.package && skill.package.reviewedHash !== skill.package.hash;
    if (waiting) waitingSkills.add(skill.name.toLowerCase());
    else usableSkills.set(skill.name.toLowerCase(), skill.id);
  }
  // Every skill in the listing is imported unreviewed, so an orglet cannot name it yet.
  for (const item of listing?.items ?? []) if (item.kind === 'skill') waitingSkills.add(item.name.toLowerCase());
  return {
    defaultProvider: defaultWorkerProvider(workerProviderOptions(ready, harnesses ?? [], workspace.customConnections)),
    claudeCodeConnected: harnesses !== undefined && ready['claude-code'],
    defaultSkillId: workspace.skills[0]?.id ?? '',
    usableSkills,
    waitingSkills,
  };
}

/**
 * Import from Claude Code (docs/import-from-claude-code.md): what a Claude Code folder holds, with a checkbox for each
 * thing. Nothing is read until this opens, nothing runs, and a skill lands as a package that waits for review.
 */
export function ClaudeCodeImportDialog({ open, onClose, workspace, connections, harnesses }: { open: boolean; onClose: () => void; workspace: Workspace; connections: Connections; harnesses: HarnessInfo[] | undefined }) {
  const [listing, setListing] = useState<ClaudeCodeListing>();
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>();

  const show = (next: ClaudeCodeListing) => {
    setListing(next);
    setChecked(new Set(next.items.filter(item => !item.blocked && !item.alreadyHere).map(item => item.id)));
    setOutcomes(undefined);
  };
  const read = async (chooseProject: boolean) => {
    setError('');
    try {
      const next = await orglet.scanClaudeCode({ chooseProject });
      if (next) show(next);
    } catch (failure) {
      setError(tMessage((failure as Error).message));
    }
  };
  useEffect(() => {
    if (!open) return;
    setListing(undefined);
    setOutcomes(undefined);
    void read(false);
  }, [open]);

  const context = useMemo(() => importContext(workspace, connections, harnesses, listing), [workspace, connections, harnesses, listing]);
  const notesOf = (item: ClaudeCodeItem) => item.agent ? [...item.notes, ...orgletFromSubagent(item.agent, context).notes] : item.notes;
  const selectable = (item: ClaudeCodeItem) => !item.blocked && !item.alreadyHere;
  const toggle = (id: string, on: boolean) => setChecked(current => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const importChecked = async () => {
    if (!listing) return;
    setBusy(true);
    setError('');
    try {
      const picked = listing.items.filter(item => checked.has(item.id) && selectable(item));
      const results = await orglet.importClaudeCode(picked.filter(item => item.kind !== 'agent').map(item => item.id));
      const done: Outcome[] = results.map(result => ({ ...result, notes: listing.items.find(item => item.id === result.id)?.notes ?? [] }));
      for (const item of picked.filter(entry => entry.kind === 'agent' && entry.agent)) done.push(await createOrglet(item));
      setOutcomes(done);
    } catch (failure) {
      setError(tMessage((failure as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const createOrglet = async (item: ClaudeCodeItem): Promise<Outcome> => {
    const base = { id: item.id, kind: item.kind, name: item.name };
    const mapped = orgletFromSubagent(item.agent!, context);
    const notes = [...item.notes, ...mapped.notes];
    if (!context.defaultSkillId) return { ...base, status: 'failed', reason: t('Chưa có skill nào để gán cho Tí.'), notes };
    if (modelIdRequired(mapped.input.provider) && !mapped.input.modelId) return { ...base, status: 'failed', reason: t('Model mặc định cần ID model. Tạo Tí này bằng tay.'), notes };
    try {
      await orglet.call('saveWorker', mapped.input);
      return { ...base, status: 'imported', notes };
    } catch (failure) {
      return { ...base, status: 'failed', reason: tMessage((failure as Error).message), notes };
    }
  };

  const picked = listing ? listing.items.filter(item => checked.has(item.id) && selectable(item)).length : 0;
  const importedSkills = outcomes?.some(outcome => outcome.kind === 'skill' && outcome.status === 'imported');

  return <Drawer open={open} onClose={onClose} title={t('Nhập từ Claude Code')}>
    <div className="claude-import">
      {!listing && !error && <SkeletonGroup label={t('Đang đọc thư mục…')}><Skeleton shape="block" className="claude-import-shape" /></SkeletonGroup>}
      {error && <p role="alert" className="error outcome-line"><CircleX size={16} aria-hidden="true" />{error}</p>}
      {listing && !outcomes && <>
        <div className="claude-import-folder">
          <p className="muted">{t('Đã đọc {0}. Chưa có gì được nhập và không có gì chạy.', [listing.folder])}</p>
          <span className="claude-import-folder-actions">
            {listing.project && <Button variant="ghost" onClick={() => void read(false)}><Home size={16} />{t('Đọc thư mục chính')}</Button>}
            <Button variant="outline" onClick={() => void read(true)}><FolderOpen size={16} />{t('Chọn thư mục dự án')}</Button>
          </span>
        </div>
        {listing.warnings.map(warning => <p key={warning} className="muted outcome-line"><CircleAlert size={16} aria-hidden="true" />{tMessage(warning)}</p>)}
        {listing.items.length === 0 && <EmptyPanel title={t('Không thấy gì để nhập ở đây.')} hint={t('Thư mục này không có skill, lệnh, subagent hay máy chủ MCP của Claude Code.')} />}
        {GROUPS.map(group => {
          const items = listing.items.filter(item => item.kind === group.kind);
          if (!items.length) return null;
          return <section key={group.kind} className="claude-import-group" aria-label={group.title()}>
            <h3>{group.title()}</h3>
            {items.map(item => <ItemRow key={item.id} item={item} notes={notesOf(item)} checked={checked.has(item.id)} disabled={!selectable(item) || busy} onChange={on => toggle(item.id, on)} />)}
          </section>;
        })}
        {listing.items.length > 0 && <div className="claude-import-actions">
          <Button variant="ghost" onClick={onClose}>{t('Thôi')}</Button>
          <Button variant="primary" disabled={busy || picked === 0} onClick={() => void importChecked()}>{t('Nhập {0} mục', [picked])}</Button>
        </div>}
      </>}
      {outcomes && <>
        <section className="claude-import-group" aria-label={t('Kết quả nhập')}>
          <h3>{t('Kết quả nhập')}</h3>
          {outcomes.map(outcome => <div key={outcome.id} className="claude-import-result">
            <OutcomeMark status={outcome.status} />
            <span className="claude-import-text">
              <span className="claude-import-name">{outcome.name}</span>
              <span className="muted">{outcome.status === 'imported' ? t('Đã nhập') : outcome.reason ? tMessage(outcome.reason) : t('Bỏ qua')}</span>
              {outcome.notes.map(note => <small key={note} className="muted">{tMessage(note)}</small>)}
            </span>
          </div>)}
        </section>
        {importedSkills && <p className="muted">{t('Skill vừa nhập cần review trong Thư viện trước khi dùng.')}</p>}
        <div className="claude-import-actions"><Button variant="primary" onClick={onClose}>{t('Xong')}</Button></div>
      </>}
    </div>
  </Drawer>;
}

function OutcomeMark({ status }: { status: Outcome['status'] }) {
  if (status === 'imported') return <CircleCheck size={16} aria-label={t('Đã nhập')} className="claude-import-mark claude-import-success" />;
  if (status === 'failed') return <CircleX size={16} aria-label={t('Không nhập được')} className="claude-import-mark claude-import-failure" />;
  return <CircleMinus size={16} aria-label={t('Bỏ qua')} className="claude-import-mark" />;
}

function ItemRow({ item, notes, checked, disabled, onChange }: { item: ClaudeCodeItem; notes: string[]; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return <div className="claude-import-item">
    <Checkbox checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} aria-label={item.name}>
      <span className="claude-import-text">
        <span className="claude-import-name">{item.name}</span>
        {item.description && <span className="muted claude-import-description">{item.description}</span>}
        {item.alreadyHere && <span className="muted outcome-line"><CircleCheck size={14} aria-hidden="true" />{t('Đã có trong Orglet')}</span>}
        {item.blocked && <span className="error outcome-line"><CircleAlert size={14} aria-hidden="true" />{tMessage(item.blocked)}</span>}
        {notes.map(note => <small key={note} className="muted">{tMessage(note)}</small>)}
      </span>
    </Checkbox>
  </div>;
}
