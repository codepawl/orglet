import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { modelCatalog, type CatalogProvider } from './catalog';

export type ModelReply = { calls: { id: string; name: string; arguments: string }[]; usage?: { input: number; output: number };
  validationFailure?: { toolName: 'submit_report'; issues: { path: string; code: string; expected?: string }[] } };
export interface ModelAdapter {
  request(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply>;
}
export class OpenAIAdapter implements ModelAdapter {
  private client: OpenAI;
  private model: string;
  constructor(key: string, options: { baseURL?: string; provider?: CatalogProvider; model?: string; defaultHeaders?: Record<string, string> } = {}) {
    const provider = options.provider ?? 'openai';
    this.model = options.model || modelCatalog[provider].model;
    this.client = new OpenAI({
      apiKey: key, maxRetries: 0, timeout: 90_000,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
    });
  }
  async request(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    const stream = await this.client.chat.completions.create({
      model: this.model, messages, tools, tool_choice: 'required',
      parallel_tool_calls: false, max_completion_tokens: 4096,
      stream: true, stream_options: { include_usage: true },
    }, { signal, ...(correlationId ? { headers: { 'X-Client-Request-Id': correlationId } } : {}) });
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: ModelReply['usage'];
    let received = false;
    for await (const chunk of stream) {
      if (!received) { progress(); received = true; }
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      for (const part of chunk.choices[0]?.delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        if (call.arguments.length > 128_000) throw new Error('Provider output exceeds the supported size.');
        calls.set(part.index, call);
      }
    }
    return { calls: [...calls.values()], usage };
  }
}
