import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, utilityProcess } from 'electron';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { translate, DEFAULT_LANGUAGE, type Language } from '../shared/i18n';
import { en, enGB } from '../shared/locales/en';
import { commands, Id, ApiProvider, type Reply, type Command, TextFormat } from '../shared/contracts';
import { markdownToPlain } from '../shared/plainText';
import { Credentials, OLLAMA_LOCAL_TOKEN } from './credentials';
import { readBoundedText, writeAtomicText } from './files';
import { readSkillDirectory, writeSkillDirectory } from './skill-files';
import { isViteDevRequest, preferLoopbackIpv4 } from './vite-dev-url';
import squirrelStartup from 'electron-squirrel-startup';
import { executeProfile, cancelProfile, stopProfiles } from './profiler';
import type { BackupSummary } from '../core/storage/backup';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
if (process.env.ORGLET_DATA_DIR && !app.isPackaged) app.setPath('userData', process.env.ORGLET_DATA_DIR);
// scripts/dev.ps1 points USERPROFILE at a flag folder for Forge; give the app and its child CLIs the real home back.
if (process.env.ORGLET_USERPROFILE && !app.isPackaged) { process.env.USERPROFILE = process.env.ORGLET_USERPROFILE; delete process.env.ORGLET_USERPROFILE; }
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let window: BrowserWindow;
let core: Electron.UtilityProcess;
let credentials: Credentials;
let ready = false;
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
const tr = (key: string, params?: readonly unknown[]) => translate(language === 'en' ? en : language === 'en-GB' ? enGB : null, key, params);
async function start() {
  const directory = app.getPath('userData'); await mkdir(directory, { recursive: true });
  credentials = new Credentials(directory);
  core = utilityProcess.fork(join(__dirname, 'core.js'), [directory], { serviceName: 'Orglet Core', stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
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
        const provider = ApiProvider.safeParse(message.provider);
        core.postMessage({ id: message.id, command: 'keyReply', args: provider.success ? await credentials.read(provider.data) : null }); return;
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
      ready = false; clearTimeout(timer); reject(new Error('Core exited before startup.'));
      for (const response of pending.values()) { clearTimeout(response.timer); response.reject(new Error('Core đã dừng. Lịch sử được giữ lại; khởi động lại app để phục hồi.')); }
      pending.clear(); if (window && !window.isDestroyed()) window.webContents.send('orglet:changed');
    });
  });
  language = await request('workspace', {}).then(workspace => (workspace as { language?: Language }).language ?? DEFAULT_LANGUAGE).catch(() => DEFAULT_LANGUAGE);
  const rendererRoot = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  const url = MAIN_WINDOW_VITE_DEV_SERVER_URL ? preferLoopbackIpv4(MAIN_WINDOW_VITE_DEV_SERVER_URL) : pathToFileURL(join(rendererRoot, 'index.html')).href;
  const expected = new URL(url);
  const devServer = MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL) : undefined;
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 740, minHeight: 600, title: 'Orglet', backgroundColor: '#ffffff', autoHideMenuBar: true, ...(app.isPackaged ? {} : { icon: join(process.cwd(), 'apps', 'desktop', 'assets', 'icon.ico') }), webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
    if (!Object.hasOwn(commands, envelope.command)) throw new Error('Command không được phép.');
    const command = envelope.command as Command;
    const args = commands[command].parse(envelope.args);
    const result = await request(command, args);
    if (command === 'settings' && (args as { language?: Language }).language) language = (args as { language: Language }).language;
    return result;
  });
  handle('orglet:pick', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn nguồn: text 256 KB; CSV, JSONL, Parquet 32 MB mỗi tệp'), properties: ['openFile', 'multiSelections'], filters: [{ name: 'Sources and datasets', extensions: ['md', 'txt', 'json', 'jsonl', 'csv', 'parquet', 'ts', 'js', 'py', 'yaml', 'yml', 'log'] }] });
    return result.canceled ? [] : request('importSources', result.filePaths);
  });
  handle('orglet:connections', async () => credentials.status());
  handle('orglet:pick-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: tr('Chọn thư mục nguồn (tối đa 20 tệp, bỏ qua tệp không hỗ trợ)'), properties: ['openDirectory'] });
    return result.canceled ? { sources: [], skipped: [] } : request('importFolder', result.filePaths[0]);
  });
  handle('orglet:connect', async raw => {
    const body = z.object({ provider: ApiProvider, key: z.string().min(1).max(500).optional() }).strict().parse(raw);
    if (body.provider === 'ollama' && body.key === undefined) {
      await credentials.save('ollama', OLLAMA_LOCAL_TOKEN);
      await request('invalidateModelList', 'ollama').catch(() => {});
      return credentials.status();
    }
    if (body.key !== undefined) {
      await credentials.save(body.provider, body.key.trim());
      await request('invalidateModelList', body.provider).catch(() => {});
      return credentials.status();
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
    return credentials.status();
  });
  handle('orglet:disconnect', async raw => {
    const provider = ApiProvider.parse(raw);
    await credentials.remove(provider);
    await request('invalidateModelList', provider).catch(() => {});
    return credentials.status();
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
  const artifactText = async (raw: unknown) => {
    const input = z.object({ id: Id, format: TextFormat.default('markdown') }).strict().parse(typeof raw === 'string' ? { id: raw } : raw);
    const markdown = String(await request('exportArtifact', input.id));
    return { format: input.format, text: input.format === 'text' ? markdownToPlain(markdown) : markdown };
  };
  handle('orglet:export', async raw => {
    const { format, text } = await artifactText(raw);
    const result = await dialog.showSaveDialog(window, format === 'text'
      ? { defaultPath: 'orglet.txt', filters: [{ name: tr('Văn bản'), extensions: ['txt'] }] }
      : { defaultPath: 'orglet.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeAtomicText(result.filePath, text); return true;
  });
  handle('orglet:copy', async raw => { clipboard.writeText((await artifactText(raw)).text); });
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
}
if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Orglet không thể khởi động', error instanceof Error ? error.message : 'Lỗi khởi động.'); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { ready = false; stopProfiles(); core?.kill(); });
}
