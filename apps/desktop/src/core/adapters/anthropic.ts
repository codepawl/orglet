import { createHash, type Hash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock, ContentBlockParam, ImageBlockParam, MessageParam, StopReason, TextBlockParam, Tool, ToolChoice, ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AnthropicReplayBlock, AnthropicTurn, MessageImage, ModelAdapter, ModelReply, ModelStop, RunMessage } from './openai';
import { ANTHROPIC_MAX_OUTPUT_TOKENS, modelCatalog } from './catalog';

/** The 5-minute prompt cache, the default TTL: a tool loop's steps start seconds apart, well inside it. */
const CACHE_BREAKPOINT = { type: 'ephemeral' } as const;

/**
 * Models that reject a forced `tool_choice` (`any` or `tool`) with a 400, per the claude-api skill. They get `auto`, and
 * the runner asks again when a reply comes back without a call.
 */
const FORCED_TOOL_CHOICE_REJECTED = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5-1'];

export function acceptsForcedToolChoice(model: string): boolean {
  return !FORCED_TOOL_CHOICE_REJECTED.some(rejecting => model === rejecting || model.startsWith(`${rejecting}-`));
}

function toolChoiceFor(model: string): ToolChoice {
  if (acceptsForcedToolChoice(model)) return { type: 'any', disable_parallel_tool_use: true };
  return { type: 'auto', disable_parallel_tool_use: true };
}

function imageBlock(image: MessageImage): ImageBlockParam {
  if (!image.data) throw new Error('Image bytes were not attached before the request.');
  return { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } };
}

/** Text followed by the message's images, or the plain text when it carries none. */
function contentWithImages(text: string, images: MessageImage[] | undefined): string | (TextBlockParam | ImageBlockParam)[] {
  if (!images?.length) return text;
  return [{ type: 'text', text }, ...images.map(imageBlock)];
}

function toolUseBlocks(message: RunMessage & { role: 'assistant' }): ToolUseBlockParam[] {
  return (message.tool_calls ?? []).map(call => {
    if (call.type !== 'function') throw new Error('Unsupported canonical tool call.');
    return { type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) };
  });
}

/**
 * An assistant step as it was written before thinking blocks were kept: the notes beside the call, then the call. A
 * step left with nothing to say, a reply without a call whose only content was thinking, is not sent at all, since the
 * API refuses an empty assistant message.
 */
function assistantWithoutReplay(message: RunMessage & { role: 'assistant' }): MessageParam | undefined {
  const content: (TextBlockParam | ToolUseBlockParam)[] = [];
  // Notes written beside a call in an earlier step go back with it (COD-264).
  if (message.tool_calls?.length && typeof message.content === 'string' && message.content.trim()) content.push({ type: 'text', text: message.content });
  content.push(...toolUseBlocks(message));
  if (content.length) return { role: 'assistant', content };
  const text = String(message.content ?? '');
  return text.trim() ? { role: 'assistant', content: text } : undefined;
}

function assistantWithReplay(message: RunMessage & { role: 'assistant' }, turn: AnthropicTurn): MessageParam {
  return { role: 'assistant', content: [...turn.blocks, ...toolUseBlocks(message)] };
}

function digestOf(hash: Hash): string {
  return hash.copy().digest('hex');
}

type Translation = { messages: MessageParam[]; cacheBreakIndexes: number[]; requestDigest: string };

/**
 * The runner's messages as the Messages API takes them. A running hash over the system prompt, the tools and each
 * message translated so far tells whether a kept thinking block still follows the exact prefix it was written after:
 * the runner shortens old pages and changes the tool list for a wrap-up, and the API refuses a thinking block replayed
 * after such an edit. A block whose prefix changed goes back as plain notes, and so does every later one, since dropping
 * a block is itself a change to the prefix.
 */
function translate(system: string, tools: Tool[], runMessages: RunMessage[]): Translation {
  const hash = createHash('sha256').update(JSON.stringify({ system, tools }));
  const messages: MessageParam[] = [];
  const cacheBreakIndexes: number[] = [];
  let replayValid = true;
  for (const message of runMessages) {
    let translated: MessageParam | undefined;
    // An image a tool returned sits inside its tool_result, which the Messages API allows (COD-260).
    if (message.role === 'user') translated = { role: 'user', content: contentWithImages(String(message.content), message.images) };
    else if (message.role === 'tool') translated = { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: contentWithImages(String(message.content), message.images) }] };
    else if (message.role === 'assistant') {
      const turn = message.anthropicTurn;
      const replay = replayValid && turn !== undefined && digestOf(hash) === turn.boundTo;
      if (turn && !replay) replayValid = false;
      translated = replay ? assistantWithReplay(message, turn!) : assistantWithoutReplay(message);
    }
    if (!translated) continue;
    hash.update(JSON.stringify(translated));
    messages.push(translated);
    if (message.cacheBreak) cacheBreakIndexes.push(messages.length - 1);
  }
  return { messages, cacheBreakIndexes, requestDigest: digestOf(hash) };
}

function asBlocks(content: MessageParam['content']): ContentBlockParam[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];
}

/** The message with a cache breakpoint on its last block, when that block is one a breakpoint may sit on. */
function withCacheBreakpoint(message: MessageParam): MessageParam {
  const blocks = asBlocks(message.content);
  const last = blocks.at(-1);
  if (!last || last.type === 'thinking' || last.type === 'redacted_thinking') return message;
  blocks[blocks.length - 1] = { ...last, cache_control: CACHE_BREAKPOINT } as ContentBlockParam;
  return { ...message, content: blocks };
}

/**
 * Up to three breakpoints, of the API's four: the system prompt (which caches the tools before it too), the end of the
 * chat's earlier turns, so the next turn reads that prefix back, and the last message, so the next step of this turn
 * reads everything before it.
 */
function withCacheBreakpoints(messages: MessageParam[], cacheBreakIndexes: number[]): MessageParam[] {
  const marked = new Set([...cacheBreakIndexes, messages.length - 1]);
  return messages.map((message, index) => marked.has(index) ? withCacheBreakpoint(message) : message);
}

function stopOf(reason: StopReason | null): ModelStop | undefined {
  if (reason === 'max_tokens') return 'output_limit';
  if (reason === 'model_context_window_exceeded') return 'context_limit';
  if (reason === 'refusal') return 'refusal';
  return undefined;
}

function replayBlocksOf(content: ContentBlock[]): AnthropicReplayBlock[] {
  return content.flatMap((block): AnthropicReplayBlock[] => {
    if (block.type === 'thinking') return [{ type: 'thinking', thinking: block.thinking, signature: block.signature }];
    if (block.type === 'redacted_thinking') return [{ type: 'redacted_thinking', data: block.data }];
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    return [];
  });
}

/** The reply's thinking and text blocks bound to the request that produced them, when it has any thinking to keep. */
function turnOf(content: ContentBlock[], requestDigest: string): AnthropicTurn | undefined {
  const blocks = replayBlocksOf(content);
  if (!blocks.some(block => block.type !== 'text')) return undefined;
  return { blocks, boundTo: requestDigest };
}

export class AnthropicAdapter implements ModelAdapter {
  private client: Anthropic;
  private model: string;
  constructor(key: string, baseURL?: string, model?: string) {
    this.model = model || modelCatalog.anthropic.model;
    this.client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 90_000, ...(baseURL ? { baseURL } : {}) });
  }
  async request(messages: RunMessage[], tools: ChatCompletionTool[], signal: AbortSignal, progress: () => void, correlationId?: string, maxOutputTokens = ANTHROPIC_MAX_OUTPUT_TOKENS): Promise<ModelReply> {
    const system = messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n\n');
    const translatedTools: Tool[] = tools.map(tool => {
      if (tool.type !== 'function') throw new Error('Unsupported canonical tool definition.');
      return { name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters as Tool['input_schema'] };
    });
    const translation = translate(system, translatedTools, messages);
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxOutputTokens,
      system: [{ type: 'text', text: system, cache_control: CACHE_BREAKPOINT }],
      messages: withCacheBreakpoints(translation.messages, translation.cacheBreakIndexes),
      tools: translatedTools,
      tool_choice: toolChoiceFor(this.model),
    }, { signal, ...(correlationId ? { headers: { 'X-Client-Request-Id': correlationId } } : {}) });
    stream.once('streamEvent', () => progress());
    const response = await stream.finalMessage();
    const notes = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim().slice(0, 2000);
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    const usage = { input: response.usage.input_tokens + cacheRead + cacheWrite, output: response.usage.output_tokens, cacheRead, cacheWrite };
    const stopped = stopOf(response.stop_reason);
    // A call cut off at the output cap has input that stops mid-way, so it is never run.
    if (stopped) return { calls: [], usage, stopped, ...(notes ? { notes } : {}) };
    const anthropicTurn = turnOf(response.content, translation.requestDigest);
    return {
      calls: response.content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) })),
      ...(notes ? { notes } : {}),
      ...(anthropicTurn ? { anthropicTurn } : {}),
      usage,
    };
  }
}
