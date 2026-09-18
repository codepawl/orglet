import { join } from 'node:path';
import { z } from 'zod';
import { Store } from './storage/database';
import { CoreService } from './service';
import { OpenAIAdapter } from './adapters/openai';
import { AnthropicAdapter } from './adapters/anthropic';
import { ApiProvider, Id, type Command } from '../shared/contracts';
import { CATALOG_HINT_IDS } from '../shared/models';
import { MODEL_LIST_ENDPOINTS } from './models/fetch';
import { DatasetProfile, type ProfileExecutor } from '../shared/profiles';

type ParentPort = { postMessage(message: unknown): void; on(event: 'message', callback: (event: { data: unknown }) => void): void };
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const pendingKeys = new Map<string, (key: string | null) => void>();
const requestKey = (provider: string) => new Promise<string | null>(resolve => {
  const requestId = crypto.randomUUID(); pendingKeys.set(requestId, resolve);
  port.postMessage({ type: 'key', id: requestId, provider });
  setTimeout(() => { if (pendingKeys.delete(requestId)) resolve(null); }, 5000).unref();
});
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
const core = new CoreService(store, () => port.postMessage({ type: 'changed' }), async (provider, model) => {
  if (!ApiProvider.safeParse(provider).success) throw new Error('Provider chưa được hỗ trợ.');
  const key = await requestKey(provider);
  if (!key) throw new Error(`Chưa kết nối ${provider}. Mở Cài đặt để nhập API key.`);
  if (provider === 'anthropic') return new AnthropicAdapter(key, undefined, model);
  if (provider === 'xai') return new OpenAIAdapter(key, { baseURL: 'https://api.x.ai/v1', provider: 'xai', model });
  if (provider === 'openrouter') return new OpenAIAdapter(key, {
    baseURL: MODEL_LIST_ENDPOINTS.openrouter, provider: 'openrouter', model,
    defaultHeaders: { 'HTTP-Referer': 'https://github.com/codepawl/orglet', 'X-Title': 'Orglet' },
  });
  if (provider === 'ollama') return new OpenAIAdapter(key, { baseURL: `${MODEL_LIST_ENDPOINTS.ollama}/v1`, model: model || CATALOG_HINT_IDS.ollama });
  return new OpenAIAdapter(key, { model });
}, profile, undefined, undefined, undefined, {
  readKey: provider => requestKey(provider),
});
core.runner.onProgress = update => port.postMessage({ type: 'progress', update });
port.on('message', async ({ data }) => {
  const envelope = z.object({ id: z.string(), command: z.string(), args: z.unknown() }).safeParse(data);
  if (!envelope.success) return;
  const { id, command, args } = envelope.data;
  if (command === 'profileReply') { pendingProfiles.get(id)?.(args); return; }
  if (command === 'keyReply') {
    pendingKeys.get(id)?.(typeof args === 'string' ? args : null); pendingKeys.delete(id); return;
  }
  try {
    const value = command === 'importSources'
      ? await core.sources.import(z.array(z.string().min(1).max(32768)).max(20).parse(args))
      : command === 'importFolder' ? await core.sources.importFolder(z.string().min(1).max(32768).parse(args))
      : command === 'exportArtifact' ? core.exportMarkdown(Id.parse(args))
      : command === 'feedbackText' ? core.feedbackText(Id.parse(args))
      : command === 'backupExport' ? core.backups.export()
      : command === 'backupPreview' ? core.backups.preview(z.string().parse(args))
      : command === 'backupRestore' ? core.backups.restore(Id.parse(args))
      : command === 'templateExport' ? core.templates.export(Id.parse(args))
      : command === 'templateImport' ? core.templates.import(z.string().parse(args))
      : command === 'skillImport' ? core.importSkill(args)
      : command === 'skillExport' ? core.exportSkill(Id.parse(args))
      : command === 'invalidateModelList' ? core.invalidateModelList(ApiProvider.parse(args))
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
