import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, LogIn, Trash2, Unplug } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { ConnectorClientView, McpServerView } from '../../shared/mcp';
import { catalogDraft, GOOGLE_APPS, GOOGLE_REDIRECT_URI, MCP_CATALOG, type McpCatalogApp } from '../../shared/mcp-catalog';
import { FieldError, Input } from '@codepawlhq/orglet-ui';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';
import { isBlank, useFieldErrors } from '../fieldErrors';
import { BrandMark } from './brandMarks';
import { Checkbox } from './Checkbox';
import { confirmAction } from './confirm';
import { RowMenu } from './RowMenu';
import { StatusMark } from './StatusMark';
import { toast } from './toast';
import { Button, Drawer, FieldLabel } from './ui';
import { signIn, statusOf, SignInWaiting, useSignIn, type Act } from './McpSettings';

/** Stands in for a saved value the window never reads back. */
const SAVED_MASK = '••••••••';

/** The services behind the one Google row; product names, so they read the same in every language. */
const GOOGLE_SERVICES = 'Sheets · Drive · Docs · Slides · Calendar · Gmail';

/** What each service lets an orglet do, in the person's language. */
function appDescription(app: McpCatalogApp) {
  switch (app.id) {
    case 'linear': return t('Đọc và tạo issue, dự án, bình luận.');
    case 'notion': return t('Tìm, đọc và viết trang, cơ sở dữ liệu.');
    case 'atlassian': return t('Jira và Confluence: issue, trang, tìm kiếm.');
    default: return t('Repo, issue, pull request, thông báo.');
  }
}

const serverOf = (servers: readonly McpServerView[], app: McpCatalogApp) => servers.find(server => server.transport.kind === 'http' && server.transport.url === app.url);

/**
 * What the one Google row shows: the server that speaks for the six (the one in trouble if any is), and whether the
 * person has to sign in, which is also the case while one of the six has not been made yet.
 */
function googleSummary(servers: readonly McpServerView[]) {
  const priority = ['error', 'signIn', 'connecting', 'disabled'] as const;
  const speaking = priority.map(status => servers.find(server => server.status === status)).find(Boolean) ?? servers[0];
  const needsSignIn = servers.length < GOOGLE_APPS.length || servers.some(server => server.enabled && server.status === 'signIn');
  return { speaking, needsSignIn };
}

/**
 * Settings → Connectors: the services an orglet can reach by signing in to them in the browser, each one an MCP server
 * made from a preset. Connect saves the server and signs in; a connected service is an ordinary row in Settings → MCP,
 * with the same per-orglet choice and approval for every call. Google is one row for one built-in server of Orglet's own
 * Google tools: one consent, one question about which orglets may use it, one Disconnect. It signs in with CodePawl's Google client; a person's own
 * client is an option in the row's menu.
 */
export function ConnectorsSettings({ workspace, busy, act, onToken }: { workspace: Workspace; busy: boolean; act: Act; onToken: (app: McpCatalogApp) => void }) {
  const servers = workspace.mcpServers ?? [];
  const { start, cancel } = useSignIn(act);
  const [connecting, setConnecting] = useState<string>();
  const [googleWaitingFor, setGoogleWaitingFor] = useState<string>();
  const [grantQuestion, setGrantQuestion] = useState<string[]>();
  const [googleClient, setGoogleClient] = useState<ConnectorClientView | null>();
  const [clientFormOpen, setClientFormOpen] = useState(false);
  useEffect(() => {
    void orglet.connectorClient('google').then(setGoogleClient, () => setGoogleClient(null));
  }, []);
  const connect = (app: McpCatalogApp) => {
    if (app.signIn === 'token') {
      onToken(app);
      return;
    }
    setConnecting(app.id);
    start(app.name, () => orglet.saveMcpServer(catalogDraft(app)));
  };
  const signInAgain = (app: McpCatalogApp, server: McpServerView) => {
    setConnecting(app.id);
    start(app.name, async () => server);
  };
  const disconnect = (app: McpCatalogApp, server: McpServerView) => void act(async () => {
    const confirmed = await confirmAction({
      title: t('Ngắt kết nối {0}?', [app.name]),
      description: t('Tí đang dùng dịch vụ này sẽ không gọi được nữa. Đăng nhập lưu trên máy này bị xóa.'),
      confirmLabel: t('Ngắt kết nối'),
      tone: 'danger',
    });
    if (!confirmed) return;
    await orglet.removeMcpServer(server.id);
    return t('Đã ngắt kết nối {0}', [app.name]);
  }, app.name);
  // Makes the built-in Google server when the person does not have it yet, then signs in.
  const connectGoogle = () => void act(async () => {
    const ready: McpServerView[] = [];
    for (const app of GOOGLE_APPS) {
      const existing = serverOf(servers, app);
      ready.push(existing ?? await orglet.saveMcpServer(catalogDraft(app, undefined, { ownClient: Boolean(googleClient) })));
    }
    setGoogleWaitingFor(ready[0].id);
    try {
      await signIn({ id: ready[0].id, name: 'Google' });
    } finally {
      setGoogleWaitingFor(undefined);
    }
    setGrantQuestion(ready.map(server => server.id));
    return t('Đã kết nối {0}', ['Google']);
  }, 'Google');
  const disconnectGoogle = (googleServers: readonly McpServerView[]) => void act(async () => {
    const confirmed = await confirmAction({
      title: t('Ngắt kết nối {0}?', ['Google']),
      description: t('Tí đang dùng Google sẽ không gọi được nữa. Đăng nhập lưu trên máy này bị xóa.'),
      confirmLabel: t('Ngắt kết nối'),
      tone: 'danger',
    });
    if (!confirmed) return;
    for (const server of googleServers) await orglet.removeMcpServer(server.id);
    setGrantQuestion(undefined);
    return t('Đã ngắt kết nối {0}', ['Google']);
  }, 'Google');
  const removeClient = () => void act(async () => {
    await orglet.saveConnectorClient('google', null);
    setGoogleClient(null);
    return t('Đã bỏ OAuth client của bạn');
  }, 'Google');
  const row = (app: McpCatalogApp) => <ConnectorRow key={app.id} app={app} server={serverOf(servers, app)} busy={busy}
    waiting={Boolean(cancel) && connecting === app.id} onCancel={cancel} onConnect={() => connect(app)}
    onSignIn={server => signInAgain(app, server)} onDisconnect={server => disconnect(app, server)} />;
  const others = MCP_CATALOG.filter(app => app.signIn !== 'google');
  const googleServers = GOOGLE_APPS.flatMap(app => serverOf(servers, app) ?? []);
  const grantServerIds = (grantQuestion ?? []).filter(serverId => googleServers.some(server => server.id === serverId));
  const orglets = workspace.workers.filter(worker => !worker.unfriendedAt);
  return <>
    <div role="region" aria-label={t('Google')} className="connectors-group">
      <GoogleRow servers={googleServers} busy={busy} waiting={googleWaitingFor !== undefined} client={googleClient ?? null}
        onCancel={() => googleWaitingFor && void orglet.cancelMcpSignIn(googleWaitingFor)} onConnect={connectGoogle}
        onDisconnect={() => disconnectGoogle(googleServers)} onOwnClient={() => setClientFormOpen(true)} onRemoveClient={removeClient} />
      {grantServerIds.length > 0 && orglets.length > 0 && <GoogleGrantQuestion orglets={orglets} serverIds={grantServerIds} act={act} onDone={() => setGrantQuestion(undefined)} />}
    </div>
    <div role="region" aria-label={t('Dịch vụ khác')} className="connectors-group">
      <h3 className="settings-subheading">{t('Dịch vụ khác')}</h3>
      {others.map(row)}
    </div>
    {clientFormOpen && <GoogleClientForm saved={googleClient ?? null} onClose={() => setClientFormOpen(false)}
      onSaved={() => void orglet.connectorClient('google').then(client => { setGoogleClient(client); setClientFormOpen(false); })} />}
  </>;
}

/** The single row for Google: one button to connect, one to disconnect, and the own-client option tucked in the menu. */
function GoogleRow({ servers, busy, waiting, client, onCancel, onConnect, onDisconnect, onOwnClient, onRemoveClient }: {
  servers: readonly McpServerView[]; busy: boolean; waiting: boolean; client: ConnectorClientView | null; onCancel: () => void;
  onConnect: () => void; onDisconnect: () => void; onOwnClient: () => void; onRemoveClient: () => void;
}) {
  const { speaking, needsSignIn } = googleSummary(servers);
  const state = speaking ? statusOf(speaking.status) : undefined;
  const showState = Boolean(speaking) && (!needsSignIn || speaking?.status === 'error');
  return <div className="setting-row harness-row mcp-row connector-row" data-connector="google">
    <span className="mcp-mark" aria-hidden="true"><BrandMark brand="google" size={18} /></span>
    <div className="setting-text">
      <span className="harness-head">
        <span id="connector-google-title" className="setting-title">{t('Google')}</span>
        {state && showState && <span className={`status-pill ${state.className}`}><StatusMark variant={state.mark.variant} tone={state.mark.tone} label={state.label} decorative />{state.label}</span>}
      </span>
      {speaking?.status === 'error' && speaking.error
        ? <span className="setting-description error">{tMessage(speaking.error)}</span>
        : <span className="setting-description">{GOOGLE_SERVICES}</span>}
      {client && <span className="setting-path">{t('OAuth client của bạn: {0}', [client.clientId])}</span>}
    </div>
    <div className="setting-control">
      {waiting && <SignInWaiting onCancel={onCancel} />}
      {!waiting && needsSignIn && <Button variant="outline" disabled={busy} aria-describedby="connector-google-title" onClick={onConnect}>
        <LogIn size={15} />{servers.length ? t('Đăng nhập lại Google') : t('Kết nối Google')}
      </Button>}
      {!waiting && servers.length > 0 && <Button variant="ghost" disabled={busy} aria-describedby="connector-google-title" onClick={onDisconnect}><Unplug size={15} />{t('Ngắt kết nối')}</Button>}
      {!waiting && <RowMenu label={t('Tùy chọn Google')} items={[
        { label: client ? t('Sửa OAuth client của bạn') : t('Dùng OAuth client Google của bạn'), icon: KeyRound, onSelect: onOwnClient },
        ...(client ? [{ label: t('Dùng client của CodePawl'), icon: Trash2, confirm: { question: t('Bỏ OAuth client của bạn? Lần đăng nhập sau dùng client của CodePawl.'), label: t('Bỏ') }, onSelect: onRemoveClient }] : []),
      ]} />}
    </div>
  </div>;
}

/** Asked once, right after Google is connected: every orglet is ticked, and Done saves who may use the six services. */
function GoogleGrantQuestion({ orglets, serverIds, act, onDone }: { orglets: Workspace['workers']; serverIds: string[]; act: Act; onDone: () => void }) {
  const [picked, setPicked] = useState(() => new Set(orglets.map(item => item.id)));
  const toggle = (workerId: string, checked: boolean) => setPicked(current => {
    const next = new Set(current);
    if (checked) next.add(workerId);
    else next.delete(workerId);
    return next;
  });
  const done = () => void act(async () => {
    if (picked.size) await orglet.call('grantMcpServers', { workerIds: [...picked], serverIds });
    onDone();
    return picked.size ? t('Đã lưu: Tí được dùng Google') : undefined;
  }, 'Google');
  return <fieldset className="permissions mcp-picker connector-question" aria-describedby="connector-question-note">
    <legend className="permission-folder-title">{t('Tí nào được dùng Google?')}</legend>
    <p id="connector-question-note" className="muted permission-footnote">{t('Tí gọi được công cụ Google và hỏi bạn trước mỗi lần trong chat.')}</p>
    {orglets.map(item => <Checkbox key={item.id} checked={picked.has(item.id)} onChange={event => toggle(item.id, event.target.checked)}>{item.name}</Checkbox>)}
    <div className="sticky-actions"><Button variant="primary" onClick={done}>{t('Xong')}</Button></div>
  </fieldset>;
}

function ConnectorRow({ app, server, busy, waiting, onCancel, onConnect, onSignIn, onDisconnect }: {
  app: McpCatalogApp; server?: McpServerView; busy: boolean; waiting: boolean; onCancel?: () => void;
  onConnect: () => void; onSignIn: (server: McpServerView) => void; onDisconnect: (server: McpServerView) => void;
}) {
  const titleId = `connector-${app.id}-title`;
  const state = server ? statusOf(server.status) : undefined;
  const needsSignIn = server?.enabled && server.status === 'signIn';
  return <div className="setting-row harness-row mcp-row connector-row" data-connector={app.id}>
    <span className="mcp-mark" aria-hidden="true"><BrandMark brand={app.id} size={18} /></span>
    <div className="setting-text">
      <span className="harness-head">
        <span id={titleId} className="setting-title">{app.name}</span>
        {state && <span className={`status-pill ${state.className}`}><StatusMark variant={state.mark.variant} tone={state.mark.tone} label={state.label} decorative />{state.label}</span>}
      </span>
      {server?.status === 'error' && server.error
        ? <span className="setting-description error">{tMessage(server.error)}</span>
        : <span className="setting-description">{appDescription(app)}</span>}
    </div>
    <div className="setting-control">
      {waiting && onCancel && <SignInWaiting onCancel={onCancel} />}
      {!waiting && !server && <Button variant="outline" disabled={busy} aria-describedby={titleId} onClick={onConnect}>
        {app.signIn === 'token' ? <KeyRound size={15} /> : <LogIn size={15} />}{app.signIn === 'token' ? t('Thêm token') : t('Kết nối ngay')}
      </Button>}
      {!waiting && server && needsSignIn && <Button variant="outline" disabled={busy} aria-describedby={titleId} onClick={() => onSignIn(server)}><LogIn size={15} />{t('Đăng nhập')}</Button>}
      {!waiting && server && <Button variant="ghost" disabled={busy} aria-describedby={titleId} onClick={() => onDisconnect(server)}><Unplug size={15} />{t('Ngắt kết nối')}</Button>}
    </div>
  </div>;
}

/** The steps to make Google's OAuth client, with the exact redirect address to paste, and the two values it gives back. */
function GoogleClientForm({ saved, onClose, onSaved }: { saved: ConnectorClientView | null; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState(saved?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors('connector-google');
  const copyRedirect = async () => {
    try {
      await orglet.copyText(GOOGLE_REDIRECT_URI);
      toast(t('Đã sao chép'), 'success', GOOGLE_REDIRECT_URI);
    } catch {
      toast(t('Không sao chép được'), 'error', GOOGLE_REDIRECT_URI);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const idChanged = clientId.trim() !== saved?.clientId;
    const filled = fieldErrors.check(event.currentTarget as HTMLElement, [
      { field: 'clientId', failed: isBlank(clientId), message: t('Nhập Client ID.') },
      { field: 'clientSecret', failed: isBlank(clientSecret) && (!saved?.hasSecret || idChanged), message: t('Nhập Client secret.') },
    ]);
    if (!filled) return;
    setBusy(true);
    try {
      await orglet.saveConnectorClient('google', { clientId: clientId.trim(), ...(clientSecret ? { clientSecret } : {}) });
      onSaved();
    } catch (err) {
      setError(tMessage((err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return <Drawer open onClose={onClose} title={t('OAuth client Google của bạn')}
    description={t('Không bắt buộc: Orglet đã đăng nhập Google bằng client của CodePawl. Chỉ làm bước này nếu bạn muốn dùng project Google Cloud của riêng mình. Mã bí mật được mã hóa trên máy này và không hiện lại.')}>
    <form className="form mcp-form" noValidate onSubmit={event => void submit(event)}>
      <ol className="connector-steps">
        <li>{t('Trong Google Cloud Console, tạo hoặc chọn một project.')}</li>
        <li>{t('Trong APIs & Services, bật Google Sheets, Drive, Docs, Slides, Calendar và Gmail API.')}</li>
        <li>{t('Trong Google Auth Platform, mục Audience, thêm email của bạn vào Test users.')}</li>
        <li>{t('Tạo OAuth client loại Web application.')}</li>
        <li>{t('Thêm địa chỉ này vào Authorized redirect URIs, đúng từng ký tự:')}</li>
      </ol>
      <span className="mcp-secret">
        <Input className="mcp-mono" readOnly aria-label={t('Redirect URI')} value={GOOGLE_REDIRECT_URI} spellCheck={false} onFocus={event => event.currentTarget.select()} />
        <Button type="button" size="icon" variant="ghost" aria-label={t('Sao chép redirect URI')} onClick={() => void copyRedirect()}><Copy size={15} /></Button>
      </span>
      <p className="muted">{t('Rồi dán Client ID và Client secret mà Google cấp:')}</p>
      <label><FieldLabel icon={KeyRound} required>{t('Client ID')}</FieldLabel><Input className="mcp-mono" {...fieldErrors.props('clientId')} value={clientId} onChange={event => { setClientId(event.target.value); fieldErrors.clear('clientId'); }} maxLength={512} spellCheck={false} autoComplete="off" placeholder="123456-abc.apps.googleusercontent.com" />{fieldErrors.message('clientId')}</label>
      <label><FieldLabel icon={KeyRound} required>{t('Client secret')}</FieldLabel><Input type="password" {...fieldErrors.props('clientSecret')} autoComplete="off" spellCheck={false} value={clientSecret} onChange={event => { setClientSecret(event.target.value); fieldErrors.clear('clientSecret'); }} placeholder={saved?.hasSecret ? `${SAVED_MASK} ${t('nhập để thay')}` : t('Mã bí mật')} />{fieldErrors.message('clientSecret')}</label>
      <div className="sticky-actions">
        {error && <FieldError className="form-error">{error}</FieldError>}
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Hủy')}</Button>
        <Button variant="primary" disabled={busy}>{t('Lưu client')}</Button>
      </div>
    </form>
  </Drawer>;
}
