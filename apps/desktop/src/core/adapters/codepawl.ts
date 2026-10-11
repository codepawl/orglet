import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { OpenAIAdapter, type ModelAdapter, type ModelReply, type RunMessage } from './openai';
import { ProviderRequestError } from './opencode';

/**
 * The CodePawl router over its OpenAI-compatible chat/completions endpoint, through the same adapter as OpenRouter and
 * OpenCode. The router answers in OpenAI's error shape and words its own refusals for a person (the free allowance
 * used up and when it returns, a plan needed), so its message is shown as it is; the status only decides the lead.
 */
export class CodepawlAdapter implements ModelAdapter {
  private inner: OpenAIAdapter;
  constructor(key: string, apiUrl: string, model: string | undefined) {
    this.inner = new OpenAIAdapter(key, { baseURL: apiUrl, model });
  }

  async request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    try {
      return await this.inner.request(messages, tools.map(withSimpleParameters), signal, progress, correlationId);
    } catch (error) {
      throw codepawlFailure(error);
    }
  }
}

type JsonSchema = Record<string, unknown>;

/** Keywords whose value is data, not a schema to walk into. */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'required']);
const PRIMITIVE_TYPES = ['string', 'number', 'integer', 'boolean'];

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One branch for each primitive type: every enum of that type joined, or the bare type when a branch allows any value. */
function mergeSameTypeBranches(branches: JsonSchema[]): JsonSchema[] {
  const merged: JsonSchema[] = [];
  for (const type of PRIMITIVE_TYPES) {
    const ofType = branches.filter(branch => branch.type === type);
    if (ofType.length === 0) continue;
    if (ofType.length === 1) {
      merged.push(ofType[0]);
      continue;
    }
    const allListValues = ofType.every(branch => Array.isArray(branch.enum));
    merged.push(allListValues ? { type, enum: [...new Set(ofType.flatMap(branch => branch.enum as unknown[]))] } : { type });
  }
  return [...merged, ...branches.filter(branch => !PRIMITIVE_TYPES.includes(branch.type as string))];
}

/**
 * A tool's parameter schema in the shape the router's providers accept. The app's schemas say "one of these ids, or
 * any other text" as a union of two string branches inside another union, and a strict provider refuses that as
 * ambiguous (measured 2026-10-11: 400 on `propose_orglet`). Nested unions are flattened and branches of one primitive
 * type are joined. The result only ever allows more, never less: the app checks a tool call against its own schema
 * when the call comes back.
 */
export function simplifyToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(simplifyToolSchema);
  if (!isSchema(schema)) return schema;
  const walked: JsonSchema = {};
  for (const [keyword, value] of Object.entries(schema)) walked[keyword] = DATA_KEYWORDS.has(keyword) ? value : simplifyToolSchema(value);
  for (const union of ['anyOf', 'oneOf']) {
    const branches = walked[union];
    if (!Array.isArray(branches)) continue;
    const flat = branches.flatMap(branch => (isSchema(branch) && Array.isArray(branch[union]) && Object.keys(branch).length === 1 ? (branch[union] as unknown[]) : [branch]));
    const merged = mergeSameTypeBranches(flat.filter(isSchema));
    if (merged.length !== 1) {
      walked[union] = merged;
      continue;
    }
    const { [union]: _dropped, ...rest } = walked;
    return { ...merged[0], ...rest };
  }
  return walked;
}

function withSimpleParameters(tool: ChatCompletionTool): ChatCompletionTool {
  if (tool.type !== 'function' || !tool.function.parameters) return tool;
  return { ...tool, function: { ...tool.function, parameters: simplifyToolSchema(tool.function.parameters) as Record<string, unknown> } };
}

function routerDetail(error: APIError): string {
  // A key never goes into a notice, even if a server echoed one back.
  const text = String(error.message ?? '').replace(/cpr_[A-Za-z0-9_\-]+/g, '[key]').replace(/\s+/g, ' ').trim().replace(/^\d{3}\s+/, '');
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

function statusMessage(error: APIError): string {
  const status = error.status ?? 0;
  const detail = routerDetail(error);
  if (status === 401) return 'CodePawl router từ chối key của máy này. Ngắt rồi kết nối lại CodePawl trong Cài đặt → Kết nối.';
  if (status === 402 || status === 429 || status === 403) return `CodePawl router: ${detail}`;
  // The router answers 404 for a model it does not have. A 400 is about the request, and may only mention the model.
  if (status === 404 || (status === 400 && /\bmodel\b.*\b(does not exist|not found|unknown)\b/i.test(detail))) return `CodePawl router không nhận model này (${status}). ${detail}`;
  return `CodePawl router trả lỗi ${status}: ${detail}`;
}

/** Maps an SDK failure to a message the runner shows as it is. Cancellation passes through untouched. */
export function codepawlFailure(error: unknown): unknown {
  if (error instanceof APIUserAbortError) return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  if (error instanceof APIConnectionTimeoutError) return new ProviderRequestError('CodePawl router không trả lời kịp. Thử lại sau.');
  if (error instanceof APIConnectionError) return new ProviderRequestError('Không kết nối được CodePawl router. Kiểm tra mạng rồi thử lại.');
  if (error instanceof APIError) return new ProviderRequestError(statusMessage(error));
  return error;
}
