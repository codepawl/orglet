/**
 * OpenCode Zen and OpenCode Go are two separate connections with their own API keys, endpoints and billing.
 * Orglet calls them directly over the OpenAI-compatible chat/completions endpoint through the same adapter that
 * OpenRouter and xAI use. Each plan's docs list, per model, which endpoint it takes; a model on another endpoint
 * (OpenAI responses, Anthropic messages, Google, System One) would be sent the wrong request, so Orglet refuses it.
 *
 * Sources, read 2026-09-21:
 * - https://opencode.ai/docs/zen/ — endpoint table, `Authorization: Bearer`, models at https://opencode.ai/zen/v1/models
 * - https://opencode.ai/docs/go/ — endpoint table, models at https://opencode.ai/zen/go/v1/models
 * The same model ID can take a different endpoint in each plan (MiniMax is chat/completions in Zen but messages in Go),
 * so the tables are kept per plan and never inferred from a model name.
 */

export type OpenCodePlan = 'opencode-zen' | 'opencode-go';
export type OpenCodeProtocol = 'chat-completions' | 'responses' | 'messages' | 'google' | 'systemone';

export const OPENCODE_PLANS: readonly OpenCodePlan[] = ['opencode-zen', 'opencode-go'];

/** OpenAI-compatible base URLs; the SDK appends `/chat/completions` and `/models`. */
export const OPENCODE_BASE_URLS: Record<OpenCodePlan, string> = {
  'opencode-zen': 'https://opencode.ai/zen/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
};

/** Where each plan documents its models, prices and limits. */
export const OPENCODE_DOCS_URLS: Record<OpenCodePlan, string> = {
  'opencode-zen': 'https://opencode.ai/docs/zen/',
  'opencode-go': 'https://opencode.ai/docs/go/',
};

const zenProtocols: Record<OpenCodeProtocol, readonly string[]> = {
  'chat-completions': [
    'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp',
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
    'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5',
    'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3',
    'big-pickle', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free',
  ],
  responses: [
    'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro',
    'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-5.3-codex-spark',
    'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
    'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'grok-4.6', 'grok-4.5', 'grok-build-0.1',
    'muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.3-contributor-free',
  ],
  messages: [
    'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-opus-4-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
    'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus',
  ],
  google: [
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
    'gemini-3.1-pro', 'gemini-3-flash',
  ],
  systemone: ['jev-1.13', 'jev-1.13-free'],
};

const goProtocols: Record<OpenCodeProtocol, readonly string[]> = {
  'chat-completions': [
    'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'longcat-2.0',
    'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp',
    'mimo-v2.5', 'mimo-v2.5-pro', 'hy4-preview', 'hy3',
  ],
  responses: ['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor'],
  messages: [
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus',
    'qwen3.6-plus',
  ],
  google: [],
  systemone: [],
};

const protocolTables: Record<OpenCodePlan, Record<OpenCodeProtocol, readonly string[]>> = {
  'opencode-zen': zenProtocols,
  'opencode-go': goProtocols,
};

export function isOpenCodePlan(provider: string): provider is OpenCodePlan {
  return provider === 'opencode-zen' || provider === 'opencode-go';
}

/** The endpoint this plan's docs list for the model, or undefined when the docs do not list it. */
export function openCodeProtocol(plan: OpenCodePlan, modelId: string): OpenCodeProtocol | undefined {
  const table = protocolTables[plan];
  const protocols = Object.keys(table) as OpenCodeProtocol[];
  return protocols.find(protocol => table[protocol].includes(modelId));
}

export type OpenCodeSupport =
  | { supported: true }
  | { supported: false; reason: 'protocol'; protocol: Exclude<OpenCodeProtocol, 'chat-completions'> }
  | { supported: false; reason: 'undocumented' };

/** Whether Orglet can send this model ID to this plan over chat/completions, per the plan's own docs. */
export function openCodeSupport(plan: OpenCodePlan, modelId: string): OpenCodeSupport {
  const protocol = openCodeProtocol(plan, modelId.trim());
  if (protocol === 'chat-completions') return { supported: true };
  if (protocol) return { supported: false, reason: 'protocol', protocol };
  return { supported: false, reason: 'undocumented' };
}

const protocolNames: Record<Exclude<OpenCodeProtocol, 'chat-completions'>, string> = {
  responses: 'OpenAI Responses',
  messages: 'Anthropic Messages',
  google: 'Google Gemini',
  systemone: 'System One',
};

export const OPENCODE_PLAN_NAMES: Record<OpenCodePlan, string> = {
  'opencode-zen': 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
};

/** Vietnamese source message for an unsupported model; the renderer translates it with `tMessage`. */
export function openCodeUnsupportedMessage(plan: OpenCodePlan, modelId: string, support: Exclude<OpenCodeSupport, { supported: true }>): string {
  const planName = OPENCODE_PLAN_NAMES[plan];
  if (support.reason === 'protocol') {
    const protocolName = protocolNames[support.protocol];
    return `${planName} gọi model ${modelId} qua endpoint ${protocolName}. Orglet chỉ hỗ trợ endpoint chat/completions nên chưa chạy được model này.`;
  }
  return `Tài liệu ${planName} chưa ghi endpoint cho model ${modelId}, nên Orglet chưa chạy model này.`;
}

/** Throws the unsupported-model message unless the plan's docs list the model on chat/completions. */
export function assertOpenCodeModel(plan: OpenCodePlan, modelId: string | undefined) {
  const trimmed = modelId?.trim();
  if (!trimmed) throw new Error(`Chọn model cho ${OPENCODE_PLAN_NAMES[plan]}. Kết nối này không có model mặc định.`);
  const support = openCodeSupport(plan, trimmed);
  if (!support.supported) throw new Error(openCodeUnsupportedMessage(plan, trimmed, support));
}
