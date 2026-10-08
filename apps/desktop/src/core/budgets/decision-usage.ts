import type { Worker } from '../../shared/contracts';
import { isHarnessDecisionConnection, type DecisionUsage } from '../../shared/decisions';
import { readModelListCache } from '../models/cache';
import { resolveWorkerModel, type ModelRates } from '../models/resolve';
import { readCustomConnections } from '../storage/custom-connections';
import { id, now, type Store } from '../storage/database';
import { cost } from './ledger';

/**
 * OpenAI's Decisions API price: $0.10 per million input tokens and nothing for output, the figure Settings states. Its
 * answer carries no output tokens, so the request costs exactly its input.
 */
export const OPENAI_DECISIONS_RATES: ModelRates = { inputTenths: 1, outputTenths: 0, pricingVersion: 'openai-decisions:0.10:0.00' };

/** One request of the decision model, as the connection it went through and the provider's count of it. */
export type DecisionUsageEntry = {
  /** The connection the request went through, as a chat names it (`openai`, `anthropic`, a custom connection's id). */
  provider: string;
  model: string;
  /** The chat the answer was for, when there is one; a request about a message not yet sent has none. */
  taskId?: string;
  /** What the provider reported. Left out when the request may have been billed but its count never arrived. */
  usage?: DecisionUsage;
};

/**
 * Records what the decision model's requests used (the same way a settled chat request is recorded: the connection, the
 * month, the tokens and the cost) so they appear in the usage totals and count against the connection's monthly limit and,
 * when the chat is known, that chat's budget. Nothing is held beforehand: these requests are small and a limit that
 * is already reached only shows once they have been made.
 *
 * A cost that cannot be verified is stored as unknown rather than guessed: the model has no verified price, the
 * provider reported no usage, or the request ended without an answer that may still have been billed. The tokens are
 * kept, and `Usage.unpricedDecisionCalls` counts the call so it never reads as free.
 */
export class DecisionUsageLedger {
  constructor(private readonly store: Store) {}

  record(entry: DecisionUsageEntry): void {
    const usage = entry.usage;
    const rates = isHarnessDecisionConnection(entry.provider) ? undefined : this.ratesFor(entry.provider, entry.model);
    const reported = usage !== undefined && !usage.estimated;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cacheRead = usage?.cacheReadTokens ?? 0;
    const cacheWrite = usage?.cacheWriteTokens ?? 0;
    // A harness runs on the person's plan or subscription: a request of it costs no money, whatever it counted, and is no unknown cost.
    const onPlan = isHarnessDecisionConnection(entry.provider);
    const amount = onPlan ? 0 : reported && rates ? cost(inputTokens, outputTokens, rates, { read: cacheRead, write: cacheWrite }) : null;
    this.store.db.prepare(`INSERT INTO decision_usage (id,task_id,provider,model,month,amount,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,estimated,pricing_version,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id(), entry.taskId ?? null, entry.provider, entry.model, new Date().toISOString().slice(0, 7), amount, inputTokens, outputTokens, cacheRead, cacheWrite, reported ? 0 : 1, onPlan ? 'harness-plan' : rates?.pricingVersion ?? null, now());
  }

  /** The verified price of the connection's model, or undefined when Orglet has none for it. */
  private ratesFor(provider: string, model: string): ModelRates | undefined {
    if (provider === 'openai') return OPENAI_DECISIONS_RATES;
    try {
      return resolveWorkerModel({ provider: provider as Worker['provider'], modelId: model }, readModelListCache(this.store), readCustomConnections(this.store)).rates;
    } catch {
      return undefined;
    }
  }
}
