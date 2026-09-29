import type { RunContextUse } from '../../shared/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

/** Every token a call sent: fresh input plus what was written to and read from the prompt cache. */
function promptTokens(usage: Record<string, unknown>) {
  return count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens);
}

/**
 * How full the context was on Claude Code's last model call (COD-326), from its `result` line. `usage.iterations`
 * lists each call of the run and its last entry is the prompt the model last saw; `modelUsage[model].contextWindow` is
 * the window Claude Code itself runs that model with (both measured on Claude Code 2.1.283: one call, 33,436 tokens
 * sent, window 1,000,000). The top-level `usage` adds every call together, so without `iterations` nothing is said.
 * With several models in `modelUsage` (a helper model beside the main one), the window is the main one's: the model
 * that took the most tokens.
 */
export function claudeContextUse(result: unknown): RunContextUse | undefined {
  if (!isRecord(result) || !isRecord(result.usage) || !Array.isArray(result.usage.iterations)) return undefined;
  const lastCall = result.usage.iterations.findLast(isRecord);
  if (!lastCall) return undefined;
  const usedTokens = promptTokens(lastCall);
  let mainModel: { tokens: number; window: number } | undefined;
  for (const model of Object.values(isRecord(result.modelUsage) ? result.modelUsage : {})) {
    if (!isRecord(model)) continue;
    const tokens = count(model.inputTokens) + count(model.cacheReadInputTokens) + count(model.cacheCreationInputTokens);
    const window = count(model.contextWindow);
    if (window > 0 && (!mainModel || tokens > mainModel.tokens)) mainModel = { tokens, window };
  }
  return mainModel ? { usedTokens, windowTokens: mainModel.window } : { usedTokens };
}
