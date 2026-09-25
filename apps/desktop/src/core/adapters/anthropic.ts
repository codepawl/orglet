import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, TextBlockParam, Tool, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ModelAdapter, ModelReply } from './openai';
import { modelCatalog } from './catalog';

export class AnthropicAdapter implements ModelAdapter {
  private client: Anthropic;
  private model: string;
  constructor(key: string, baseURL?: string, model?: string) {
    this.model = model || modelCatalog.anthropic.model;
    this.client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 90_000, ...(baseURL ? { baseURL } : {}) });
  }
  async request(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    const system = messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n\n');
    const translated: MessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'user') translated.push({ role: 'user', content: String(message.content) });
      else if (message.role === 'tool') translated.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: String(message.content) }] });
      else if (message.role === 'assistant') {
        const content: (TextBlockParam | ToolUseBlockParam)[] = [];
        // Notes written beside a call in an earlier step go back with it (COD-264).
        if (message.tool_calls?.length && typeof message.content === 'string' && message.content.trim()) content.push({ type: 'text', text: message.content });
        for (const call of message.tool_calls ?? []) {
          if (call.type !== 'function') throw new Error('Unsupported canonical tool call.');
          content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) });
        }
        translated.push({ role: 'assistant', content: content.length ? content : String(message.content ?? '') });
      }
    }
    const translatedTools: Tool[] = tools.map(tool => {
      if (tool.type !== 'function') throw new Error('Unsupported canonical tool definition.');
      return { name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters as Tool['input_schema'] };
    });
    const stream = this.client.messages.stream({ model: this.model, max_tokens: 4096, system, messages: translated, tools: translatedTools, tool_choice: { type: 'any', disable_parallel_tool_use: true } }, { signal, ...(correlationId ? { headers: { 'X-Client-Request-Id': correlationId } } : {}) });
    stream.once('streamEvent', () => progress());
    const response = await stream.finalMessage();
    const notes = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim().slice(0, 2000);
    return {
      calls: response.content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) })),
      ...(notes ? { notes } : {}),
      usage: { input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), output: response.usage.output_tokens },
    };
  }
}
