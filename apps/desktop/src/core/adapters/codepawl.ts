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
      return await this.inner.request(messages, tools, signal, progress, correlationId);
    } catch (error) {
      throw codepawlFailure(error);
    }
  }
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
  if (status === 404 || (status === 400 && /model/i.test(detail))) return `CodePawl router không nhận model này (${status}). ${detail}`;
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
