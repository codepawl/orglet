import { NativeEffort } from '../../shared/effort';
import { execFile } from 'node:child_process';
import { API_PROVIDER_NAMES, type ApiProvider, type CredentialProvider } from '../../shared/contracts';
import { isCustomProvider, type CustomConnection, type CustomProviderId } from '../../shared/custom-connections';
import {
  CATALOG_HINT_IDS,
  CustomModelId,
  hiddenOpenAIModel,
  MODEL_LIST_MAX,
  MODEL_LIST_TIMEOUT_MS,
  ModelEntry,
  type ModelListProvider,
  type ModelListRow,
  type ModelSource,
} from '../../shared/models';
import { modelCatalog, type CatalogProvider } from '../adapters/catalog';
import { cleanEnv, commandLine, harnessAccountEnv, type Probe } from '../harness/detect';
import { claudeAccessToken, codexAppServer, type CodexAppServer } from '../harness/usage';
import { harnessNames, type HarnessInfo } from '../../shared/harness';
import { OPENCODE_BASE_URLS, type OpenCodePlan } from '../../shared/opencode';
import { routerApiUrl } from '../../shared/router';
import { CLAUDE_CODE_ALIASES, claudeCodeEntries, claudeStartProbe, type ClaudeStartProbe } from './claudeCode';

export { CLAUDE_CODE_ALIASES };

export const MODEL_LIST_ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'opencode-zen': OPENCODE_BASE_URLS['opencode-zen'],
  'opencode-go': OPENCODE_BASE_URLS['opencode-go'],
  ollama: 'http://127.0.0.1:11434',
} as const;

/**
 * The model aliases Gemini CLI documents for `-m` (docs/cli/cli-reference.md, "Model aliases", checked against 0.61.0).
 * The CLI has no command that prints its model list, so these stand in for one the way Claude Code's aliases do; a
 * full model name such as gemini-2.5-pro still goes in the custom ID field.
 */
export const GEMINI_CLI_ALIASES: ReadonlyArray<{ id: string; displayName: string }> = [
  { id: 'auto', displayName: 'Auto' },
  { id: 'pro', displayName: 'Pro' },
  { id: 'flash', displayName: 'Flash' },
  { id: 'flash-lite', displayName: 'Flash-Lite' },
];

/** The router has no fixed address, so it is not in `MODEL_LIST_ENDPOINTS`; tests name a fake one here. */
export type ModelListEndpoints = Partial<Record<keyof typeof MODEL_LIST_ENDPOINTS | 'codepawl', string>>;

export type ModelListFetchOptions = {
  selectedOllamaModels?: () => string[];
  readKey: (provider: CredentialProvider) => Promise<string | null>;
  /** The saved connection behind a `custom:<id>` provider; the service reads it from settings. */
  customConnection?: (provider: CustomProviderId) => CustomConnection | undefined;
  fetch?: typeof fetch;
  endpoints?: ModelListEndpoints;
  probe?: Probe;
  harnesses: () => Promise<HarnessInfo[]>;
  timeoutMs?: number;
  now: () => Date;
} & HarnessListRuntime;

/** How the harness lists are read; tests put fakes here, the app uses the real CLIs. */
type HarnessListRuntime = {
  /** Which model Claude Code picks with an alias, or with none (its start line). */
  claudeStart?: ClaudeStartProbe;
  /** The account's Claude Code token, for the Models API names. */
  claudeToken?: (configDir: string | undefined) => Promise<string | undefined>;
  /** `codex app-server`, asked `model/list`. */
  appServer?: CodexAppServer;
};

/** Injected from core/entry (key IPC) and tests (HTTP/CLI fixtures). */
export type ModelListRuntime = {
  readKey?: (provider: CredentialProvider) => Promise<string | null>;
  fetch?: typeof fetch;
  endpoints?: ModelListEndpoints;
  probe?: Probe;
  timeoutMs?: number;
} & HarnessListRuntime;

const shapeError = 'Danh sách model không đúng định dạng. Vẫn có thể gõ ID tùy chỉnh.';
const timeoutError = 'Hết thời gian tải danh sách model. Vẫn có thể gõ ID tùy chỉnh.';
const httpError = (status: number) => `Không tải được danh sách model (${status}). Vẫn có thể gõ ID tùy chỉnh.`;
const missingKey = (provider: string) => `Chưa kết nối ${provider}. Vẫn có thể gõ ID model tùy chỉnh.`;
const missingHarness = (name: string) => `Chưa cài ${name} trên máy này. Vẫn có thể gõ ID model tùy chỉnh.`;
const signedOut = (name: string) => `Chưa đăng nhập ${name}. Vẫn có thể gõ ID model tùy chỉnh.`;

export function catalogHint(provider: ModelListProvider): ModelEntry | undefined {
  if (Object.hasOwn(CATALOG_HINT_IDS, provider)) {
    return { provider, id: CATALOG_HINT_IDS[provider as keyof typeof CATALOG_HINT_IDS], source: 'catalog-hint' };
  }
  if (!Object.hasOwn(modelCatalog, provider)) return undefined;
  const config = modelCatalog[provider as CatalogProvider];
  return { provider, id: config.model, source: 'catalog-hint' };
}

export function withCatalogHint(provider: ModelListProvider, models: ModelEntry[], source: ModelSource, error?: string): Pick<ModelListRow, 'models' | 'source' | 'error'> {
  const capped = models.slice(0, MODEL_LIST_MAX);
  if (capped.length) return error ? { models: capped, source, error } : { models: capped, source };
  const hint = catalogHint(provider);
  if (hint) return error ? { models: [hint], source: 'catalog-hint', error } : { models: [hint], source: 'catalog-hint' };
  return error ? { models: [], source, error } : { models: [], source };
}

function pickId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = CustomModelId.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function codexEffort(row: Record<string, unknown>) {
  if (!Array.isArray(row.supportedReasoningEfforts)) return {};
  const levels = [...new Set(row.supportedReasoningEfforts.flatMap(item => {
    const value = item && typeof item === 'object' ? (item as { reasoningEffort?: unknown }).reasoningEffort : item;
    const parsed = NativeEffort.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }))];
  return levels.length ? { effort: { levels } } : {};
}

function openRouterEffort(model: string, values: unknown) {
  if (model === 'openrouter/auto' || model === 'openrouter/free') return {};
  const allowed = NativeEffort.options.filter(level => level !== 'ultra');
  const levels = values === null ? allowed : Array.isArray(values) ? allowed.filter(level => values.includes(level)) : [];
  return levels.length ? { effort: { levels } } : {};
}

export function parseOllamaEffort(answer: unknown) {
  const values = answer && typeof answer === 'object' ? (answer as { thinking?: { values?: unknown } }).thinking?.values : undefined;
  if (!Array.isArray(values)) return undefined;
  // Named controls from /api/show; boolean on/off metadata cannot represent per-orglet effort.
  const levels = [...new Set(values.flatMap(value => {
    const parsed = NativeEffort.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }))];
  return levels.length ? { levels } : undefined;
}

function sunsetDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function xaiTenths(cents: unknown): number | undefined {
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0 || cents % 1000 !== 0) return undefined;
  const tenths = cents / 1000;
  return tenths <= 1_000_000 ? tenths : undefined;
}

/** An input-types field says images: a list with "image" in it, or OpenRouter's "text+image->text" before the arrow. */
function namesImage(modalities: unknown): boolean {
  if (Array.isArray(modalities)) return modalities.includes('image');
  if (typeof modalities === 'string') return modalities.split('->')[0].split('+').includes('image');
  return false;
}

/**
 * Whether a list row says the model takes images: xAI puts `input_modalities` on the row, OpenRouter puts it (or the
 * older `modality` string) under `architecture`. OpenAI's own list has neither, so its rows never carry the mark.
 */
function listsImageInput(row: { input_modalities?: unknown; architecture?: unknown }): boolean {
  if (namesImage(row.input_modalities)) return true;
  if (!row.architecture || typeof row.architecture !== 'object') return false;
  const architecture = row.architecture as { input_modalities?: unknown; modality?: unknown };
  return namesImage(architecture.input_modalities) || namesImage(architecture.modality);
}

/** OpenAI's `/v1/models` shape, which every OpenAI-compatible server copies; `provider` labels the rows. */
export function parseOpenAIModels(payload: unknown, provider: ModelListProvider = 'openai'): ModelEntry[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; shutdown_date?: unknown; input_modalities?: unknown; architecture?: unknown };
    const id = pickId(rec.id);
    if (!id || seen.has(id) || hiddenOpenAIModel(id)) continue;
    seen.add(id);
    const sunsetAt = sunsetDate(rec.shutdown_date);
    models.push({
      provider,
      id,
      source: 'native',
      ...(sunsetAt ? { deprecated: true as const, sunsetAt } : {}),
      ...(listsImageInput(rec) ? { imageInput: true as const } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

export function parseAnthropicModels(payload: unknown): { models: ModelEntry[]; hasMore: boolean; after?: string } {
  if (!payload || typeof payload !== 'object') throw new Error(shapeError);
  const body = payload as { data?: unknown; has_more?: unknown; last_id?: unknown };
  if (!Array.isArray(body.data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  for (const row of body.data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; display_name?: unknown; max_input_tokens?: unknown };
    const id = pickId(rec.id);
    if (!id) continue;
    const displayName = typeof rec.display_name === 'string' && rec.display_name.trim() ? rec.display_name.trim().slice(0, 200) : undefined;
    // The Models API names each model's context window as `max_input_tokens` (there is no `context_window` field), so a
    // model shows its size before any run has reported one.
    const contextTokens = contextTokensOf(rec.max_input_tokens);
    models.push({ provider: 'anthropic', id, source: 'native', ...(displayName ? { displayName } : {}), ...(contextTokens ? { contextTokens } : {}) });
  }
  const last = typeof body.last_id === 'string' ? body.last_id : undefined;
  return { models, hasMore: body.has_more === true && Boolean(last), after: last };
}

export function parseXaiLanguageModels(payload: unknown): ModelEntry[] {
  const rows = payload && typeof payload === 'object' ? (payload as { models?: unknown }).models : undefined;
  if (!Array.isArray(rows)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; aliases?: unknown; input_modalities?: unknown; output_modalities?: unknown; prompt_text_token_price?: unknown; completion_text_token_price?: unknown };
    const modalities = rec.output_modalities;
    if (!Array.isArray(modalities) || !modalities.includes('text')) continue;
    const id = pickId(rec.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const aliases = Array.isArray(rec.aliases)
      ? rec.aliases.flatMap(value => {
        const parsed = CustomModelId.safeParse(value);
        return parsed.success && parsed.data !== id ? [parsed.data] : [];
      }).slice(0, 50)
      : [];
    const inputTenths = xaiTenths(rec.prompt_text_token_price);
    const outputTenths = xaiTenths(rec.completion_text_token_price);
    models.push({
      provider: 'xai',
      id,
      source: 'native',
      ...(aliases.length ? { aliases } : {}),
      ...(inputTenths !== undefined ? { inputTenths } : {}),
      ...(outputTenths !== undefined ? { outputTenths } : {}),
      ...(listsImageInput(rec) ? { imageInput: true as const } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

function openrouterText(architecture: unknown): boolean {
  if (!architecture || typeof architecture !== 'object') return true;
  const rec = architecture as { output_modalities?: unknown; modality?: unknown };
  if (Array.isArray(rec.output_modalities)) return rec.output_modalities.includes('text');
  return typeof rec.modality !== 'string' || rec.modality.includes('text');
}

/** A context window as a provider gives it (OpenRouter's `context_length`, Anthropic's `max_input_tokens`): a whole number of tokens, or nothing (COD-326). */
function contextTokensOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 100_000_000) return undefined;
  return value;
}

function openrouterTenths(price: unknown): number | undefined {
  const n = typeof price === 'string' ? Number(price) : typeof price === 'number' ? price : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const tenths = Math.round(n * 10_000_000);
  return Number.isInteger(tenths) && tenths > 0 && tenths <= 1_000_000 ? tenths : undefined;
}

export function parseOpenRouterModels(payload: unknown): ModelEntry[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; name?: unknown; pricing?: unknown; architecture?: unknown; context_length?: unknown; supported_parameters?: unknown; reasoning?: { supported_efforts?: unknown } };
    if (!openrouterText(rec.architecture)) continue;
    const id = pickId(rec.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim().slice(0, 200) : undefined;
    const pricing = rec.pricing && typeof rec.pricing === 'object' ? rec.pricing as { prompt?: unknown; completion?: unknown } : undefined;
    const inputTenths = pricing ? openrouterTenths(pricing.prompt) : undefined;
    const outputTenths = pricing ? openrouterTenths(pricing.completion) : undefined;
    const contextTokens = contextTokensOf(rec.context_length);
    models.push({
      provider: 'openrouter',
      id,
      ...openRouterEffort(id, rec.reasoning?.supported_efforts),
      source: 'native',
      ...(displayName && displayName !== id ? { displayName } : {}),
      ...(inputTenths !== undefined ? { inputTenths } : {}),
      ...(outputTenths !== undefined ? { outputTenths } : {}),
      ...(listsImageInput(rec) ? { imageInput: true as const } : {}),
      ...(contextTokens ? { contextTokens } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

/**
 * OpenCode `/models` is an OpenAI-style list of IDs with no prices or endpoints. Every ID is kept so the picker can
 * show which ones this plan offers; whether Orglet can run one comes from the plan's docs (shared/opencode.ts).
 */
export function parseOpenCodeModels(plan: OpenCodePlan, payload: unknown): ModelEntry[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const id = pickId((row as { id?: unknown }).id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ provider: plan, id, source: 'native' });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

/**
 * The router's `GET /v1/models` is an OpenAI-style list; each row also says whether the model is free and its published
 * price. The app has no mark for a free model and the price is not one Orglet reserves against, so only the IDs are kept.
 */
export function parseCodepawlModels(payload: unknown): ModelEntry[] {
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const id = pickId((row as { id?: unknown }).id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ provider: 'codepawl', id, source: 'native' });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

export function parseOllamaTags(payload: unknown): ModelEntry[] {
  const rows = payload && typeof payload === 'object' ? (payload as { models?: unknown }).models : undefined;
  if (!Array.isArray(rows)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { name?: unknown; model?: unknown };
    const id = pickId(rec.name) ?? pickId(rec.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = id.endsWith(':latest') ? id.slice(0, -':latest'.length) : undefined;
    models.push({
      provider: 'ollama',
      id,
      source: 'native',
      ...(displayName && displayName !== id ? { displayName } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  return models;
}

function jsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || /^\s*</.test(trimmed) || /<!DOCTYPE/i.test(trimmed)) throw new Error(shapeError);
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(shapeError);
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new Error(shapeError);
    }
  }
}

export function parseCodexModels(text: string): ModelEntry[] {
  const parsed = jsonObject(text);
  const rows = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models) ? (parsed as { models: unknown[] }).models
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data) ? (parsed as { data: unknown[] }).data
    : null;
  if (!rows) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    // Models the CLI keeps out of its own picker (an internal reviewer, a reserve model) stay out of Orglet's too.
    if (rec.visibility === 'hide') continue;
    const id = pickId(rec.id) ?? pickId(rec.slug) ?? pickId(rec.model);
    if (!id) continue;
    const displayName = typeof rec.display_name === 'string' ? rec.display_name.trim().slice(0, 200)
      : typeof rec.displayName === 'string' ? rec.displayName.trim().slice(0, 200)
        : typeof rec.name === 'string' ? rec.name.trim().slice(0, 200) : '';
    const upgrade = rec.upgrade;
    const replacementId = typeof upgrade === 'string' ? pickId(upgrade)
      : upgrade && typeof upgrade === 'object' ? pickId((upgrade as { id?: unknown }).id) ?? pickId((upgrade as { slug?: unknown }).slug)
        : undefined;
    models.push({
      provider: 'codex',
      id,
      ...codexEffort(rec),
      source: 'native',
      ...(displayName ? { displayName } : {}),
      ...(replacementId && replacementId !== id ? { replacementId } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  if (rows.length > 0 && models.length === 0) throw new Error(shapeError);
  return models;
}

/**
 * `codex app-server`'s `model/list` answer (checked against codex-cli 0.157.0's generated protocol, `v2/Model.ts`):
 * the models its own picker shows, each with `displayName`, `upgrade` and `isDefault`, the catalog's default. That
 * default ignores the person's config.toml, as Orglet's runs do (`--ignore-user-config`).
 */
export function parseCodexModelList(answer: unknown): ModelEntry[] {
  const data = answer && typeof answer === 'object' ? (answer as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; model?: unknown; displayName?: unknown; upgrade?: unknown; hidden?: unknown; isDefault?: unknown; supportedReasoningEfforts?: unknown };
    if (rec.hidden === true) continue;
    const id = pickId(rec.model) ?? pickId(rec.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = typeof rec.displayName === 'string' ? rec.displayName.trim().slice(0, 200) : '';
    const replacementId = pickId(rec.upgrade);
    models.push({
      provider: 'codex',
      ...codexEffort(rec),
      id,
      source: 'native',
      ...(displayName ? { displayName } : {}),
      ...(replacementId && replacementId !== id ? { replacementId } : {}),
      ...(rec.isDefault === true ? { isDefault: true as const } : {}),
    });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  if (data.length > 0 && models.length === 0) throw new Error(shapeError);
  return models;
}

/** The colour codes Cursor Agent writes around each ID when its output looks like a terminal. */
const ANSI_COLOUR = /\u001b\[[0-9;]*m/g;
const CURSOR_LINE = /^(\S+)(?:\s+-\s+(.+?))?(?:\s+\(([a-z, ]+)\))?$/;
const CURSOR_MARKS = new Set(['current', 'default']);

/**
 * `agent --list-models` prints `id - Display Name`, then `(current, default)` after the model the CLI is set to and the
 * account's default (read from Cursor Agent 2026.09.18's own printer). A run without `--model` takes the current one,
 * so that row carries `isDefault`; the account's default does only when nothing is current.
 */
export function parseCursorModels(text: string): ModelEntry[] {
  if (/<!DOCTYPE/i.test(text) || /^\s*</.test(text.trim())) throw new Error(shapeError);
  const models: ModelEntry[] = [];
  const seen = new Set<string>();
  let current: string | undefined;
  let accountDefault: string | undefined;
  for (const line of text.replace(ANSI_COLOUR, '').split(/\r?\n/)) {
    const match = line.trim().match(CURSOR_LINE);
    if (!match) continue;
    const marks = match[3]?.split(',').map(mark => mark.trim()) ?? [];
    const marked = marks.length > 0 && marks.every(mark => CURSOR_MARKS.has(mark));
    // A model line has a name after " - ", or the CLI's own marks after a bare ID.
    if (!match[2] && !marked) continue;
    const name = marked ? match[2] : [match[2], match[3] ? `(${match[3]})` : ''].filter(Boolean).join(' ');
    const id = pickId(match[1]);
    const displayName = name?.trim().slice(0, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (marks.includes('current') && marked) current = id;
    if (marks.includes('default') && marked) accountDefault = id;
    models.push({ provider: 'cursor', id, source: 'native', ...(displayName ? { displayName } : {}) });
    if (models.length >= MODEL_LIST_MAX) break;
  }
  if (!models.length) throw new Error(shapeError);
  const runsWith = current ?? accountDefault;
  return models.map(entry => entry.id === runsWith ? { ...entry, isDefault: true as const } : entry);
}

export function claudeCodeModels(): ModelEntry[] {
  return CLAUDE_CODE_ALIASES.map(item => ({
    provider: 'claude-code' as const,
    id: item.id,
    displayName: item.displayName,
    aliases: [item.id],
    source: 'alias' as const,
  }));
}

export function geminiCliModels(): ModelEntry[] {
  return GEMINI_CLI_ALIASES.map(item => ({
    provider: 'gemini' as const,
    id: item.id,
    displayName: item.displayName,
    aliases: [item.id],
    source: 'alias' as const,
  }));
}

export function probeWithTimeout(timeoutMs: number): Probe {
  return (executable, args) => new Promise(resolve => {
    const command = commandLine(executable, args);
    execFile(command.file, command.args, {
      timeout: timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: command.verbatim,
      maxBuffer: 2 * 1024 * 1024,
      env: cleanEnv(process.env),
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function readJson(url: string, headers: Record<string, string>, options: { fetch: typeof fetch; timeoutMs: number }): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetch(url, { headers, signal: AbortSignal.timeout(options.timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error(timeoutError);
    throw new Error(httpError(0));
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/html')) throw new Error(shapeError);
  if (!response.ok) throw new Error(httpError(response.status));
  try {
    return await response.json();
  } catch {
    throw new Error(shapeError);
  }
}

function apiName(provider: ApiProvider) {
  return API_PROVIDER_NAMES[provider];
}

async function fetchOpenAI(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey('openai');
  if (!key) return withCatalogHint('openai', [], 'native', missingKey(apiName('openai')));
  const base = options.endpoints?.openai ?? MODEL_LIST_ENDPOINTS.openai;
  const payload = await readJson(`${base}/models`, { Authorization: `Bearer ${key}` }, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint('openai', parseOpenAIModels(payload), 'native');
}

async function fetchAnthropic(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey('anthropic');
  if (!key) return withCatalogHint('anthropic', [], 'native', missingKey(apiName('anthropic')));
  const models = await readAnthropicModels({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }, options);
  return withCatalogHint('anthropic', models, 'native');
}

/** Every page of Anthropic's `GET /v1/models`, with the key or token the caller put in the headers. */
async function readAnthropicModels(headers: Record<string, string>, options: ModelListFetchOptions): Promise<ModelEntry[]> {
  const base = options.endpoints?.anthropic ?? MODEL_LIST_ENDPOINTS.anthropic;
  const http = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS;
  const models: ModelEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20 && models.length < MODEL_LIST_MAX; page++) {
    const url = new URL(`${base}/models`);
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const parsed = parseAnthropicModels(await readJson(url.toString(), headers, { fetch: http, timeoutMs }));
    models.push(...parsed.models);
    if (!parsed.hasMore || !parsed.after) break;
    after = parsed.after;
  }
  return models;
}

async function fetchXai(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey('xai');
  if (!key) return withCatalogHint('xai', [], 'native', missingKey(apiName('xai')));
  const base = options.endpoints?.xai ?? MODEL_LIST_ENDPOINTS.xai;
  const payload = await readJson(`${base}/language-models`, { Authorization: `Bearer ${key}` }, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint('xai', parseXaiLanguageModels(payload), 'native');
}

async function fetchOpenRouter(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey('openrouter');
  if (!key) return withCatalogHint('openrouter', [], 'native', missingKey(apiName('openrouter')));
  const base = options.endpoints?.openrouter ?? MODEL_LIST_ENDPOINTS.openrouter;
  const payload = await readJson(`${base}/models`, { Authorization: `Bearer ${key}` }, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint('openrouter', parseOpenRouterModels(payload), 'native');
}

/** Each plan reads only its own key and its own endpoint; a missing Go key never falls back to Zen or the reverse. */
async function fetchOpenCode(plan: OpenCodePlan, options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey(plan);
  if (!key) return withCatalogHint(plan, [], 'native', missingKey(apiName(plan)));
  const base = options.endpoints?.[plan] ?? MODEL_LIST_ENDPOINTS[plan];
  const payload = await readJson(`${base}/models`, { Authorization: `Bearer ${key}` }, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint(plan, parseOpenCodeModels(plan, payload), 'native');
}

/** Reads only the router's own key, from the address this build names; a build with none has no list to fetch. */
async function fetchCodepawl(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const base = options.endpoints?.codepawl ?? routerApiUrl(process.env.ORGLET_ROUTER_URL);
  if (!base) return withCatalogHint('codepawl', [], 'native', 'Bản này không có CodePawl router.');
  const key = await options.readKey('codepawl');
  if (!key) return withCatalogHint('codepawl', [], 'native', missingKey(apiName('codepawl')));
  const payload = await readJson(`${base}/models`, { Authorization: `Bearer ${key}` }, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint('codepawl', parseCodepawlModels(payload), 'native');
}

async function fetchOllama(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const key = await options.readKey('ollama');
  if (!key) return withCatalogHint('ollama', [], 'native', missingKey(apiName('ollama')));
  const base = options.endpoints?.ollama ?? MODEL_LIST_ENDPOINTS.ollama;
  const payload = await readJson(`${base}/api/tags`, {}, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  const models = parseOllamaTags(payload);
  const selected = new Set((options.selectedOllamaModels?.() ?? []).slice(0, 20));
  await Promise.all(models.filter(model => selected.has(model.id) || selected.has(model.id.replace(/:latest$/, ''))).map(async model => {
    try {
      const response = await (options.fetch ?? fetch)(base + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.id }), signal: AbortSignal.timeout(options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS) });
      if (response.ok) model.effort = parseOllamaEffort(await response.json());
    } catch { /* The model remains usable without known effort support. */ }
  }));
  return withCatalogHint('ollama', models, 'native');
}

const missingConnection = 'Kết nối tùy chỉnh này không còn. Vẫn có thể gõ ID model tùy chỉnh.';

/**
 * A custom connection lists what its own server says under `{baseUrl}/models`, with its key when it has one and no
 * Authorization header when it does not. The OpenAI display filter hides embedding and speech IDs the same way.
 */
async function fetchCustomConnection(provider: CustomProviderId, options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const connection = options.customConnection?.(provider);
  if (!connection) return withCatalogHint(provider, [], 'native', missingConnection);
  const key = await options.readKey(provider);
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const payload = await readJson(`${connection.baseUrl}/models`, headers, { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS });
  return withCatalogHint(provider, parseOpenAIModels(payload, provider), 'native');
}

function harnessOf(list: HarnessInfo[], id: 'claude-code' | 'codex' | 'cursor') {
  return list.find(item => item.id === id);
}

/** How soon a Claude Code list that learned nothing is fetched again (COD-338). */
export const CLAUDE_CODE_RETRY_MS = 10 * 60 * 1000;

/** The header Claude Code's own calls send with its sign-in token (the same one `usage.ts` sends to read the plan). */
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

/** The models the Claude Code account may use, with Anthropic's display names; undefined without a readable token. */
async function readClaudeCodeNames(configDir: string | undefined, options: ModelListFetchOptions): Promise<ModelEntry[] | undefined> {
  const token = await (options.claudeToken ?? claudeAccessToken)(configDir);
  if (!token) return undefined;
  const headers = { Authorization: `Bearer ${token}`, 'anthropic-beta': CLAUDE_OAUTH_BETA, 'anthropic-version': '2023-06-01' };
  return readAnthropicModels(headers, options);
}

/**
 * Claude Code has no command that lists models. The CLI names the model each alias and its own default stand for
 * when it starts (`claudeStartProbe`), and the Models API, called with the account's own sign-in, names each model
 * ("Claude Opus 5.5") and lists the rest. Without a sign-in, or when both fail, the aliases stay as they were.
 */
async function fetchClaudeCode(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error' | 'retryAfter'>> {
  const info = harnessOf(await options.harnesses(), 'claude-code');
  if (!info || info.auth !== 'logged_in' || !info.executable) return withCatalogHint('claude-code', claudeCodeModels(), 'alias');
  const start = options.claudeStart ?? claudeStartProbe;
  const env = harnessAccountEnv('claude-code', info.configDir);
  const asked = [undefined, ...CLAUDE_CODE_ALIASES.map(alias => alias.id)];
  const [started, named] = await Promise.all([
    Promise.all(asked.map(alias => start(info.executable, env, alias).catch(() => undefined))),
    readClaudeCodeNames(info.configDir, options).catch(() => undefined),
  ]);
  const [defaultModel, ...resolved] = started;
  const aliases = Object.fromEntries(CLAUDE_CODE_ALIASES.map((alias, index) => [alias.id, resolved[index]]));
  const row = withCatalogHint('claude-code', claudeCodeEntries({ defaultModel, aliases, named }), 'alias');
  // Signed in, yet nothing learned: keep the plain aliases for now and ask again soon, not a day later (COD-338).
  const learnedNothing = !named && started.every(model => model === undefined);
  if (!learnedNothing) return row;
  return { ...row, retryAfter: new Date(options.now().getTime() + CLAUDE_CODE_RETRY_MS).toISOString() };
}

/** `model/list` from `codex app-server`, the list with names and the default; undefined when it did not answer. */
async function readCodexModelList(info: HarnessInfo, options: ModelListFetchOptions): Promise<ModelEntry[] | undefined> {
  const appServer = options.appServer ?? codexAppServer;
  const [answer] = await appServer(info.executable, harnessAccountEnv('codex', info.configDir), [{ method: 'model/list', params: { limit: 100 } }]);
  try {
    const models = parseCodexModelList(answer);
    return models.length ? models : undefined;
  } catch {
    return undefined;
  }
}

async function fetchCodex(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const info = harnessOf(await options.harnesses(), 'codex');
  const name = harnessNames.codex;
  if (!info || info.auth === 'missing' || !info.executable) return withCatalogHint('codex', [], 'native', missingHarness(name));
  if (info.auth !== 'logged_in') return withCatalogHint('codex', [], 'native', signedOut(name));
  const listed = await readCodexModelList(info, options).catch(() => undefined);
  if (listed) return withCatalogHint('codex', listed, 'native');
  // An older CLI without `model/list`: the debug JSON has names but no default.
  const probe = options.probe ?? probeWithTimeout(options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
  const remote = await probe(info.executable, ['debug', 'models']);
  try {
    return withCatalogHint('codex', parseCodexModels(`${remote.stdout}${remote.stderr}`), 'native');
  } catch {
    const bundled = await probe(info.executable, ['debug', 'models', '--bundled']);
    return withCatalogHint('codex', parseCodexModels(`${bundled.stdout}${bundled.stderr}`), 'native');
  }
}

async function fetchCursor(options: ModelListFetchOptions): Promise<Pick<ModelListRow, 'models' | 'source' | 'error'>> {
  const info = harnessOf(await options.harnesses(), 'cursor');
  const name = harnessNames.cursor;
  if (!info || info.auth === 'missing' || !info.executable) return withCatalogHint('cursor', [], 'native', missingHarness(name));
  if (info.auth !== 'logged_in') return withCatalogHint('cursor', [], 'native', signedOut(name));
  const probe = options.probe ?? probeWithTimeout(options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
  const result = await probe(info.executable, ['--list-models']);
  return withCatalogHint('cursor', parseCursorModels(`${result.stdout}${result.stderr}`), 'native');
}

export async function fetchProviderList(provider: ModelListProvider, options: ModelListFetchOptions): Promise<ModelListRow> {
  const fetchedAt = options.now().toISOString();
  if (provider === 'openai') return { fetchedAt, ...await fetchOpenAI(options) };
  if (provider === 'anthropic') return { fetchedAt, ...await fetchAnthropic(options) };
  if (provider === 'xai') return { fetchedAt, ...await fetchXai(options) };
  if (provider === 'openrouter') return { fetchedAt, ...await fetchOpenRouter(options) };
  if (provider === 'opencode-zen' || provider === 'opencode-go') return { fetchedAt, ...await fetchOpenCode(provider, options) };
  if (provider === 'codepawl') return { fetchedAt, ...await fetchCodepawl(options) };
  if (provider === 'ollama') return { fetchedAt, ...await fetchOllama(options) };
  if (provider === 'claude-code') return { fetchedAt, ...await fetchClaudeCode(options) };
  if (provider === 'gemini') return { fetchedAt, ...withCatalogHint('gemini', geminiCliModels(), 'alias') };
  if (isCustomProvider(provider)) return { fetchedAt, ...await fetchCustomConnection(provider, options) };
  if (provider === 'codex') return { fetchedAt, ...await fetchCodex(options) };
  return { fetchedAt, ...await fetchCursor(options) };
}
