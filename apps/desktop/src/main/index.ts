import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Notification, safeStorage, session, shell, utilityProcess } from 'electron';
import { basename, dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { translate, DEFAULT_LANGUAGE, type Language } from '../shared/i18n';
import { en, enGB } from '../shared/locales/en';
import { commands, Id, ApiProvider, CredentialProvider, type Connections, type Reply, type Command, type Workspace, TextFormat, type Source } from '../shared/contracts';
import { customProviderId, findCustomConnection, isCustomProvider } from '../shared/custom-connections';
import { PickWorkspace } from '../shared/workspace-access';
import { OPENCODE_DOCS_URLS } from '../shared/opencode';
import { markdownToPlain } from '../shared/plainText';
import { MEDIA_SOURCE_EXTENSIONS, TEXT_SOURCE_EXTENSIONS } from '../shared/source-kinds';
import { Credentials, OLLAMA_LOCAL_TOKEN } from './credentials';
import { readBoundedText, writeAtomicText } from './files';
import { readSkillDirectory, writeSkillDirectory } from './skill-files';
import { isViteDevRequest, preferLoopbackIpv4 } from './vite-dev-url';
import { executeProfile, cancelProfile, stopProfiles } from './profiler';
import { Updater } from './updater';
import { ChangelogFeed } from './changelog';
import { ABOUT_LINKS, AboutLink, installKind, updateFeedUrl, type AboutInfo, type UpdateEnvironment } from '../shared/updates';
import type { BackupSummary } from '../core/storage/backup';
import { translateMessage } from '../shared/i18n';
import type { CliInstallState, OpenChatTarget } from '../shared/cli';
import { cliEndpoint, type CliChat } from '../cli/protocol';
import { CliServer, createCliToken, writeCliToken } from './cli-server';
import { chatsOf, CliOperations } from './cli-operations';
import { CliPathInstaller, isKeptOffPath, keepOffPath } from './cli-path';
import { runSquirrelEvent, runUpdateExecutable, squirrelEventOf, type SquirrelEvent } from './squirrel-events';
import { McpSecretStore, stopProcessTrees } from './mcp-secrets';
import { WebSearchKeys } from './web-search-keys';
import { WebSearchKeyProvider } from '../shared/web-tools';
import type { ProcessIdentity } from '../core/tools/process-identity';
import { McpServerDraft, parseMcpImport, splitMcpDraft, type McpServerView } from '../shared/mcp';
import type { Incoming, SendToState } from '../shared/incoming';
import { LINK_SCHEME, parseLaunchArguments, resolveLinkChat, type LaunchRequest } from './launch-requests';
import { importSentFiles, isKeptOffSendTo, keepOffSendTo, SendToInstaller, SentFilesHandOff, type PathKind, type ShortcutFiles } from './send-to';
import { BackgroundNotice } from '../shared/background-notice';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
/** Set by vite.main.config.ts from the macOS signing flag at make time. */
declare const ORGLET_MACOS_SIGNED: boolean;
if (process.env.ORGLET_DATA_DIR && !app.isPackaged) app.setPath('userData', process.env.ORGLET_DATA_DIR);
// scripts/dev.ps1 points USERPROFILE at a flag folder for Forge; give the app and its child CLIs the real home back.
if (process.env.ORGLET_USERPROFILE && !app.isPackaged) { process.env.USERPROFILE = process.env.ORGLET_USERPROFILE; delete process.env.ORGLET_USERPROFILE; }
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let window: BrowserWindow;
let core: Electron.UtilityProcess;
let credentials: Credentials;
let mcpSecrets: McpSecretStore;
let webSearchKeys: WebSearchKeys;
/** The MCP server processes the core reports running, so they stop even when the core cannot stop them (COD-241). */
let mcpProcesses: ProcessIdentity[] = [];
let ready = false;
let updater: Updater;
let changelog: ChangelogFeed;
/**
 * How this build can update itself (COD-176). Squirrel.Windows keeps `Update.exe` one folder above the app folder
 * and Electron's updater drives that file, so its presence is what separates a Setup install from a ZIP unpacked
 * by hand; a dev run and a Linux build never update themselves.
 */
const updateEnvironment: UpdateEnvironment = {
  packaged: app.isPackaged,
  platform: process.platform,
  squirrelUpdater: app.isPackaged && process.platform === 'win32' && existsSync(resolve(process.execPath, '..', '..', 'Update.exe')),
  macosSigned: typeof ORGLET_MACOS_SIGNED === 'boolean' && ORGLET_MACOS_SIGNED,
};
function aboutInfo(): AboutInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    osRelease: osRelease(),
    arch: process.arch,
    install: installKind(updateEnvironment),
  };
}
function request(command: string, args: unknown): Promise<unknown> {
  if (!ready) return Promise.reject(new Error('Core chưa sẵn sàng. Khởi động lại app nếu lỗi vẫn còn.'));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Core không phản hồi.')); }, 30_000);
    pending.set(id, { resolve, reject, timer }); core.postMessage({ id, command, args });
  });
}
// Workspace language for native dialogs: read once when the core is ready, then updated whenever settings are saved.
let language: Language = DEFAULT_LANGUAGE;
const activeDictionary = () => language === 'en' ? en : language === 'en-GB' ? enGB : null;
const tr = (key: string, params?: readonly unknown[]) => translate(activeDictionary(), key, params);
let cliServer: CliServer | undefined;
/**
 * Brings the window forward for `orglet open`, and with a chat asks the renderer to show it. Windows may only flash
 * the taskbar button instead: it does not let a background process take the foreground.
 */
function showWindow(chat?: CliChat) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
  if (chat) window.webContents.send('orglet:open-chat', { kind: chat.kind, id: chat.id } satisfies OpenChatTarget);
}
/**
 * System notifications still on screen or in the notification centre. Electron drops the click handler of one
 * that is garbage collected, so each is held until it is clicked; only the newest few are kept.
 */
let shownNotifications: Notification[] = [];
const KEPT_NOTIFICATIONS = 20;
/**
 * A chat finished, failed or needs the person while they are in another app (COD-258). The window decides which
 * chats; this checks again that the window really is in the background, and a click brings it forward on that chat.
 * A Setup install gets its taskbar identity from Squirrel's shortcut, which Electron picks up by itself.
 */
function notifyInBackground(notice: BackgroundNotice): boolean {
  if (!window || window.isDestroyed() || window.isFocused()) return false;
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title: notice.title, body: notice.body });
  const forget = () => { shownNotifications = shownNotifications.filter(item => item !== notification); };
  notification.on('click', () => {
    forget();
    showWindow();
    if (window && !window.isDestroyed()) window.webContents.send('orglet:open-task', notice.taskId);
  });
  notification.on('failed', forget);
  shownNotifications = [...shownNotifications, notification].slice(-KEPT_NOTIFICATIONS);
  notification.show();
  return true;
}
/** The line protocol the `orglet` command talks to (COD-234), with a new token on every start. */
async function startCliServer(directory: string) {
  const token = createCliToken();
  await writeCliToken(directory, token);
  const translateForCli = (message: string) => translateMessage(activeDictionary(), message);
  const operations = new CliOperations({ request, version: () => app.getVersion(), open: showWindow, translate: translateForCli });
  cliServer = new CliServer({
    endpoint: cliEndpoint(directory),
    token,
    handle: (cliRequest, signal) => operations.run(cliRequest, signal),
    translate: translateForCli,
  });
  await cliServer.start();
}
/** Only a packaged Windows build edits PATH; the shim sits in a folder that survives updates. */
function cliInstaller(): CliPathInstaller | undefined {
  if (!app.isPackaged || process.platform !== 'win32') return undefined;
  const localAppData = process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local');
  return new CliPathInstaller(join(localAppData, 'Orglet', 'bin'), {
    executable: process.execPath,
    cliScript: join(process.resourcesPath, 'orglet-cli.cjs'),
    userData: app.getPath('userData'),
  });
}
function cliState(): CliInstallState {
  if (!app.isPackaged) return { mode: 'dev' };
  const installer = cliInstaller();
  if (installer) return { mode: 'windows', installed: installer.isInstalled() };
  return { mode: 'manual', command: `export PATH="$PATH:${join(process.resourcesPath, 'bin')}"` };
}
/**
 * What Explorer's Send to menu and `orglet://` links start (COD-246). A Setup install has the Squirrel stub one folder
 * above the `app-x.y.z` folder: its path never changes between updates, it starts the newest version with the same
 * arguments, and it is a windowed program, so no console flashes. Squirrel copies it there before it runs the install
 * hook. A ZIP copy has no stub and uses its own executable.
 */
function launcherPath(): string {
  if (!updateEnvironment.squirrelUpdater) return process.execPath;
  return resolve(process.execPath, '..', '..', basename(process.execPath));
}
/** Electron's own .lnk reader and writer; the shortcut logic itself is in send-to.ts. */
const electronShortcuts: ShortcutFiles = {
  read: path => {
    if (!existsSync(path)) return undefined;
    try {
      const link = shell.readShortcutLink(path);
      return { target: link.target, args: link.args ?? '', description: link.description ?? '', icon: link.icon ?? '' };
    } catch {
      return undefined;
    }
  },
  write: async (path, shortcut) => {
    await mkdir(dirname(path), { recursive: true });
    const written = shell.writeShortcutLink(path, 'create', { target: shortcut.target, args: shortcut.args, description: shortcut.description, icon: shortcut.icon, iconIndex: 0 });
    if (!written) throw new Error('Không tạo được lối tắt Gửi tới.');
  },
  remove: async path => { await rm(path, { force: true }); },
};
/** Only a packaged Windows build adds itself to Send to, in the person's own SendTo folder. */
function sendToInstaller(): SendToInstaller | undefined {
  if (!app.isPackaged || process.platform !== 'win32') return undefined;
  const sendToFolder = join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo');
  return new SendToInstaller(sendToFolder, launcherPath(), electronShortcuts);
}
function sendToState(): SendToState {
  const installer = sendToInstaller();
  if (!installer) return { mode: 'unavailable' };
  return { mode: 'windows', installed: installer.isInstalled() };
}
/**
 * The command Windows runs for a link is `"<stub>" -- "%1"`. The `--` ends Chromium's switches, so nothing in a link
 * can be read as one. Electron writes it under HKCU\Software\Classes\orglet and removes it only when the command
 * there is still this one, so another program's handler is never touched. A ZIP copy registers nothing: it has no
 * uninstall step to take it away again.
 */
const LINK_ARGUMENTS = ['--'];
async function registerLinks(): Promise<void> {
  if (!updateEnvironment.squirrelUpdater) return;
  app.setAsDefaultProtocolClient(LINK_SCHEME, launcherPath(), LINK_ARGUMENTS);
}
async function unregisterLinks(): Promise<void> {
  if (!updateEnvironment.squirrelUpdater) return;
  app.removeAsDefaultProtocolClient(LINK_SCHEME, launcherPath(), LINK_ARGUMENTS);
}
const sentFiles = new SentFilesHandOff();
/** What came from outside and waits for the window to take it. Links open in order; a newer Send to replaces an older one. */
let incomingQueue: Incoming[] = [];
const INCOMING_QUEUE_LIMIT = 10;
/** Starts that arrived while the app was still starting, handled once the core and the window are there. */
const launchesBeforeStart: (readonly string[])[] = [];
let started = false;
function queueIncoming(item: Incoming) {
  const withoutOlderFiles = item.kind === 'files' ? incomingQueue.filter(queued => queued.kind !== 'files') : incomingQueue;
  incomingQueue = [...withoutOlderFiles, item].slice(-INCOMING_QUEUE_LIMIT);
  if (window && !window.isDestroyed()) window.webContents.send('orglet:incoming');
}
async function incomingFor(launch: LaunchRequest): Promise<Incoming> {
  if (launch.kind === 'send-to') return sentFiles.offer(launch.paths);
  if (launch.kind === 'refused') return { kind: 'notice', message: launch.message };
  const workspace = await request('workspace', {}) as Workspace;
  const found = resolveLinkChat(launch.link.target, chatsOf(workspace));
  if (!found.ok) return { kind: 'notice', message: found.message };
  const chat = { kind: found.chat.kind, id: found.chat.id };
  if (launch.link.action === 'new' && launch.link.text) return { kind: 'chat', chat, text: launch.link.text };
  return { kind: 'chat', chat };
}
/** Files from Send to or a link, from a cold start or a second instance. */
async function receiveLaunch(argv: readonly string[], bringForward: boolean) {
  const launch = parseLaunchArguments(argv);
  if (bringForward) showWindow();
  if (!launch) return;
  try {
    queueIncoming(await incomingFor(launch));
  } catch (error) {
    console.warn('Orglet could not take what was sent to it:', error instanceof Error ? error.message : error);
  }
}
/** The arguments the second instance sent itself: `argv` in the event may be reordered and gain Chromium's switches. */
const ForwardedLaunch = z.object({ argv: z.array(z.string().max(32_768)).max(1_000) });
function forwardedArguments(additionalData: unknown, argv: string[]): readonly string[] {
  const forwarded = ForwardedLaunch.safeParse(additionalData);
  return forwarded.success ? forwarded.data.argv : argv;
}
async function pathKind(path: string): Promise<PathKind> {
  try {
    const status = await stat(path);
    if (status.isDirectory()) return 'folder';
    return status.isFile() ? 'file' : 'missing';
  } catch {
    return 'missing';
  }
}
async function importOneSentFile(path: string): Promise<Source> {
  const imported = await request('importSources', [path]) as Source[];
  return imported[0];
}
const spellCheckerDictionaries: Record<Language, string> = { vi: 'vi', en: 'en-US', 'en-GB': 'en-GB' };
/**
 * Point Chromium's spellchecker at the interface language. It keeps its own list and never reads the document's
 * `lang`, so left at the default it underlined every word of a Vietnamese message in the composer as a mistake
 * (user, 2026-09-20). macOS is skipped because the OS spellchecker owns the list there and detects the language
 * itself, and a language Chromium has no dictionary for is left alone rather than set to nothing.
 */
function useSpellCheckerLanguage(next: Language) {
  if (process.platform === 'darwin') return;
  const dictionary = spellCheckerDictionaries[next];
  if (!session.defaultSession.availableSpellCheckerLanguages.includes(dictionary)) return;
  session.defaultSession.setSpellCheckerLanguages([dictionary]);
}
async function start() {
  const directory = app.getPath('userData'); await mkdir(directory, { recursive: true });
  credentials = new Credentials(directory);
  mcpSecrets = new McpSecretStore(directory, safeStorage);
  webSearchKeys = new WebSearchKeys(directory, safeStorage);
  const workspaceRuntimePaths = app.isPackaged ? {
    sandboxExecutable: join(process.resourcesPath, 'wxc-exec.exe'),
    helperPath: join(process.resourcesPath, 'workspace-helper.cjs'),
    integrationExecutable: join(process.resourcesPath, 'WorkspaceIntegrate.exe'),
    gitExecutable: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
  } : {
    sandboxExecutable: join(app.getAppPath(), 'node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe'),
    helperPath: join(__dirname, 'workspace-helper.cjs'),
    integrationExecutable: join(app.getAppPath(), 'out/native-tools/WorkspaceIntegrate.exe'),
    gitExecutable: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
  };
  core = utilityProcess.fork(join(__dirname, 'core.js'), [directory, JSON.stringify(workspaceRuntimePaths)], { serviceName: 'Orglet Core', stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  // Do not forward provider errors/environment to renderer logs.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Core startup timed out.')), 15_000);
    core.on('message', async message => {
      if (message.type === 'ready') { ready = true; clearTimeout(timer); resolve(); return; }
      if (message.type === 'changed') { if (window && !window.isDestroyed()) window.webContents.send('orglet:changed'); return; }
      if (message.type === 'progress') {
        if (window && !window.isDestroyed()) window.webContents.send('orglet:progress', message.update);
        return;
      }
      if (message.type === 'key') {
        const provider = CredentialProvider.safeParse(message.provider);
        core.postMessage({ id: message.id, command: 'keyReply', args: provider.success ? await credentials.read(provider.data) : null }); return;
      }
      // The web search key for a search the core is about to send (COD-266); the answer rides the same reply as an API key.
      if (message.type === 'searchKey') {
        const provider = WebSearchKeyProvider.safeParse(message.provider);
        core.postMessage({ id: message.id, command: 'keyReply', args: provider.success ? await webSearchKeys.read(provider.data) : null });
        return;
      }
      if (message.type === 'mcpSecrets') {
        const serverId = Id.safeParse(message.serverId);
        core.postMessage({ id: message.id, command: 'mcpSecretsReply', args: serverId.success ? await mcpSecrets.read(serverId.data) : null });
        return;
      }
      if (message.type === 'mcpProcesses') {
        const ProcessEntry = z.object({ pid: z.number().int().positive(), startedAt: z.string().min(1).max(64) }).strict();
        mcpProcesses = z.array(ProcessEntry).max(64).catch([]).parse(message.processes);
        return;
      }
      if (message.type === 'profileCancel') { cancelProfile(message.id); return; }
      if (message.type === 'profile') {
        try { core.postMessage({ id: message.id, command: 'profileReply', args: { ok: true, value: await executeProfile(message.id, message.input) } }); }
        catch (error) { core.postMessage({ id: message.id, command: 'profileReply', args: { ok: false, error: error instanceof Error ? error.message : 'Checker gặp lỗi.' } }); }
        return;
      }
      const response = pending.get(message.id);
      if (response) { clearTimeout(response.timer); pending.delete(message.id); if (message.ok) response.resolve(message.value); else response.reject(new Error(message.error)); }
    });
    core.on('exit', () => {
      // A core that died leaves its MCP servers orphaned; they are stopped here instead.
      stopProcessTrees(mcpProcesses);
      mcpProcesses = [];
      ready = false; clearTimeout(timer); reject(new Error('Core exited before startup.'));
      for (const response of pending.values()) { clearTimeout(response.timer); response.reject(new Error('Core đã dừng. Lịch sử được giữ lại; khởi động lại app để phục hồi.')); }
      pending.clear(); if (window && !window.isDestroyed()) window.webContents.send('orglet:changed');
    });
  });
  const startupSettings = await request('workspace', {}).then(workspace => workspace as { language?: Language; autoUpdate?: boolean }).catch(() => ({} as { language?: Language; autoUpdate?: boolean }));
  language = startupSettings.language ?? DEFAULT_LANGUAGE;
  useSpellCheckerLanguage(language);
  updater = new Updater({
    engine: autoUpdater,
    environment: updateEnvironment,
    feedUrl: updateFeedUrl(process.platform, process.arch, app.getVersion()),
    firstRun: process.argv.includes('--squirrel-firstrun'),
    automatic: startupSettings.autoUpdate ?? true,
    onChange: state => { if (window && !window.isDestroyed()) window.webContents.send('orglet:update', state); },
  });
  changelog = new ChangelogFeed({ cacheFile: join(directory, 'changelog-cache.json') });
  const rendererRoot = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  const url = MAIN_WINDOW_VITE_DEV_SERVER_URL ? preferLoopbackIpv4(MAIN_WINDOW_VITE_DEV_SERVER_URL) : pathToFileURL(join(rendererRoot, 'index.html')).href;
  const expected = new URL(url);
  const devServer = MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL) : undefined;
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 740, minHeight: 600, title: 'Orglet', backgroundColor: '#ffffff', autoHideMenuBar: true, ...(app.isPackaged ? {} : { icon: join(process.cwd(), 'apps', 'desktop', 'assets', 'icon.ico') }), webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A mouse's side button over the page reaches the renderer as a mouse event; over the window frame, or from a
  // driver that sends the command itself, it arrives here as an app command instead (COD-202). Windows and Linux only.
  window.on('app-command', (_event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return;
    if (window && !window.isDestroyed()) window.webContents.send('orglet:navigate', command === 'browser-backward' ? 'back' : 'forward');
  });
  window.webContents.on('will-navigate', event => {
    try {
      const target = new URL(event.url);
      if (expected.protocol === 'file:') { if (target.href === expected.href) return; }
      else if (devServer ? isViteDevRequest(target, devServer) : target.origin === expected.origin) return;
    } catch { /* deny */ }
    event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const target = new URL(details.url);
      if (target.protocol === 'file:') {
        const within = relative(rendererRoot, fileURLToPath(target));
        callback({ cancel: within.startsWith('..') || isAbsolute(within) }); return;
      }
      if (devServer) { callback({ cancel: !isViteDevRequest(target, devServer) }); return; }
      callback({ cancel: !['data:', 'devtools:'].includes(target.protocol) });
    } catch { callback({ cancel: true }); }
  });
  const authorized = (event: Electron.IpcMainInvokeEvent) => {
    // The dev server URL has no trailing slash while the loaded page does, so compare origins; file: pages
    // share the opaque "null" origin, so the packaged build also pins the exact renderer file path.
    const frame = event.senderFrame ? new URL(event.senderFrame.url) : undefined;
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !frame) throw new Error('IPC sender không được phép.');
    const sameOrigin = devServer ? isViteDevRequest(frame, devServer) : frame.origin === expected.origin;
    if (!sameOrigin || (expected.protocol === 'file:' && frame.pathname !== expected.pathname)) throw new Error('IPC sender không được phép.');
  };
  function handle(channel: string, fn: (arg: unknown) => Promise<unknown>) {
    ipcMain.handle(channel, async (event, arg): Promise<Reply<unknown>> => {
      try { authorized(event); return { ok: true, value: await fn(arg) }; }
      catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'Dữ liệu không hợp lệ.' : error instanceof Error ? error.message : 'Không thể thực hiện thao tác.' }; }
    });
  }
  handle('orglet:command', async raw => {
    const envelope = z.object({ command: z.string(), args: z.unknown() }).parse(raw);
    // The renderer asked for a command this build does not know. That happens when the window hot-reloaded a newer
    // command list while main and the core kept the old one (a branch switch with the app open), so the message
    // names the command and says what puts the two back on one version (COD-174).
    if (!Object.hasOwn(commands, envelope.command)) throw new Error(`Bản Orglet đang chạy không có lệnh "${envelope.command}": giao diện và phần lõi đang khác phiên bản. Tải lại cửa sổ (Ctrl+R) hoặc khởi động lại app.`);
    const command = envelope.command as Command;
    const args = commands[command].parse(envelope.args);
    const result = await request(command, args);
    // The core forgot the connection; its key goes with it, so no secret is left behind that nothing points at.
    if (command === 'deleteCustomConnection') {
      await credentials.remove(customProviderId((args as { id: string }).id));
      if (window && !window.isDestroyed()) window.webContents.send('orglet:changed');
    }
    if (command === 'settings' && (args as { language?: Language }).language) {
      language = (args as { language: Language }).language;
      useSpellCheckerLanguage(language);
    }
    if (command === 'settings' && typeof (args as { autoUpdate?: boolean }).autoUpdate === 'boolean') updater.setAutomatic((args as { autoUpdate: boolean }).autoUpdate);
    return result;
  });
  handle('orglet:about', async () => aboutInfo());
  // The renderer names a link; the address comes from the allowlist, so nothing shown in the window can choose one.
  handle('orglet:open-link', async raw => { await shell.openExternal(ABOUT_LINKS[AboutLink.parse(raw)]); });
  handle('orglet:changelog', async raw => changelog.read(z.boolean().default(false).parse(raw)));
  handle('orglet:update-state', async () => updater.state);
  handle('orglet:check-for-updates', async () => updater.check());
  handle('orglet:install-update', async () => { updater.install(); });
  handle('orglet:pick', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn nguồn: text 256 KB; CSV, JSONL, Parquet 32 MB; ảnh 20 MB; âm thanh 50 MB; video, PDF 200 MB'), properties: ['openFile', 'multiSelections'], filters: [
      { name: 'Sources, datasets and media', extensions: [...TEXT_SOURCE_EXTENSIONS, ...MEDIA_SOURCE_EXTENSIONS] },
      { name: 'Sources and datasets', extensions: TEXT_SOURCE_EXTENSIONS },
      { name: 'Images, video, audio and PDF', extensions: MEDIA_SOURCE_EXTENSIONS },
    ] });
    return result.canceled ? [] : request('importSources', result.filePaths);
  });
  // The renderer names a source by id; the core checks the task owns it and is not revoked, then main opens it.
  handle('orglet:open-source', async raw => {
    const input = z.object({ taskId: Id, id: Id }).strict().parse(raw);
    const path = z.string().min(1).parse(await request('sourcePath', input));
    const failure = await shell.openPath(path);
    if (failure) throw new Error('Không mở được tệp bằng ứng dụng mặc định.');
  });
  /** Which API and web search keys are saved, never the keys. */
  const connectionStatus = async (): Promise<Connections> => ({ ...await credentials.status(), search: await webSearchKeys.status() });
  handle('orglet:connections', async () => connectionStatus());
  handle('orglet:pick-workspace', async raw => {
    const input = PickWorkspace.parse(raw);
    // A chat row must still be open before the picker shows; a chat with no row yet is checked when the folder is kept.
    if ('taskId' in input) await request('workspaceAccess', { taskId: input.taskId });
    // A routine's watched folder is read-only and says what it is for (COD-245); the core keeps its path.
    const watching = 'watch' in input;
    const title = watching ? tr('Chọn thư mục để lịch theo dõi: chỉ đọc')
      : input.permissions.includes('execute') ? tr('Chọn workspace: đọc, sửa file và chạy lệnh')
      : input.permissions.includes('write') ? tr('Chọn workspace: đọc và sửa file') : tr('Chọn workspace: chỉ đọc');
    const result = await dialog.showOpenDialog(window, {
      title, properties: ['openDirectory'],
      buttonLabel: watching ? tr('Theo dõi thư mục này') : tr('Cấp quyền workspace'),
    });
    return result.canceled ? null : request('grantWorkspace', { ...input, directory: result.filePaths[0] });
  });
  handle('orglet:pick-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn thư mục nguồn (tối đa 20 tệp, bỏ qua tệp không hỗ trợ)'), properties: ['openDirectory'] });
    return result.canceled ? { sources: [], skipped: [] } : request('importFolder', result.filePaths[0]);
  });
  // A connection lives in main, not core, so core never announces it; every open view reads connections on
  // orglet:changed, and without this one a Details panel opened before the connect kept its old state (COD-177).
  const announceConnections = () => {
    if (window && !window.isDestroyed()) window.webContents.send('orglet:changed');
    return connectionStatus();
  };
  /** A key is only kept for a custom connection the core still has, so a stale window cannot plant an orphan secret. */
  const assertCustomConnection = async (provider: CredentialProvider) => {
    if (!isCustomProvider(provider)) return;
    const workspace = await request('workspace', {}) as Workspace;
    if (!findCustomConnection(workspace.customConnections ?? [], provider)) throw new Error('Không tìm thấy kết nối này.');
  };
  handle('orglet:connect', async raw => {
    const body = z.object({ provider: CredentialProvider, key: z.string().min(1).max(500).optional() }).strict().parse(raw);
    await assertCustomConnection(body.provider);
    if (body.provider === 'ollama' && body.key === undefined) {
      await credentials.save('ollama', OLLAMA_LOCAL_TOKEN);
      await request('invalidateModelList', 'ollama').catch(() => {});
      return announceConnections();
    }
    if (body.key !== undefined) {
      await credentials.save(body.provider, body.key.trim());
      await request('invalidateModelList', body.provider).catch(() => {});
      return announceConnections();
    }
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn tệp .txt chỉ chứa API key — key được mã hóa bằng Windows'), properties: ['openFile'], filters: [{ name: 'API key text', extensions: ['txt'] }] });
    if (!result.canceled) {
      const file = await open(result.filePaths[0], 'r');
      try {
        if (!(await file.stat()).isFile() || (await file.stat()).size > 1024) throw new Error('Tệp API key không hợp lệ.');
        const buffer = Buffer.alloc(1025); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024) throw new Error('Tệp API key quá lớn.');
        await credentials.save(body.provider, buffer.subarray(0, bytesRead).toString('utf8').trim());
        buffer.fill(0);
        await request('invalidateModelList', body.provider).catch(() => {});
      } finally { await file.close(); }
    }
    return announceConnections();
  });
  handle('orglet:disconnect', async raw => {
    const provider = CredentialProvider.parse(raw);
    await credentials.remove(provider);
    await request('invalidateModelList', provider).catch(() => {});
    return announceConnections();
  });
  /** Web search keys (COD-266) stop here like the API keys; the window gets back only whether one is saved. */
  handle('orglet:web-search-key', async raw => {
    const body = z.object({ provider: WebSearchKeyProvider, key: z.string().min(1).max(500) }).strict().parse(raw);
    await webSearchKeys.save(body.provider, body.key.trim());
    return announceConnections();
  });
  handle('orglet:web-search-key-remove', async raw => {
    await webSearchKeys.remove(WebSearchKeyProvider.parse(raw));
    return announceConnections();
  });
  /**
   * MCP servers (COD-241). The form's secret values stop here: they are encrypted into main's store and the core
   * receives the server's shape with names only. A new server's values are dropped again if the core refuses it.
   */
  const saveMcpDraft = async (draft: McpServerDraft): Promise<McpServerView> => {
    const serverId = draft.id ?? randomUUID();
    const saved = draft.id ? await mcpSecrets.read(serverId) : { env: {}, headers: {} };
    const { config, secrets } = splitMcpDraft(draft, serverId, saved);
    await mcpSecrets.save(serverId, secrets);
    try {
      return await request('saveMcpServer', config) as McpServerView;
    } catch (error) {
      if (!draft.id) await mcpSecrets.remove(serverId);
      throw error;
    }
  };
  handle('orglet:mcp-save', async raw => saveMcpDraft(McpServerDraft.parse(raw)));
  handle('orglet:mcp-remove', async raw => {
    const serverId = Id.parse(raw);
    await request('removeMcpServer', serverId);
    await mcpSecrets.remove(serverId);
  });
  // Only a file the person picks here is read; Orglet never looks for another app's MCP settings on its own.
  handle('orglet:mcp-import', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Nhập máy chủ MCP từ tệp JSON'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    const { drafts, skipped } = parseMcpImport(await readBoundedText(result.filePaths[0], 1024 * 1024));
    const imported: string[] = [];
    for (const draft of drafts) {
      try {
        await saveMcpDraft(draft);
        imported.push(draft.name);
      } catch (error) {
        skipped.push({ name: draft.name, reason: error instanceof z.ZodError ? 'Dữ liệu không hợp lệ.' : error instanceof Error ? error.message : 'Không lưu được.' });
      }
    }
    return { imported, skipped };
  });
  handle('orglet:backup', async () => {
    const result = await dialog.showSaveDialog(window, { title: tr('Lưu bản sao lưu'), defaultPath: 'orglet-backup.json', filters: [{ name: 'Orglet backup', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeAtomicText(result.filePath, String(await request('backupExport', undefined)));
    return true;
  });
  handle('orglet:open-pricing', async raw => {
    const pricing = {
      openai: 'https://openai.com/api/pricing/',
      anthropic: 'https://www.anthropic.com/pricing#api',
      xai: 'https://docs.x.ai/developers/pricing',
      openrouter: 'https://openrouter.ai/models',
      'opencode-zen': OPENCODE_DOCS_URLS['opencode-zen'],
      'opencode-go': OPENCODE_DOCS_URLS['opencode-go'],
      ollama: 'https://ollama.com',
    } as const;
    await shell.openExternal(pricing[ApiProvider.parse(raw)]);
  });
  handle('orglet:restore', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn bản sao lưu Orglet'), properties: ['openFile'], filters: [{ name: 'Orglet backup', extensions: ['json'] }] });
    if (result.canceled) return false;
    const content = await readBoundedText(result.filePaths[0], 50 * 1024 * 1024);
    const summary = await request('backupPreview', content) as BackupSummary;
    const confirmation = await dialog.showMessageBox(window, { type: 'question', title: tr('Khôi phục bản sao lưu'), message: tr('Bổ sung các mục còn thiếu?'), detail: tr('Bản sao lưu chứa {0} Tí, {1} hội, {2} công việc và {3} báo cáo.\nDữ liệu, cài đặt và chi phí hiện tại được giữ lại. Nguồn khôi phục không được cấp quyền đọc; công việc đang chạy trong bản sao lưu sẽ chuyển sang gián đoạn.', [summary.workers, summary.teams, summary.tasks, summary.reports]), buttons: [tr('Hủy'), tr('Khôi phục')], defaultId: 0, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return false;
    await request('backupRestore', summary.token); return true;
  });
  handle('orglet:template-export', async raw => {
    const template = await request('templateExport', Id.parse(raw));
    const result = await dialog.showSaveDialog(window, { title: tr('Xuất template hội'), defaultPath: 'orglet-team.json', filters: [{ name: 'Orglet team template', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeAtomicText(result.filePath, String(template)); return true;
  });
  handle('orglet:template-import', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Nhập template hội'), properties: ['openFile'], filters: [{ name: 'Orglet team template', extensions: ['json'] }] });
    if (result.canceled) return null;
    return request('templateImport', await readBoundedText(result.filePaths[0], 2 * 1024 * 1024));
  });
  handle('orglet:skill-import', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn thư mục chứa SKILL.md (tối đa 1 MB)'), properties: ['openDirectory'] });
    if (result.canceled) return null;
    return request('skillImport', await readSkillDirectory(result.filePaths[0]));
  });
  handle('orglet:skill-export', async raw => {
    const content = await request('skillExport', Id.parse(raw));
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn nơi tạo thư mục skill mới'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return false;
    await writeSkillDirectory(result.filePaths[0], content); return true;
  });
  handle('orglet:copy-feedback', async raw => {
    const text = await request('feedbackText', Id.parse(raw));
    clipboard.writeText(z.string().min(1).max(8000).parse(text));
  });
  /**
   * Copying a string the renderer already has, such as a command shown in Settings. It cannot do this itself:
   * the window is served from `file://`, where Chromium refuses `navigator.clipboard.writeText` with
   * `NotAllowedError: Write permission denied`, and the `execCommand` fallback is deprecated. Electron's own
   * clipboard has no such restriction.
   */
  handle('orglet:copy-text', async raw => { clipboard.writeText(z.string().min(1).max(8000).parse(raw)); });
  const artifactText = async (raw: unknown, includeMessageLinks = false) => {
    const input = z.object({ id: Id, format: TextFormat.default('markdown') }).strict().parse(typeof raw === 'string' ? { id: raw } : raw);
    const markdown = String(await request('exportArtifact', includeMessageLinks ? { id: input.id, includeMessageLinks: true } : input.id));
    return { format: input.format, text: input.format === 'text' ? markdownToPlain(markdown) : markdown };
  };
  handle('orglet:export', async raw => {
    const { format, text } = await artifactText(raw, true);
    const result = await dialog.showSaveDialog(window, format === 'text'
      ? { defaultPath: 'orglet.txt', filters: [{ name: tr('Văn bản'), extensions: ['txt'] }] }
      : { defaultPath: 'orglet.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeAtomicText(result.filePath, text); return true;
  });
  handle('orglet:copy', async raw => { clipboard.writeText((await artifactText(raw)).text); });
  // The renderer says on or off; where the shim goes and what it points at are decided here.
  handle('orglet:cli-state', async () => cliState());
  handle('orglet:cli-path', async raw => {
    const enabled = z.boolean().parse(raw);
    const installer = cliInstaller();
    if (!installer) throw new Error('Chỉ bản cài trên Windows tự thêm lệnh orglet vào PATH.');
    // Recorded first, so an update that lands while this runs already knows the choice.
    await keepOffPath(app.getPath('userData'), !enabled);
    if (enabled) await installer.install();
    else await installer.remove();
    return cliState();
  });
  // What Explorer or a link sent (COD-246). The window takes the queue; files stay here as paths until it names a chat.
  handle('orglet:incoming', async () => {
    const taken = incomingQueue;
    incomingQueue = [];
    return taken;
  });
  handle('orglet:notify', async raw => notifyInBackground(BackgroundNotice.parse(raw)));
  handle('orglet:sent-files', async raw => {
    const id = z.string().uuid().parse(raw);
    const paths = sentFiles.take(id);
    if (!paths) throw new Error('Các tệp này không còn chờ nữa. Gửi lại từ Explorer.');
    return importSentFiles(paths, { kindOf: pathKind, importFile: importOneSentFile });
  });
  handle('orglet:drop-sent-files', async raw => { sentFiles.drop(z.string().uuid().parse(raw)); });
  handle('orglet:send-to-state', async () => sendToState());
  handle('orglet:send-to', async raw => {
    const enabled = z.boolean().parse(raw);
    const installer = sendToInstaller();
    if (!installer) throw new Error('Chỉ bản cài trên Windows mới thêm Orglet vào menu Gửi tới.');
    // Recorded first, so an update that lands while this runs already knows the choice.
    await keepOffSendTo(app.getPath('userData'), !enabled);
    if (enabled) await installer.install();
    else await installer.remove();
    return sendToState();
  });
  // The app works without its command line, so a pipe that cannot open does not stop the start.
  await startCliServer(directory).catch(error => console.warn('orglet CLI server did not start:', error instanceof Error ? error.message : error));
  void cliInstaller()?.refresh().catch(() => undefined);
  void sendToInstaller()?.refresh().catch(() => undefined);
  void registerLinks().catch(() => undefined);
  // Queued before the page loads: the window takes the queue as soon as it mounts.
  started = true;
  await receiveLaunch(process.argv, false);
  for (const argv of launchesBeforeStart.splice(0)) await receiveLaunch(argv, true);
  if (devServer) {
    // Forge can start Electron before Vite finishes the first renderer build, which leaves a blank window.
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(url)).ok) break; } catch { /* dev server not listening yet */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame) setTimeout(() => { if (!window.isDestroyed()) void window.loadURL(url); }, 500); });
  }
  try { await window.loadURL(url); }
  catch (error) {
    // Chromium reports ERR_ABORTED when a loopback alias is cancelled; did-fail-load retries the same URL.
    if (!devServer || !/ERR_ABORTED|-3/.test(error instanceof Error ? error.message : '')) throw error;
  }
  updater.start();
}
/**
 * Setup's install, update and uninstall steps (COD-235): the Start menu shortcuts, as before, the `orglet` command on
 * the user PATH and Orglet in Explorer's Send to menu, unless the person took either off in Settings, and the
 * `orglet://` links (COD-246). No window opens for these.
 */
function handleSquirrelEvent(event: SquirrelEvent) {
  const shortcutTarget = basename(process.execPath);
  const installer = cliInstaller();
  const sendTo = sendToInstaller();
  const userData = app.getPath('userData');
  const work = runSquirrelEvent(event, {
    createShortcuts: () => runUpdateExecutable(process.execPath, [`--createShortcut=${shortcutTarget}`]),
    removeShortcuts: () => runUpdateExecutable(process.execPath, [`--removeShortcut=${shortcutTarget}`]),
    putOnPath: async () => { await installer?.install(); },
    takeOffPath: async () => { await installer?.remove(); },
    keptOffPath: () => isKeptOffPath(userData),
    addSendTo: async () => { await sendTo?.install(); },
    removeSendTo: async () => { await sendTo?.remove(); },
    keptOffSendTo: () => isKeptOffSendTo(userData),
    registerLinks,
    unregisterLinks,
  });
  void work.finally(() => app.quit());
}
const squirrelEvent = squirrelEventOf(process.argv, process.platform);
if (squirrelEvent) handleSquirrelEvent(squirrelEvent);
// The second instance passes its own arguments along, untouched, for Send to and links to read (COD-246).
else if (!app.requestSingleInstanceLock({ argv: process.argv })) app.quit();
else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const forwarded = forwardedArguments(additionalData, argv);
    if (!started) {
      launchesBeforeStart.push(forwarded);
      return;
    }
    void receiveLaunch(forwarded, true);
  });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Orglet không thể khởi động', error instanceof Error ? error.message : 'Lỗi khởi động.'); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    // MCP servers run under the core (COD-241). The core is told first, so it closes the servers it holds while main
    // checks and stops the ones it reported; only a process still the one Orglet started is stopped here.
    if (ready) core?.postMessage({ id: randomUUID(), command: 'shutdown', args: undefined });
    ready = false; void cliServer?.close(); updater?.stop(); stopProfiles();
    stopProcessTrees(mcpProcesses);
    mcpProcesses = [];
    core?.kill();
  });
}
