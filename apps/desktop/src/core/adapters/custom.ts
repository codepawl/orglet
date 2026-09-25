import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { OpenAIAdapter, type ModelAdapter, type ModelReply, type RunMessage } from './openai';
import { ProviderRequestError } from './opencode';
import { baseUrlHost, type CustomConnection, type CustomProviderId } from '../../shared/custom-connections';
import { requireCustomConnection } from '../storage/custom-connections';
import type { Store } from '../storage/database';

/**
 * A custom OpenAI-compatible connection (COD-242) over the same chat/completions adapter OpenRouter, xAI and Ollama
 * use. Without a key no Authorization header is sent at all, which is what a local server such as LM Studio expects.
 */
export class CustomConnectionAdapter implements ModelAdapter {
  private inner: OpenAIAdapter;
  constructor(private connection: CustomConnection, key: string | null, private model: string | undefined) {
    if (!model) throw new ProviderRequestError(`Chưa chọn model cho ${connection.name}. Chọn model trong menu Chỉnh sửa của Tí.`);
    this.inner = new OpenAIAdapter(key ?? 'no-key', {
      baseURL: connection.baseUrl,
      model,
      ...(key ? {} : { omitAuthorization: true }),
    });
  }

  async request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    try {
      return await this.inner.request(messages, tools, signal, progress, correlationId);
    } catch (error) {
      throw customConnectionFailure(this.connection, this.model ?? '', error);
    }
  }
}

/**
 * The adapter for a `custom:<id>` provider as the core builds it: the saved connection, and its key when main has one.
 * A connection deleted since the orglet was saved fails here with a message that says so.
 */
export async function customConnectionAdapter(store: Store, provider: CustomProviderId, model: string | undefined,
  readKey: (provider: CustomProviderId) => Promise<string | null>): Promise<CustomConnectionAdapter> {
  const connection = requireCustomConnection(store, provider);
  const key = await readKey(provider);
  return new CustomConnectionAdapter(connection, key, model);
}

/** The server's own error text on one line, short enough for a notice. */
function serverDetail(error: APIError): string {
  const text = String(error.message ?? '').replace(/\s+/g, ' ').trim().replace(/^\d{3}\s+/, '');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function statusMessage(connection: CustomConnection, model: string, error: APIError): string {
  const status = error.status ?? 0;
  if (status === 401 || status === 403) {
    return `${connection.name} từ chối yêu cầu (${status}). Kiểm tra API key của kết nối này trong Cài đặt → Kết nối API.`;
  }
  if (status === 404) return `${connection.name} không nhận model ${model} (404). Kiểm tra ID model và địa chỉ kết nối.`;
  if (status === 429) return `${connection.name} đang từ chối vì quá nhiều yêu cầu hoặc hết hạn mức. Thử lại sau.`;
  return `${connection.name} trả lỗi ${status}: ${serverDetail(error)}`;
}

/** Maps an SDK failure to a message naming the connection. Cancellation passes through untouched. */
export function customConnectionFailure(connection: CustomConnection, model: string, error: unknown): unknown {
  if (error instanceof APIUserAbortError) return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  if (error instanceof APIConnectionTimeoutError) return new ProviderRequestError(`${connection.name} không trả lời kịp. Thử lại sau.`);
  if (error instanceof APIConnectionError) {
    return new ProviderRequestError(`Không kết nối được ${connection.name} tại ${baseUrlHost(connection.baseUrl)}. Kiểm tra máy chủ đang chạy rồi thử lại.`);
  }
  if (error instanceof APIError) return new ProviderRequestError(statusMessage(connection, model, error));
  return error;
}
