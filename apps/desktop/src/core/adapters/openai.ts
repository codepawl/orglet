import OpenAI from 'openai';
import type { ChatCompletionContentPartImage, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { modelCatalog, type CatalogProvider } from './catalog';
import type { ImageRef } from '../../shared/images';

export type ModelReply = { calls: { id: string; name: string; arguments: string }[]; usage?: { input: number; output: number };
  /** Text the model wrote beside its call, kept for later steps (COD-264). */
  notes?: string;
  validationFailure?: { toolName: 'submit_report'; issues: { path: string; code: string; expected?: string }[] } };
/** An image a message carries: the reference checkpoints keep, and its base64 bytes, added just before a request. */
export type MessageImage = ImageRef & { data?: string };
/**
 * A conversation message as the runner keeps it: the OpenAI chat shape, plus an optional image slot on a user or tool
 * message (COD-260). Each adapter turns the slot into its provider's own image parts.
 */
export type RunMessage = ChatCompletionMessageParam & { images?: MessageImage[] };
export interface ModelAdapter {
  request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string): Promise<ModelReply>;
}

/** A message with its image slot taken off, for providers and prompts that take the plain shape. */
export function withoutImages(message: RunMessage): ChatCompletionMessageParam {
  const plain = { ...message };
  delete plain.images;
  return plain;
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
    const plain = withoutImages(message);
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
      parallel_tool_calls: false, max_completion_tokens: 4096,
      stream: true, stream_options: { include_usage: true },
    }, { signal, ...(correlationId ? { headers: { 'X-Client-Request-Id': correlationId } } : {}) });
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: ModelReply['usage'];
    let received = false;
    let text = '';
    for await (const chunk of stream) {
      if (!received) { progress(); received = true; }
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
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
    return { calls: [...calls.values()], usage, ...(notes ? { notes } : {}) };
  }
}
