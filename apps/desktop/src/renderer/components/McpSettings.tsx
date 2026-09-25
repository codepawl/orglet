import { useState, type FormEvent } from 'react';
import { ChevronRight, FileInput, Globe, KeyRound, ListTree, Pencil, Plus, RefreshCw, Server, SquareTerminal, Tag, Trash2, Variable, X } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { McpServerDraft, McpServerStatus, McpServerView } from '../../shared/mcp';
import { Button, Drawer, FieldLabel } from './ui';
import { Select } from './Select';
import { Switch } from './Switch';
import { RowMenu } from './RowMenu';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { Input, Textarea } from '@codepawl/orglet-ui';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';
import { toast } from './toast';

/** Stands in for a saved value the window never reads back. */
const SAVED_MASK = '••••••••';

/** One server state as the circle the rest of the app uses and one short word. */
function statusOf(status: McpServerStatus): { label: string; className: string; mark: StatusMarkState } {
  if (status === 'connected') return { label: t('Đã kết nối'), className: 'logged_in', mark: { variant: 'filled', tone: 'success' } };
  if (status === 'connecting') return { label: t('Đang khởi động'), className: '', mark: { variant: 'dashed', tone: 'muted' } };
  if (status === 'error') return { label: t('Lỗi kết nối'), className: 'auth_error', mark: { variant: 'dashed', tone: 'error' } };
  if (status === 'disabled') return { label: t('Đang tắt'), className: '', mark: { variant: 'empty', tone: 'muted' } };
  return { label: t('Chưa chạy'), className: '', mark: { variant: 'empty', tone: 'muted' } };
}

/** What the server runs or where it lives, on one line. */
function transportLine(server: McpServerView) {
  if (server.transport.kind === 'http') return server.transport.url;
  return [server.transport.command, ...server.transport.args].join(' ');
}

/**
 * Settings → MCP (COD-241): the servers the person added, each with its state, its tools and a menu to test, edit or
 * remove it. Nothing here reads another app's MCP settings; Import reads only the file the person picks.
 */
export type McpEditing = McpServerView | 'new' | undefined;
type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

/**
 * The tab's actions in the section heading: one primary button to add a server by hand, and a menu beside it for the
 * rarer import from a picked file, so the heading's one-line description keeps its room.
 */
export function McpHeadingActions({ busy, act, onAdd }: { busy: boolean; act: Act; onAdd: () => void }) {
  const importFile = () => void act(async () => {
    const result = await orglet.importMcpServers();
    if (!result) return;
    for (const item of result.skipped) toast(t('Bỏ qua {0}: {1}', [item.name, tMessage(item.reason)]), 'error', 'MCP');
    if (!result.imported.length) return t('Không nhập được máy chủ nào.');
    return t('Đã nhập {0} máy chủ MCP', [result.imported.length]);
  }, 'MCP');
  return <>
    <Button variant="primary" disabled={busy} onClick={onAdd}><Plus size={15} />{t('Thêm máy chủ')}</Button>
    <RowMenu label={t('Thêm cách thêm máy chủ MCP')} items={[{ label: t('Nhập từ tệp'), icon: FileInput, onSelect: importFile }]} />
  </>;
}

export function McpSettings({ workspace, busy, act, editing, onEdit }: { workspace: Workspace; busy: boolean; act: Act; editing: McpEditing; onEdit: (next: McpEditing) => void }) {
  const servers = workspace.mcpServers ?? [];
  return <>
    <div role="region" aria-label={t('Máy chủ MCP')}>
      {!servers.length && <div className="setting-row"><div className="setting-text">
        <span className="setting-title">{t('Chưa có máy chủ MCP nào.')}</span>
        <span className="setting-description">{t('Thêm bằng tay, hoặc nhập từ một tệp JSON bạn chọn. Orglet không tự đọc cấu hình MCP của app khác.')}</span>
      </div></div>}
      {servers.map(server => <McpServerRow key={server.id} server={server} busy={busy} act={act} onEdit={() => onEdit(server)} />)}
    </div>
    {editing && <McpServerEditor server={editing === 'new' ? undefined : editing} onClose={() => onEdit(undefined)} />}
  </>;
}

function McpServerRow({ server, busy, act, onEdit }: { server: McpServerView; busy: boolean; act: Act; onEdit: () => void }) {
  const state = statusOf(server.status);
  const titleId = `mcp-${server.id}-title`;
  const tools = server.tools ?? [];
  const test = () => void act(async () => {
    const view = await orglet.call('testMcpServer', { id: server.id });
    if (view.status === 'error') throw new Error(view.error ? tMessage(view.error) : t('Không kết nối được.'));
    return t('{0} có {1} công cụ', [server.name, view.tools?.length ?? 0]);
  }, server.name);
  return <div className="setting-row harness-row mcp-row">
    <span className="mcp-mark" aria-hidden="true">{server.transport.kind === 'http' ? <Globe size={18} /> : <SquareTerminal size={18} />}</span>
    <div className="setting-text">
      <span className="harness-head">
        <span id={titleId} className="setting-title">{server.name}</span>
        <span className={`status-pill ${state.className}`}><StatusMark variant={state.mark.variant} tone={state.mark.tone} label={state.label} decorative />{state.label}</span>
      </span>
      <span className="setting-path" title={transportLine(server)}>{transportLine(server)}</span>
      {server.status === 'error' && server.error && <span className="setting-description error">{tMessage(server.error)}</span>}
      {tools.length > 0 && <details className="mcp-tools">
        <summary className="activity-summary"><ChevronRight size={13} aria-hidden="true" className="activity-chevron" />{tools.length === 1 ? t('1 công cụ') : t('{0} công cụ', [tools.length])}{server.omittedTools ? ` · ${t('bỏ qua {0}', [server.omittedTools])}` : ''}</summary>
        <ul>{tools.map(tool => <li key={tool.name}><code>{tool.name}</code>{tool.description && <span>{tool.description}</span>}</li>)}</ul>
      </details>}
    </div>
    <div className="setting-control">
      <Switch checked={server.enabled} disabled={busy} labelledBy={titleId} onChange={enabled => void act(async () => {
        await orglet.call('setMcpServerEnabled', { id: server.id, enabled });
        return enabled ? t('Đã bật {0}', [server.name]) : t('Đã tắt {0}', [server.name]);
      }, server.name)} />
      <RowMenu label={t('Tùy chọn {0}', [server.name])} items={[
        ...(server.enabled ? [{ label: t('Kiểm tra kết nối'), icon: RefreshCw, onSelect: test }] : []),
        { label: t('Sửa'), icon: Pencil, onSelect: onEdit },
        { label: t('Gỡ'), icon: Trash2, danger: true, confirm: { question: t('Gỡ {0}? Tí đang dùng máy chủ này sẽ không gọi được nó nữa.', [server.name]), label: t('Gỡ') }, onSelect: () => void act(async () => {
          await orglet.removeMcpServer(server.id);
          return t('Đã gỡ {0}', [server.name]);
        }, server.name) },
      ]} />
    </div>
  </div>;
}

/** A name and value row of the form; `saved` means main holds a value the window will never see. */
type Entry = { key: string; name: string; value: string; saved: boolean };

const newEntry = (): Entry => ({ key: crypto.randomUUID(), name: '', value: '', saved: false });

function initialEntries(server: McpServerView | undefined): Entry[] {
  if (!server) return [];
  const names = server.transport.kind === 'stdio' ? server.transport.envNames : server.transport.headerNames;
  return names.map(name => ({ key: crypto.randomUUID(), name, value: '', saved: true }));
}

/** The draft main receives: a saved entry left empty keeps its value, so nothing secret is ever read back. */
function draftOf(options: { server?: McpServerView; name: string; kind: 'stdio' | 'http'; command: string; args: string; url: string; entries: Entry[]; bearer: string; bearerRemoved: boolean }): McpServerDraft {
  const entries = options.entries.filter(entry => entry.name.trim()).map(entry => ({ name: entry.name.trim(), ...(entry.value ? { value: entry.value } : {}) }));
  const base = { ...(options.server ? { id: options.server.id } : {}), name: options.name.trim(), enabled: options.server?.enabled ?? true };
  if (options.kind === 'stdio') {
    const args = options.args.split('\n').map(line => line.trim()).filter(Boolean);
    return { ...base, transport: { kind: 'stdio', command: options.command.trim(), args, env: entries } };
  }
  const bearer = options.bearer ? { bearer: options.bearer } : options.bearerRemoved ? { bearer: null } : {};
  return { ...base, transport: { kind: 'http', url: options.url.trim(), headers: entries, ...bearer } };
}

function McpServerEditor({ server, onClose }: { server?: McpServerView; onClose: () => void }) {
  const [name, setName] = useState(server?.name ?? '');
  const [kind, setKind] = useState<'stdio' | 'http'>(server?.transport.kind ?? 'stdio');
  const [command, setCommand] = useState(server?.transport.kind === 'stdio' ? server.transport.command : '');
  const [args, setArgs] = useState(server?.transport.kind === 'stdio' ? server.transport.args.join('\n') : '');
  const [url, setUrl] = useState(server?.transport.kind === 'http' ? server.transport.url : '');
  const [entries, setEntries] = useState<Entry[]>(() => initialEntries(server));
  const savedBearer = server?.transport.kind === 'http' && server.transport.bearer;
  const [bearer, setBearer] = useState('');
  const [bearerRemoved, setBearerRemoved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const changeKind = (next: 'stdio' | 'http') => {
    setKind(next);
    // Variables and headers are different things, so switching kind starts that list over.
    setEntries(next === server?.transport.kind ? initialEntries(server) : []);
  };
  const updateEntry = (key: string, patch: Partial<Entry>) => setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...patch } : entry));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const saved = await orglet.saveMcpServer(draftOf({ server, name, kind, command, args, url, entries, bearer, bearerRemoved }));
      onClose();
      // A new or changed server is tried at once, so the row says whether it works without another click.
      if (saved.enabled) void orglet.call('testMcpServer', { id: saved.id }).catch(() => undefined);
    } catch (err) {
      setError(tMessage((err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const entryLabel = kind === 'stdio' ? t('Biến môi trường') : t('Header');
  return <Drawer open onClose={onClose} title={server ? t('Sửa máy chủ MCP') : t('Máy chủ MCP mới')}
    description={t('Giá trị bí mật được mã hóa trên máy này và không hiện lại.')}>
    <form className="form mcp-form" onSubmit={event => void submit(event)}>
      <label><FieldLabel icon={Tag} required>{t('Tên')}</FieldLabel><Input value={name} onChange={event => setName(event.target.value)} maxLength={40} required placeholder={t('Ví dụ: GitHub')} /></label>
      <Select label={<FieldLabel icon={Server} required>{t('Cách kết nối')}</FieldLabel>} value={kind} onChange={value => changeKind(value as 'stdio' | 'http')} options={[
        { value: 'stdio', label: t('Chạy trên máy (stdio)'), icon: <SquareTerminal size={16} /> },
        { value: 'http', label: t('Từ xa (HTTP)'), icon: <Globe size={16} /> },
      ]} />
      {kind === 'stdio' && <>
        <label><FieldLabel icon={SquareTerminal} required>{t('Lệnh')}</FieldLabel><Input className="mcp-mono" value={command} onChange={event => setCommand(event.target.value)} maxLength={1024} required spellCheck={false} placeholder="npx" /></label>
        <label><FieldLabel icon={ListTree}>{t('Tham số, mỗi dòng một tham số')}</FieldLabel><Textarea className="mcp-mono" rows={3} value={args} onChange={event => setArgs(event.target.value)} spellCheck={false} placeholder={'-y\n@modelcontextprotocol/server-everything'} /></label>
        <p className="muted">{t('Tham số hiện trong app. Đặt token vào biến môi trường, đừng đặt vào tham số.')}</p>
      </>}
      {kind === 'http' && <>
        <label><FieldLabel icon={Globe} required>{t('Địa chỉ')}</FieldLabel><Input className="mcp-mono" value={url} onChange={event => setUrl(event.target.value)} maxLength={2048} required spellCheck={false} placeholder="https://example.com/mcp" /></label>
        <label><FieldLabel icon={KeyRound}>{t('Bearer token')}</FieldLabel>
          <span className="mcp-secret">
            <Input type="password" autoComplete="off" spellCheck={false} value={bearer} onChange={event => { setBearer(event.target.value); setBearerRemoved(false); }} placeholder={savedBearer && !bearerRemoved ? `${SAVED_MASK} ${t('nhập để thay')}` : t('Không bắt buộc')} />
            {savedBearer && !bearerRemoved && !bearer && <Button type="button" size="icon" variant="ghost" aria-label={t('Bỏ token')} title={t('Bỏ token')} onClick={() => setBearerRemoved(true)}><X size={15} /></Button>}
          </span>
        </label>
      </>}
      <fieldset className="mcp-entries">
        <legend><FieldLabel icon={Variable}>{entryLabel}</FieldLabel></legend>
        {entries.map(entry => <div key={entry.key} className="mcp-entry">
          <Input className="mcp-mono" aria-label={t('Tên')} value={entry.name} disabled={entry.saved} onChange={event => updateEntry(entry.key, { name: event.target.value })} spellCheck={false} placeholder={kind === 'stdio' ? 'GITHUB_TOKEN' : 'X-Api-Key'} />
          <Input type="password" aria-label={t('Giá trị của {0}', [entry.name || entryLabel])} autoComplete="off" spellCheck={false} value={entry.value} onChange={event => updateEntry(entry.key, { value: event.target.value })} placeholder={entry.saved ? `${SAVED_MASK} ${t('nhập để thay')}` : t('Giá trị')} />
          <Button type="button" size="icon" variant="ghost" aria-label={t('Bỏ {0}', [entry.name || entryLabel])} onClick={() => setEntries(current => current.filter(item => item.key !== entry.key))}><X size={15} /></Button>
        </div>)}
        <Button type="button" variant="outline" onClick={() => setEntries(current => [...current, newEntry()])}><Plus size={15} />{kind === 'stdio' ? t('Thêm biến') : t('Thêm header')}</Button>
      </fieldset>
      <div className="sticky-actions">
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Hủy')}</Button>
        <Button variant="primary" disabled={busy}>{t('Lưu máy chủ')}</Button>
      </div>
    </form>
  </Drawer>;
}
