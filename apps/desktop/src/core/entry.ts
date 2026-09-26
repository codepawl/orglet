import { basename, join } from 'node:path';
import { z } from 'zod';
import { Store } from './storage/database';
import { CoreService, localHarnessRuntime } from './service';
import { OpenAIAdapter } from './adapters/openai';
import { AnthropicAdapter } from './adapters/anthropic';
import { OpenCodeAdapter } from './adapters/opencode';
import { API_PROVIDER_NAMES, ApiProvider, CredentialProvider, Id, type Command } from '../shared/contracts';
import { isCustomProvider } from '../shared/custom-connections';
import { customConnectionAdapter } from './adapters/custom';
import { CATALOG_HINT_IDS } from '../shared/models';
import { MODEL_LIST_ENDPOINTS } from './models/fetch';
import { DatasetProfile, type ProfileExecutor } from '../shared/profiles';
import { WindowsSandbox } from './tools/sandbox';
import { WorkspaceFilesRuntime } from './tools/workspace-files-runtime';
import { WorkspaceIntegration } from './tools/workspace-integration';
import { WorkspaceRuntime } from './tools/workspace-runtime';
import { emptyMcpSecrets, McpSecrets } from '../shared/mcp';
import { pdfTextInWorker } from './tools/pdf-text';
import type { WebSearchKeyProvider } from '../shared/web-tools';
import type { BrowserHost } from '../shared/browser-host';
import { DesktopHelperProcess } from './tools/desktop-helper';

type ParentPort = { postMessage(message: unknown): void; on(event: 'message', callback: (event: { data: unknown }) => void): void };
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const pendingKeys = new Map<string, (key: string | null) => void>();
const requestKey = (provider: string) => new Promise<string | null>(resolve => {
  const requestId = crypto.randomUUID(); pendingKeys.set(requestId, resolve);
  port.postMessage({ type: 'key', id: requestId, provider });
  setTimeout(() => { if (pendingKeys.delete(requestId)) resolve(null); }, 5000).unref();
});
/** The saved web search key, asked of main right before a search goes out (COD-266); no answer means no key. */
const requestSearchKey = (provider: WebSearchKeyProvider) => new Promise<string | null>(resolve => {
  const requestId = crypto.randomUUID();
  pendingKeys.set(requestId, resolve);
  port.postMessage({ type: 'searchKey', id: requestId, provider });
  setTimeout(() => { if (pendingKeys.delete(requestId)) resolve(null); }, 5000).unref();
});
/**
 * An MCP server's secret values, asked of main when the server starts (COD-241). Main decrypts them with safeStorage;
 * a missing or unreadable answer is an empty set, and the server then says which value it lacks.
 */
const pendingMcpSecrets = new Map<string, (secrets: McpSecrets) => void>();
const requestMcpSecrets = (serverId: string) => new Promise<McpSecrets>(resolve => {
  const requestId = crypto.randomUUID();
  pendingMcpSecrets.set(requestId, resolve);
  port.postMessage({ type: 'mcpSecrets', id: requestId, serverId });
  setTimeout(() => { if (pendingMcpSecrets.delete(requestId)) resolve(emptyMcpSecrets()); }, 5000).unref();
});
/**
 * The browser host process belongs to main (COD-261); a browser step goes there and back through main. Stopping the
 * run aborts the signal, which sends the cancel after the request.
 */
const pendingBrowser = new Map<string, (reply: unknown) => void>();
const BrowserReply = z.object({ ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(2000).optional() });
const browserHost: BrowserHost = {
  request: (request, signal) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const abort = () => {
      if (!pendingBrowser.delete(requestId)) return;
      port.postMessage({ type: 'browserCancel', id: requestId });
      reject(signal.reason instanceof Error ? signal.reason : new Error('Đã dừng bước trình duyệt.'));
    };
    pendingBrowser.set(requestId, reply => {
      signal.removeEventListener('abort', abort);
      const parsed = BrowserReply.safeParse(reply);
      if (parsed.success && parsed.data.ok) resolve(parsed.data.value);
      else reject(new Error(parsed.success ? parsed.data.error ?? 'Trình duyệt gặp lỗi.' : 'Trình duyệt trả kết quả không hợp lệ.'));
    });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    port.postMessage({ type: 'browser', id: requestId, request });
  }),
};
/**
 * Desktop apps (COD-261, phase 2a) have a helper of their own, a Windows PowerShell process this core starts when a step
 * needs it and stops after a minute of nothing to do. Only Windows has one; elsewhere the control says so.
 */
const desktopHelper = process.platform === 'win32' ? new DesktopHelperProcess() : undefined;
const pendingProfiles = new Map<string, (reply: unknown) => void>();
const profile: ProfileExecutor = (input, signal) => new Promise((resolve, reject) => {
  const id = crypto.randomUUID();
  const abort = () => { port.postMessage({ type: 'profileCancel', id }); complete({ ok: false, error: 'Đã hủy checker.' }); };
  const timer = setTimeout(() => abort(), 25_000);
  const complete = (reply: unknown) => {
    if (!pendingProfiles.delete(id)) return;
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    const parsed = z.object({ ok: z.boolean(), value: DatasetProfile.optional(), error: z.string().optional() }).safeParse(reply);
    if (parsed.success && parsed.data.ok && parsed.data.value) resolve(parsed.data.value);
    else reject(new Error(parsed.success ? parsed.data.error ?? 'Checker gặp lỗi.' : 'Kết quả checker không hợp lệ.'));
  };
  pendingProfiles.set(id, complete);
  if (signal?.aborted) { abort(); return; }
  signal?.addEventListener('abort', abort, { once: true });
  port.postMessage({ type: 'profile', id, input });
});
const store = new Store(join(process.argv[2], 'orglet.sqlite'));
const runtimePaths = z.object({ sandboxExecutable: z.string(), helperPath: z.string(), integrationExecutable: z.string(), gitExecutable: z.string() })
  .strict().parse(JSON.parse(process.argv[3]));
const workspaceDirectory = join(process.argv[2], 'workspaces');
const workspaceFiles = new WorkspaceFilesRuntime({
  sandbox: new WindowsSandbox(runtimePaths.sandboxExecutable), helperPath: runtimePaths.helperPath,
  stateDirectory: workspaceDirectory, runtimeExecutable: process.execPath,
  gitExecutable: runtimePaths.gitExecutable,
});
const workspaceRuntime = new WorkspaceRuntime(store, workspaceFiles,
  new WorkspaceIntegration(store, runtimePaths.integrationExecutable, workspaceDirectory),
  () => port.postMessage({ type: 'changed' }), workspaceFiles);
const core = new CoreService(store, () => port.postMessage({ type: 'changed' }), async (provider, model) => {
  if (isCustomProvider(provider)) return customConnectionAdapter(store, provider, model, requestKey);
  const apiProvider = ApiProvider.safeParse(provider);
  if (!apiProvider.success) throw new Error('Provider chưa được hỗ trợ.');
  const key = await requestKey(provider);
  if (!key) throw new Error(`Chưa kết nối ${API_PROVIDER_NAMES[apiProvider.data]}. Mở Cài đặt để nhập API key.`);
  if (provider === 'anthropic') return new AnthropicAdapter(key, undefined, model);
  if (provider === 'xai') return new OpenAIAdapter(key, { baseURL: 'https://api.x.ai/v1', provider: 'xai', model });
  if (provider === 'openrouter') return new OpenAIAdapter(key, {
    baseURL: MODEL_LIST_ENDPOINTS.openrouter, provider: 'openrouter', model,
    defaultHeaders: { 'HTTP-Referer': 'https://github.com/codepawl/orglet', 'X-Title': 'Orglet' },
  });
  if (provider === 'opencode-zen' || provider === 'opencode-go') return new OpenCodeAdapter(provider, key, model);
  if (provider === 'ollama') return new OpenAIAdapter(key, { baseURL: `${MODEL_LIST_ENDPOINTS.ollama}/v1`, model: model || CATALOG_HINT_IDS.ollama });
  return new OpenAIAdapter(key, { model });
}, profile, undefined, localHarnessRuntime(join(process.argv[2], 'harness-accounts')), undefined, {
  readKey: provider => requestKey(provider),
}, workspaceRuntime, {
  readSecrets: requestMcpSecrets,
  // Main keeps each running server's process id and creation time, so quitting or a crash of this process still
  // stops them, and a reused id is never taken for one of them.
  onProcesses: processes => port.postMessage({ type: 'mcpProcesses', processes }),
  // Each PDF is read in a worker thread built next to this file, so one slow or hostile file cannot stall the core.
}, pdfTextInWorker(join(__dirname, 'pdf-text.js')), { readKey: requestSearchKey }, browserHost, desktopHelper, [basename(process.execPath).toLowerCase()]);
core.runner.onProgress = update => port.postMessage({ type: 'progress', update });
// Main draws the glow while an orglet controls a desktop app (COD-261); the core only says when and where. Main says
// once it is on screen, which a borrow waits for before its first input; no answer means the helper shows its own notice.
const overlayShown = new Map<string, () => void>();
const OVERLAY_SHOWN_WAIT_MS = 1_500;
if (desktopHelper) core.desktop.showOverlayWith(state => new Promise<boolean>(resolve => {
  const overlayId = crypto.randomUUID();
  const timer = setTimeout(() => {
    overlayShown.delete(overlayId);
    resolve(false);
  }, OVERLAY_SHOWN_WAIT_MS);
  overlayShown.set(overlayId, () => {
    clearTimeout(timer);
    overlayShown.delete(overlayId);
    resolve(true);
  });
  port.postMessage({ type: 'desktopOverlay', id: overlayId, state });
}));
/** What quitting stops besides this process: the MCP servers and the desktop helper. */
async function shutdownHelpers() {
  desktopHelper?.stop();
  await core.mcp.shutdown();
}
port.on('message', async ({ data }) => {
  const envelope = z.object({ id: z.string(), command: z.string(), args: z.unknown() }).safeParse(data);
  if (!envelope.success) return;
  const { id, command, args } = envelope.data;
  if (command === 'profileReply') { pendingProfiles.get(id)?.(args); return; }
  if (command === 'overlayShown') { overlayShown.get(String(args))?.(); return; }
  if (command === 'browserReply') {
    const complete = pendingBrowser.get(id);
    pendingBrowser.delete(id);
    complete?.(args);
    return;
  }
  if (command === 'keyReply') {
    pendingKeys.get(id)?.(typeof args === 'string' ? args : null); pendingKeys.delete(id); return;
  }
  if (command === 'mcpSecretsReply') {
    const secrets = McpSecrets.safeParse(args);
    pendingMcpSecrets.get(id)?.(secrets.success ? secrets.data : emptyMcpSecrets());
    pendingMcpSecrets.delete(id);
    return;
  }
  try {
    const value = command === 'importSources'
      ? await core.sources.import(z.array(z.string().min(1).max(32768)).max(20).parse(args))
      : command === 'importFolder' ? await core.sources.importFolder(z.string().min(1).max(32768).parse(args))
      : command === 'sourcePath' ? core.sourcePath(args)
      : command === 'grantWorkspace' ? await core.grantWorkspace(args)
      : command === 'runRoutine' ? await core.runRoutine(args)
      : command === 'exportArtifact' ? typeof args === 'string' ? core.exportMarkdown(Id.parse(args))
        : core.exportMarkdown(z.object({ id: Id, includeMessageLinks: z.literal(true) }).strict().parse(args).id, true)
      : command === 'feedbackText' ? core.feedbackText(Id.parse(args))
      : command === 'backupExport' ? core.backups.export()
      : command === 'backupPreview' ? core.backups.preview(z.string().parse(args))
      : command === 'backupRestore' ? core.backups.restore(Id.parse(args))
      : command === 'templateExport' ? core.templates.export(Id.parse(args))
      : command === 'templateImport' ? core.templates.import(z.string().parse(args))
      : command === 'skillImport' ? core.importSkill(args)
      : command === 'skillExport' ? core.exportSkill(Id.parse(args))
      : command === 'invalidateModelList' ? core.invalidateModelList(CredentialProvider.parse(args))
      // Only main sends these three: it has split the secret values off a server before saving it (COD-241).
      : command === 'saveMcpServer' ? await core.saveMcpServer(args)
      : command === 'removeMcpServer' ? await core.removeMcpServer(args)
      : command === 'shutdown' ? await shutdownHelpers()
      // Only main sends this: the person closed the Chrome window a run's tabs were in, which hands the browser back.
      : command === 'browserReleased' ? await core.browser.released(Id.parse(args))
      : await core.command(command as Command, args);
    port.postMessage({ id, ok: true, value });
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Dữ liệu không hợp lệ.' : error instanceof Error ? error.message : 'Core gặp lỗi.';
    port.postMessage({ id, ok: false, error: message });
  }
});
void core.tick();
setInterval(() => { void core.tick().catch(() => port.postMessage({ type: 'changed' })); }, 5000);
port.postMessage({ type: 'ready', sqliteVersion: store.sqliteVersion });
// Chats from before search covered every message are indexed now, a few at a time, behind the window (COD-267).
void core.chatSearch.backfill().catch(() => undefined);
