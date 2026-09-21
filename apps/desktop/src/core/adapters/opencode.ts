import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { OpenAIAdapter, type ModelAdapter, type ModelReply } from './openai';
import { detectUsageLimit } from '../usageLimits';
import { assertOpenCodeModel, OPENCODE_BASE_URLS, OPENCODE_PLAN_NAMES, type OpenCodePlan } from '../../shared/opencode';

/**
 * A provider refusal worded for the user. The runner shows its message instead of the generic "request did not
 * complete" text, so a missing key, a used-up plan or a model outside the plan each say what happened.
 */
export class ProviderRequestError extends Error {}

/**
 * OpenCode Zen or Go over the OpenAI-compatible chat/completions endpoint, through the same adapter as OpenRouter and
 * xAI. The model must be one the plan's docs list on that endpoint; anything else is refused before a request is sent.
 */
export class OpenCodeAdapter implements ModelAdapter {
  private inner: OpenAIAdapter;
  constructor(private plan: OpenCodePlan, key: string, private model: string | undefined, baseURL = OPENCODE_BASE_URLS[plan]) {
    assertOpenCodeModel(plan, model);
    this.inner = new OpenAIAdapter(key, { baseURL, model });
  }

  async request(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    try {
      return await this.inner.request(messages, tools, signal, progress, correlationId);
    } catch (error) {
      throw openCodeFailure(this.plan, this.model ?? '', error);
    }
  }
}

/** The provider's own error text, on one line and short enough for a notice. */
function providerDetail(error: APIError): string {
  // The SDK prefixes the status ("500 Upstream failure"); the message already names it.
  const text = String(error.message ?? '').replace(/\s+/g, ' ').trim().replace(/^\d{3}\s+/, '');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function quotaMessage(plan: OpenCodePlan) {
  if (plan === 'opencode-go') {
    return 'OpenCode Go báo đã chạm hạn mức của gói (5 giờ, tuần hoặc tháng). Chờ hạn mức làm mới rồi thử lại, hoặc xem hạn mức trên opencode.ai.';
  }
  return 'OpenCode Zen báo hết số dư hoặc chạm giới hạn chi tiêu tháng. Nạp thêm hoặc nâng giới hạn trên opencode.ai rồi thử lại.';
}

function rateMessage(plan: OpenCodePlan) {
  const planName = OPENCODE_PLAN_NAMES[plan];
  return `${planName} đang từ chối vì có quá nhiều yêu cầu. Thử lại sau ít phút.`;
}

function statusMessage(plan: OpenCodePlan, model: string, error: APIError): string {
  const planName = OPENCODE_PLAN_NAMES[plan];
  const status = error.status ?? 0;
  const detail = providerDetail(error);
  if (status === 401 || status === 403) {
    return `${planName} từ chối API key. Kiểm tra key ${planName} trong Cài đặt → Kết nối.`;
  }
  if (status === 402) return quotaMessage(plan);
  if (status === 429) {
    const limit = detectUsageLimit(detail);
    if (limit?.kind === 'quota') return quotaMessage(plan);
    if (limit?.kind === 'rate') return rateMessage(plan);
    // Without a documented code, a 429 may be either; say both rather than guess.
    return `${planName} từ chối vì quá nhiều yêu cầu hoặc đã chạm hạn mức. Thử lại sau, hoặc xem hạn mức trên opencode.ai.`;
  }
  if (status === 404 || (status === 400 && /model/i.test(detail))) {
    return `${planName} không nhận model ${model} (${status}). Kiểm tra model này có trong gói ${planName} không.`;
  }
  return `${planName} trả lỗi ${status}: ${detail}`;
}

/** Maps an SDK failure to a plan-specific message. Cancellation passes through untouched. */
export function openCodeFailure(plan: OpenCodePlan, model: string, error: unknown): unknown {
  if (error instanceof APIUserAbortError) return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  const planName = OPENCODE_PLAN_NAMES[plan];
  if (error instanceof APIConnectionTimeoutError) return new ProviderRequestError(`${planName} không trả lời kịp. Thử lại sau.`);
  if (error instanceof APIConnectionError) return new ProviderRequestError(`Không kết nối được ${planName}. Kiểm tra mạng rồi thử lại.`);
  if (error instanceof APIError) return new ProviderRequestError(statusMessage(plan, model, error));
  return error;
}
