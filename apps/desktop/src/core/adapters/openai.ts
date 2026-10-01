import OpenAI from 'openai';
import type { ChatCompletionContentPartImage, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { modelCatalog, OPENAI_MAX_OUTPUT_TOKENS, type CatalogProvider } from './catalog';
import type { ImageRef } from '../../shared/images';

/**
 * Tokens one request used. `input` is the whole prompt; `cacheRead` and `cacheWrite` are the parts of it the provider
 * served from or wrote to its prompt cache, which are priced apart (COD-358).
 */
export type ModelUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
/**
 * Why a provider ended a reply before it was usable (COD-358): it reached the output cap or the context window, or it
 * declined the request. The runner settles the request and then stops the run with a visible error.
 */
export type ModelStop = 'output_limit' | 'context_limit' | 'refusal';
/** An Anthropic content block that goes back unchanged with the call it came with. */
export type AnthropicReplayBlock = { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string } | { type: 'text'; text: string };
/**
 * The thinking and text blocks of one Anthropic reply, and a digest of the exact request that produced them. Thinking
 * blocks are only valid after an unchanged prefix, so the adapter sends them back only while the digest still matches.
 */
export type AnthropicTurn = { blocks: AnthropicReplayBlock[]; boundTo: string };
export type ModelReply = { calls: { id: string; name: string; arguments: string }[]; usage?: ModelUsage;
  /** Text the model wrote beside its call, kept for later steps (COD-264). */
  notes?: string;
  stopped?: ModelStop;
  anthropicTurn?: AnthropicTurn;
  validationFailure?: { toolName: 'submit_report'; issues: { path: string; code: string; expected?: string }[] } };
/** An image a message carries: the reference checkpoints keep, and its base64 bytes, added just before a request. */
export type MessageImage = ImageRef & { data?: string };
/**
 * A conversation message as the runner keeps it: the OpenAI chat shape, plus an optional image slot on a user or tool
 * message (COD-260). Each adapter turns the slot into its provider's own image parts. An assistant message may carry
 * the Anthropic blocks of the reply it came from, and the last message of a chat's earlier turns is marked
 * `cacheBreak`, where a provider with a prompt cache may end a cached prefix (COD-358).
 */
export type RunMessage = ChatCompletionMessageParam & { images?: MessageImage[]; anthropicTurn?: AnthropicTurn; cacheBreak?: true };
export interface ModelAdapter {
  request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string, maxOutputTokens?: number): Promise<ModelReply>;
}

/** A message without the slots only Orglet reads, for providers and prompts that take the plain chat shape. */
export function plainMessage(message: RunMessage): ChatCompletionMessageParam {
  const plain = { ...message };
  delete plain.images;
  delete plain.anthropicTurn;
  delete plain.cacheBreak;
  return plain;
}

/** How a chat/completions finish reason maps onto a reply that cannot be used. */
function stopOfFinishReason(reason: string | null | undefined): ModelStop | undefined {
  if (reason === 'length') return 'output_limit';
  if (reason === 'content_filter') return 'refusal';
  return undefined;
}

function imagePart(image: MessageImage): ChatCompletionContentPartImage {
  if (!image.data) throw new Error('Image bytes were not attached before the request.');
  return { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } };
}

/**
 * The runner's messages as chat/completions takes them. Images on a user message join its content. A tool message
 * cannot hold an image there, so the images a tool returned follow it as the next user message.
 */
export function chatCompletionMessages(messages: RunMessage[]): ChatCompletionMessageParam[] {
  const translated: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    const plain = plainMessage(message);
    const images = message.images ?? [];
    if (!images.length) {
      translated.push(plain);
      continue;
    }
    const parts = images.map(imagePart);
    if (plain.role === 'user') {
      translated.push({ role: 'user', content: [{ type: 'text', text: String(plain.content) }, ...parts] });
      continue;
    }
    if (plain.role === 'tool') {
      translated.push(plain);
      translated.push({ role: 'user', content: [{ type: 'text', text: 'The image returned by the tool call above:' }, ...parts] });
      continue;
    }
    throw new Error('Only user and tool messages can carry images.');
  }
  return translated;
}

export class OpenAIAdapter implements ModelAdapter {
  private client: OpenAI;
  private model: string;
  constructor(key: string, options: { baseURL?: string; provider?: CatalogProvider; model?: string; defaultHeaders?: Record<string, string>; omitAuthorization?: boolean } = {}) {
    const provider = options.provider ?? 'openai';
    this.model = options.model || modelCatalog[provider].model;
    // A null header is the SDK's way to leave it out; a keyless local server then gets no bearer token at all.
    const defaultHeaders: Record<string, string | null> | undefined = options.omitAuthorization
      ? { ...options.defaultHeaders, Authorization: null }
      : options.defaultHeaders;
    this.client = new OpenAI({
      apiKey: key, maxRetries: 0, timeout: 90_000,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(defaultHeaders ? { defaultHeaders } : {}),
    });
  }
  async request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply> {
    const stream = await this.client.chat.completions.create({
      model: this.model, messages: chatCompletionMessages(messages), tools, tool_choice: 'required',
      parallel_tool_calls: false, max_completion_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      stream: true, stream_options: { include_usage: true },
    }, { signal, ...(correlationId ? { headers: { 'X-Client-Request-Id': correlationId } } : {}) });
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: ModelReply['usage'];
    let received = false;
    let text = '';
    let stopped: ModelStop | undefined;
    for await (const chunk of stream) {
      if (!received) { progress(); received = true; }
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      stopped = stopOfFinishReason(chunk.choices[0]?.finish_reason) ?? stopped;
      const written = chunk.choices[0]?.delta.content;
      if (written && text.length < 2000) text += written;
      for (const part of chunk.choices[0]?.delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        if (call.arguments.length > 128_000) throw new Error('Provider output exceeds the supported size.');
        calls.set(part.index, call);
      }
    }
    const notes = text.trim().slice(0, 2000);
    // A call cut off at the output cap has arguments that stop mid-way, so it is never run.
    if (stopped) return { calls: [], usage, stopped, ...(notes ? { notes } : {}) };
    return { calls: [...calls.values()], usage, ...(notes ? { notes } : {}) };
  }
}
