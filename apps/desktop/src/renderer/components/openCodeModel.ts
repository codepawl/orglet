import type { Worker } from '../../shared/contracts';
import { assertOpenCodeModel, isOpenCodePlan, openCodeSupport } from '../../shared/opencode';
import { tMessage } from '../i18n';

/**
 * Why an OpenCode Zen or Go worker cannot run this model ID, in the interface language, or undefined when it can
 * (or the provider is not OpenCode). Uses the same check the core applies on save and before each run.
 */
export function openCodeModelIssue(provider: Worker['provider'], modelId: string): string | undefined {
  if (!isOpenCodePlan(provider)) return undefined;
  try {
    assertOpenCodeModel(provider, modelId);
    return undefined;
  } catch (error) {
    return tMessage(error instanceof Error ? error.message : String(error));
  }
}

/** Whether a listed model can be picked; always true outside OpenCode. */
export function modelRunnable(provider: Worker['provider'], modelId: string): boolean {
  if (!isOpenCodePlan(provider)) return true;
  return openCodeSupport(provider, modelId).supported;
}
