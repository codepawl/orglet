import { z } from 'zod';

export const Effort = z.enum(['low', 'medium', 'high', 'max']);
export type Effort = z.infer<typeof Effort>;
export const NativeEffort = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type NativeEffort = z.infer<typeof NativeEffort>;
export const EffortCapability = z.object({ levels: z.array(NativeEffort).min(1).max(7), adaptive: z.literal(true).optional() }).strict();
export type EffortCapability = z.infer<typeof EffortCapability>;
export const EffortTransport = z.enum(['reasoning_effort', 'ollama', 'openrouter', 'anthropic', 'codex', 'claude-code', 'gemini']);
export const NativeEffortSetting = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('ollama'), level: NativeEffort }).strict(),
  z.object({ transport: z.literal('reasoning_effort'), level: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) }).strict(),
  z.object({ transport: z.literal('openrouter'), level: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) }).strict(),
  z.object({ transport: z.literal('anthropic'), level: z.enum(['low', 'medium', 'high', 'xhigh', 'max']), adaptive: z.literal(true).optional() }).strict(),
  z.object({ transport: z.literal('codex'), level: NativeEffort }).strict(),
  z.object({ transport: z.literal('claude-code'), level: z.enum(['low', 'medium', 'high', 'max']) }).strict(),
  z.object({ transport: z.literal('gemini'), level: z.enum(['low', 'medium', 'high']) }).strict(),
]);
export type NativeEffortSetting = z.infer<typeof NativeEffortSetting>;
const Requested = { requested: Effort, origin: z.enum(['explicit', 'contextual']) };
export const RunEffort = z.discriminatedUnion('support', [
  z.object({ ...Requested, support: z.literal('supported'), native: NativeEffortSetting }).strict(),
  z.object({ ...Requested, support: z.enum(['unknown', 'unsupported']) }).strict(),
]);
export type RunEffort = z.infer<typeof RunEffort>;

/** Exact documented model families; unknown IDs never inherit support from a provider name. */
export function modelEffort(provider: string, model: string | undefined, advertised?: EffortCapability): { capability?: EffortCapability; transport?: z.infer<typeof EffortTransport>; unsupported?: boolean } {
  if (provider === 'demo') return { unsupported: true };
  if (provider === 'codex') return { capability: advertised, transport: 'codex' };
  if (provider === 'openrouter') return { capability: advertised, transport: 'openrouter' };
  if (provider === 'ollama') return { capability: advertised, transport: 'ollama' };
  if (!model) return {};
  const ordinary: NativeEffort[] = ['low', 'medium', 'high'];
  if (provider === 'openai') {
    // These models require Responses for function calling; Orglet currently uses Chat Completions.
    if (['gpt-6-astra', 'gpt-6.1-sol'].includes(model)) return { unsupported: true };
    if (['o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1'].includes(model)) return { capability: { levels: ordinary }, transport: 'reasoning_effort' };
    if (['gpt-5.2', 'gpt-5.4'].includes(model)) return { capability: { levels: [...ordinary, 'xhigh'] }, transport: 'reasoning_effort' };
    if (['gpt-4.1-mini-2025-04-14', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'].includes(model)) return { unsupported: true };
  }
  if (provider === 'xai') {
    if (['grok-3-mini', 'grok-3-mini-beta', 'grok-3-mini-fast', 'grok-3-mini-fast-beta'].includes(model)) return { capability: { levels: ['low', 'high'] }, transport: 'reasoning_effort' };
    // Newer reasoning docs also describe Responses: support here must be evidenced for Chat Completions.
  }
  if (provider === 'anthropic' || provider === 'claude-code') {
    if (model === 'claude-opus-4-5-20251101') return { capability: { levels: ordinary }, transport: provider === 'anthropic' ? 'anthropic' : 'claude-code' };
    if (['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-opus-5-5'].includes(model)) {
      return { capability: { levels: [...ordinary, 'max'], ...(provider === 'anthropic' ? { adaptive: true as const } : {}) }, transport: provider === 'anthropic' ? 'anthropic' : 'claude-code' };
    }
  }
  if (provider === 'gemini') {
    if (['gemini-3-pro-preview', 'gemini-3.1-pro-preview'].includes(model)) return { capability: { levels: ['low', 'high'] }, transport: 'gemini' };
    if (['gemini-3-flash-preview'].includes(model)) return { capability: { levels: ordinary }, transport: 'gemini' };
  }
  return {};
}

/** Only named levels actually supported by this model and transport may be dispatched. */
export function resolveEffort(requested: Effort | undefined, stage: string | undefined, capability: EffortCapability | undefined,
  transport: z.infer<typeof EffortTransport> | undefined, unsupported = false, scheduled = false): RunEffort {
  const base = { requested: requested ?? (!scheduled && (stage === 'plan' || stage === 'synthesis') ? 'high' : 'medium'), origin: requested ? 'explicit' as const : 'contextual' as const };
  if (unsupported) return { ...base, support: 'unsupported' };
  if (!capability || !transport) return { ...base, support: 'unknown' };
  const order = NativeEffort.options;
  const levels = order.filter(level => capability.levels.includes(level));
  const level = base.requested === 'max' ? levels.at(-1) : levels.find(level => level === base.requested);
  if (!level) return { ...base, support: 'unsupported' };
  const native = NativeEffortSetting.safeParse({ transport, level, ...(capability.adaptive ? { adaptive: true } : {}) });
  return native.success ? { ...base, support: 'supported', native: native.data } : { ...base, support: 'unsupported' };
}
