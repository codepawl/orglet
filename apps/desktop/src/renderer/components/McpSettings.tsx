import { useState, type FormEvent } from 'react';
import { ChevronRight, FileInput, Globe, KeyRound, ListTree, LogIn, Pencil, Plus, RefreshCw, Server, ShieldCheck, SquareTerminal, Tag, Trash2, Variable, X } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { McpServerDraft, McpServerStatus, McpServerView } from '../../shared/mcp';
import { catalogAppOf, catalogDraft, MCP_CATALOG, type McpCatalogApp } from '../../shared/mcp-catalog';
import { BrandMark } from './brandMarks';
import { Button, Drawer, FieldLabel } from './ui';
import { Select } from './Select';
import { Switch } from './Switch';
import { RowMenu } from './RowMenu';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { Input, Textarea } from '@codepawlhq/orglet-ui';
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
  if (status === 'signIn') return { label: t('Cần đăng nhập'), className: '', mark: { variant: 'asking', tone: 'accent' } };
  if (status === 'disabled') return { label: t('Đang tắt'), className: '', mark: { variant: 'empty', tone: 'muted' } };
  return { label: t('Chưa chạy'), className: '', mark: { variant: 'empty', tone: 'muted' } };
}

/** A real company's server shows that company's mark (owner, 2026-10-07); any other shows how it is reached. */
function serverMark(server: McpServerView) {
  if (server.transport.kind !== 'http') return <SquareTerminal size={18} />;
  const app = catalogAppOf(server.transport.url);
  return app ? <BrandMark brand={app} size={18} /> : <Globe size={18} />;
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
export type McpEditing = McpServerView | 'new' | { app: McpCatalogApp } | undefined;
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
  const added = (app: McpCatalogApp) => servers.some(server => server.transport.kind === 'http' && server.transport.url === app.url);
  const available = MCP_CATALOG.filter(app => !added(app));
  return <>
    <div role="region" aria-label={t('Máy chủ MCP')}>
      {!servers.length && <div className="setting-row"><div className="setting-text">
        <span className="setting-title">{t('Chưa có máy chủ MCP nào.')}</span>
        <span className="setting-description">{t('Kết nối một app bên dưới, thêm bằng tay, hoặc nhập từ một tệp JSON bạn chọn. Orglet không tự đọc cấu hình MCP của app khác.')}</span>
      </div></div>}
      {servers.map(server => <McpServerRow key={server.id} server={server} busy={busy} act={act} onEdit={() => onEdit(server)} />)}
    </div>
    {available.length > 0 && <div role="region" aria-label={t('Kết nối app')} className="mcp-catalog">
      <h3 className="settings-subheading">{t('Kết nối app')}</h3>
      {available.map(app => <McpCatalogRow key={app.id} app={app} busy={busy} act={act} onToken={() => onEdit({ app })} />)}
    </div>}
    {editing && <McpServerEditor {...editorTarget(editing)} onClose={() => onEdit(undefined)} />}
  </>;
}

function editorTarget(editing: Exclude<McpEditing, undefined>): { server?: McpServerView; app?: McpCatalogApp } {
  if (editing === 'new') return {};
  if ('app' in editing) return { app: editing.app };
  return { server: editing };
}

/**
 * Signs in to a server in the browser and says how it went. Main waits for the browser to come back, so this resolves
 * only once the person has finished (or gave up) there.
 */
async function signIn(server: Pick<McpServerView, 'id' | 'name'>) {
  const view = await orglet.signInMcpServer(server.id);
  if (view.status === 'error' || view.status === 'signIn') throw new Error(view.error ? tMessage(view.error) : t('Không kết nối được.'));
  return t('Đã kết nối {0}', [server.name]);
}

/** What each catalog app lets an orglet do, in the person's language. */
function appDescription(app: McpCatalogApp) {
  if (app.id === 'linear') return t('Đọc và tạo issue, dự án, bình luận.');
  if (app.id === 'notion') return t('Tìm, đọc và viết trang, cơ sở dữ liệu.');
  if (app.id === 'atlassian') return t('Jira và Confluence: issue, trang, tìm kiếm.');
  return t('Repo, issue, pull request, thông báo.');
}

/**
 * A sign-in waits for the browser, which can take a while: the row says so and offers to give up, instead of the
 * whole tab sitting disabled until the five-minute limit.
 */
function useSignIn(act: Act) {
  const [waitingFor, setWaitingFor] = useState<string>();
  const start = (name: string, serverOf: () => Promise<Pick<McpServerView, 'id' | 'name'>>) => void act(async () => {
    const server = await serverOf();
    setWaitingFor(server.id);
    try {
      return await signIn(server);
    } finally {
      setWaitingFor(undefined);
    }
  }, name);
  const cancel = waitingFor ? () => void orglet.cancelMcpSignIn(waitingFor) : undefined;
  return { start, cancel };
}

/** Shown in place of the row's controls while the browser is open for a sign-in. */
function SignInWaiting({ onCancel }: { onCancel: () => void }) {
  return <>
    <span className="setting-description">{t('Đang chờ trình duyệt…')}</span>
    <Button variant="ghost" onClick={onCancel}>{t('Hủy')}</Button>
  </>;
}

/** An app from the catalog that is not connected yet: one click signs in, or opens the form for its token. */
function McpCatalogRow({ app, busy, act, onToken }: { app: McpCatalogApp; busy: boolean; act: Act; onToken: () => void }) {
  const titleId = `mcp-app-${app.id}-title`;
  const { start, cancel } = useSignIn(act);
  const connect = () => {
    if (app.signIn === 'token') {
      onToken();
      return;
    }
    start(app.name, () => orglet.saveMcpServer(catalogDraft(app)));
  };
  return <div className="setting-row harness-row mcp-row">
    <span className="mcp-mark" aria-hidden="true"><BrandMark brand={app.id} size={18} /></span>
    <div className="setting-text">
      <span className="harness-head"><span id={titleId} className="setting-title">{app.name}</span></span>
      <span className="setting-description">{appDescription(app)}</span>
    </div>
    <div className="setting-control">
      {cancel ? <SignInWaiting onCancel={cancel} /> : <Button variant="outline" disabled={busy} aria-describedby={titleId} onClick={connect}>
        {app.signIn === 'browser' ? <LogIn size={15} /> : <KeyRound size={15} />}{app.signIn === 'browser' ? t('Đăng nhập') : t('Thêm token')}
      </Button>}
    </div>
  </div>;
}

function McpServerRow({ server, busy, act, onEdit }: { server: McpServerView; busy: boolean; act: Act; onEdit: () => void }) {
  const state = statusOf(server.status);
  const titleId = `mcp-${server.id}-title`;
  const browserSignIn = server.transport.kind === 'http' && server.transport.oauth === true;
  const { start, cancel } = useSignIn(act);
  const signInAgain = () => start(server.name, async () => server);
  const tools = server.tools ?? [];
  const test = () => void act(async () => {
    const view = await orglet.call('testMcpServer', { id: server.id });
    if (view.status === 'error' || view.status === 'signIn') throw new Error(view.error ? tMessage(view.error) : t('Không kết nối được.'));
    const toolCount = view.tools?.length ?? 0;
    return toolCount === 1 ? t('{0} có 1 công cụ', [server.name]) : t('{0} có {1} công cụ', [server.name, toolCount]);
  }, server.name);
  return <div className="setting-row harness-row mcp-row">
    <span className="mcp-mark" aria-hidden="true">{serverMark(server)}</span>
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
      {cancel && <SignInWaiting onCancel={cancel} />}
      {!cancel && server.enabled && server.status === 'signIn' && <Button variant="outline" disabled={busy} aria-describedby={titleId} onClick={signInAgain}><LogIn size={15} />{t('Đăng nhập')}</Button>}
      <Switch checked={server.enabled} disabled={busy} labelledBy={titleId} onChange={enabled => void act(async () => {
        await orglet.call('setMcpServerEnabled', { id: server.id, enabled });
        return enabled ? t('Đã bật {0}', [server.name]) : t('Đã tắt {0}', [server.name]);
      }, server.name)} />
      <RowMenu label={t('Tùy chọn {0}', [server.name])} items={[
        ...(server.enabled ? [{ label: t('Kiểm tra kết nối'), icon: RefreshCw, onSelect: test }] : []),
        ...(server.enabled && browserSignIn && server.status !== 'signIn' ? [{ label: t('Đăng nhập lại'), icon: LogIn, onSelect: signInAgain }] : []),
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
function draftOf(options: { server?: McpServerView; name: string; kind: 'stdio' | 'http'; command: string; args: string; url: string; entries: Entry[]; bearer: string; bearerRemoved: boolean; browserSignIn: boolean }): McpServerDraft {
  const entries = options.entries.filter(entry => entry.name.trim()).map(entry => ({ name: entry.name.trim(), ...(entry.value ? { value: entry.value } : {}) }));
  const base = { ...(options.server ? { id: options.server.id } : {}), name: options.name.trim(), enabled: options.server?.enabled ?? true };
  if (options.kind === 'stdio') {
    const args = options.args.split('\n').map(line => line.trim()).filter(Boolean);
    return { ...base, transport: { kind: 'stdio', command: options.command.trim(), args, env: entries } };
  }
  if (options.browserSignIn) return { ...base, transport: { kind: 'http', url: options.url.trim(), headers: entries, oauth: true } };
  const bearer = options.bearer ? { bearer: options.bearer } : options.bearerRemoved ? { bearer: null } : {};
  return { ...base, transport: { kind: 'http', url: options.url.trim(), headers: entries, ...bearer } };
}

function McpServerEditor({ server, app, onClose }: { server?: McpServerView; app?: McpCatalogApp; onClose: () => void }) {
  const [name, setName] = useState(server?.name ?? app?.name ?? '');
  const [kind, setKind] = useState<'stdio' | 'http'>(server?.transport.kind ?? (app ? 'http' : 'stdio'));
  const [command, setCommand] = useState(server?.transport.kind === 'stdio' ? server.transport.command : '');
  const [args, setArgs] = useState(server?.transport.kind === 'stdio' ? server.transport.args.join('\n') : '');
  const [url, setUrl] = useState(server?.transport.kind === 'http' ? server.transport.url : app?.url ?? '');
  const [browserSignIn, setBrowserSignIn] = useState(server?.transport.kind === 'http' ? server.transport.oauth === true : app?.signIn === 'browser');
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
      const saved = await orglet.saveMcpServer(draftOf({ server, name, kind, command, args, url, entries, bearer, bearerRemoved, browserSignIn }));
      onClose();
      // A new or changed server is tried at once, so the row says whether it works without another click; one that signs
      // in through the browser and has no sign-in yet says so on its row, with the button to start it.
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
        <Select label={<FieldLabel icon={ShieldCheck} required>{t('Xác thực')}</FieldLabel>} value={browserSignIn ? 'browser' : 'token'} onChange={value => setBrowserSignIn(value === 'browser')} options={[
          { value: 'token', label: t('Token hoặc header'), detail: t('Dán token dịch vụ cấp cho bạn'), icon: <KeyRound size={16} /> },
          { value: 'browser', label: t('Đăng nhập bằng trình duyệt'), detail: t('Dịch vụ hỗ trợ đăng nhập OAuth'), icon: <LogIn size={16} /> },
        ]} />
        {browserSignIn && <p className="muted">{t('Lưu xong, bấm Đăng nhập trên dòng của máy chủ. Token được mã hóa trên máy này.')}</p>}
        {!browserSignIn && <label><FieldLabel icon={KeyRound}>{t('Bearer token')}</FieldLabel>
          <span className="mcp-secret">
            <Input type="password" autoComplete="off" spellCheck={false} value={bearer} onChange={event => { setBearer(event.target.value); setBearerRemoved(false); }} placeholder={savedBearer && !bearerRemoved ? `${SAVED_MASK} ${t('nhập để thay')}` : t('Không bắt buộc')} />
            {savedBearer && !bearerRemoved && !bearer && <Button type="button" size="icon" variant="ghost" aria-label={t('Bỏ token')} title={t('Bỏ token')} onClick={() => setBearerRemoved(true)}><X size={15} /></Button>}
          </span>
        </label>}
        {app?.tokenPage && !browserSignIn && <p className="muted">{t('Tạo token tại {0}', [app.tokenPage])}</p>}
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
