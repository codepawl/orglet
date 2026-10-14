import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, LogIn, Pencil, Trash2, Unplug } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { ConnectorClientView, McpServerView } from '../../shared/mcp';
import { catalogDraft, GOOGLE_REDIRECT_URI, MCP_CATALOG, type McpCatalogApp } from '../../shared/mcp-catalog';
import { FieldError, Input } from '@codepawlhq/orglet-ui';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';
import { isBlank, useFieldErrors } from '../fieldErrors';
import { BrandMark } from './brandMarks';
import { confirmAction } from './confirm';
import { RowMenu } from './RowMenu';
import { StatusMark } from './StatusMark';
import { toast } from './toast';
import { Button, Drawer, FieldLabel } from './ui';
import { statusOf, SignInWaiting, useSignIn, type Act } from './McpSettings';

/** Stands in for a saved value the window never reads back. */
const SAVED_MASK = '••••••••';

/** What each service lets an orglet do, in the person's language. */
function appDescription(app: McpCatalogApp) {
  switch (app.id) {
    case 'googlesheets': return t('Đọc và sửa bảng tính.');
    case 'googledrive': return t('Tìm và đọc tệp trong Drive.');
    case 'gmail': return t('Đọc thư và soạn thư nháp.');
    case 'googlecalendar': return t('Xem lịch và giờ rảnh.');
    case 'googledocs': return t('Đọc và sửa tài liệu.');
    case 'googleslides': return t('Đọc và sửa bản trình bày.');
    case 'linear': return t('Đọc và tạo issue, dự án, bình luận.');
    case 'notion': return t('Tìm, đọc và viết trang, cơ sở dữ liệu.');
    case 'atlassian': return t('Jira và Confluence: issue, trang, tìm kiếm.');
    default: return t('Repo, issue, pull request, thông báo.');
  }
}

const serverOf = (servers: readonly McpServerView[], app: McpCatalogApp) => servers.find(server => server.transport.kind === 'http' && server.transport.url === app.url);

/**
 * Settings → Connectors: the services an orglet can reach by signing in to them in the browser, each one an MCP server
 * made from a preset. Connect saves the server and signs in; a connected service is an ordinary row in Settings → MCP,
 * with the same per-orglet choice and approval for every call. The Google services need an OAuth client the person
 * made in Google Cloud, entered once for all six.
 */
export function ConnectorsSettings({ workspace, busy, act, onToken }: { workspace: Workspace; busy: boolean; act: Act; onToken: (app: McpCatalogApp) => void }) {
  const servers = workspace.mcpServers ?? [];
  const { start, cancel } = useSignIn(act);
  const [connecting, setConnecting] = useState<string>();
  const [googleClient, setGoogleClient] = useState<ConnectorClientView | null>();
  const [clientForm, setClientForm] = useState<{ app?: McpCatalogApp }>();
  useEffect(() => {
    void orglet.connectorClient('google').then(setGoogleClient, () => setGoogleClient(null));
  }, []);
  const beginSignIn = (app: McpCatalogApp) => {
    setConnecting(app.id);
    start(app.name, () => orglet.saveMcpServer(catalogDraft(app)));
  };
  const connect = (app: McpCatalogApp) => {
    if (app.signIn === 'token') {
      onToken(app);
      return;
    }
    if (app.signIn === 'google' && !googleClient) {
      setClientForm({ app });
      return;
    }
    beginSignIn(app);
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
  const saved = async (nextApp?: McpCatalogApp) => {
    setGoogleClient(await orglet.connectorClient('google'));
    setClientForm(undefined);
    // The client was just saved, so `connect` would still see the old state: go straight to the sign-in.
    if (nextApp) beginSignIn(nextApp);
  };
  const removeClient = () => void act(async () => {
    await orglet.saveConnectorClient('google', null);
    setGoogleClient(null);
    return t('Đã xóa OAuth client của Google');
  }, 'Google');
  const row = (app: McpCatalogApp) => <ConnectorRow key={app.id} app={app} server={serverOf(servers, app)} busy={busy}
    waiting={Boolean(cancel) && connecting === app.id} onCancel={cancel} onConnect={() => connect(app)}
    onSignIn={server => signInAgain(app, server)} onDisconnect={server => disconnect(app, server)} />;
  const google = MCP_CATALOG.filter(app => app.signIn === 'google');
  const others = MCP_CATALOG.filter(app => app.signIn !== 'google');
  return <>
    <div role="region" aria-label={t('Google Workspace')} className="connectors-group">
      <h3 className="settings-subheading">{t('Google Workspace')}</h3>
      <div className="setting-row harness-row mcp-row connector-client-row">
        <span className="mcp-mark" aria-hidden="true"><KeyRound size={18} /></span>
        <div className="setting-text">
          <span className="harness-head">
            <span id="connector-google-client-title" className="setting-title">{t('OAuth client của Google')}</span>
            {googleClient !== undefined && <span className={`status-pill ${googleClient ? 'logged_in' : ''}`}>
              <StatusMark variant={googleClient ? 'filled' : 'empty'} tone={googleClient ? 'success' : 'muted'} label={googleClient ? t('Đã lưu') : t('Chưa nhập')} decorative />{googleClient ? t('Đã lưu') : t('Chưa nhập')}
            </span>}
          </span>
          {googleClient
            ? <span className="setting-path">{googleClient.clientId}</span>
            : <span className="setting-description">{t('Tạo một lần trong Google Cloud, dùng cho cả sáu dịch vụ bên dưới.')}</span>}
        </div>
        <div className="setting-control">
          {googleClient === null && <Button variant="outline" disabled={busy} aria-describedby="connector-google-client-title" onClick={() => setClientForm({})}><KeyRound size={15} />{t('Nhập client')}</Button>}
          {googleClient && <RowMenu label={t('Tùy chọn OAuth client của Google')} items={[
            { label: t('Sửa'), icon: Pencil, onSelect: () => setClientForm({}) },
            { label: t('Xóa'), icon: Trash2, danger: true, confirm: { question: t('Xóa OAuth client của Google? Các dịch vụ đã kết nối vẫn chạy, nhưng đăng nhập lại cần nhập client mới.'), label: t('Xóa') }, onSelect: removeClient },
          ]} />}
        </div>
      </div>
      {google.map(row)}
    </div>
    <div role="region" aria-label={t('Dịch vụ khác')} className="connectors-group">
      <h3 className="settings-subheading">{t('Dịch vụ khác')}</h3>
      {others.map(row)}
    </div>
    {clientForm && <GoogleClientForm saved={googleClient ?? null} app={clientForm.app} onClose={() => setClientForm(undefined)} onSaved={() => void saved(clientForm.app)} />}
  </>;
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
function GoogleClientForm({ saved, app, onClose, onSaved }: { saved: ConnectorClientView | null; app?: McpCatalogApp; onClose: () => void; onSaved: () => void }) {
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
  return <Drawer open onClose={onClose} title={t('OAuth client của Google')}
    description={t('Làm một lần, dùng cho cả sáu dịch vụ Google. Mã bí mật được mã hóa trên máy này và không hiện lại.')}>
    <form className="form mcp-form" noValidate onSubmit={event => void submit(event)}>
      <ol className="connector-steps">
        <li>{t('Trong Google Cloud Console, tạo hoặc chọn một project.')}</li>
        <li>{t('Tham gia Google Workspace Developer Preview Program bằng tài khoản Google của bạn.')}</li>
        <li>{t('Trong Google Auth Platform, mục Audience, thêm email của bạn vào Test users.')}</li>
        <li>{t('Tạo OAuth client loại Web application và tick "Use this client for an AI-powered agent".')}</li>
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
        <Button variant="primary" disabled={busy}>{app ? t('Lưu và kết nối {0}', [app.name]) : t('Lưu client')}</Button>
      </div>
    </form>
  </Drawer>;
}
