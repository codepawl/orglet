import { accountSwitchFor, type AccountSwitch } from './account-switch';
import type { Run } from './contracts';
import { isHarness, tightestWindow, type HarnessAccountUsage, type HarnessInfo, type HarnessUsage, type HarnessUsageWindow } from './harness';

/** From here on the bar by the message box takes the warning colour and says when the allowance resets. */
export const USAGE_WARNING_PERCENT = 80;

export type ComposerUsageTone = 'normal' | 'warning' | 'out';

/** One harness of the chat with plan usage: the account in use, what the vendor says about it, and its closest allowance. */
export type HarnessPlan = {
  harness: HarnessInfo;
  usage: HarnessAccountUsage;
  tightest: HarnessUsageWindow;
  tone: ComposerUsageTone;
  /** When the account has room again: the latest reset among the allowances that are full, else the closest one's. */
  resetsAt?: string;
};

/**
 * What the bar by the message box shows (COD-326): the harness account closest to its limit among the chat's orglets,
 * every other one with plan usage after it, and, once the shown one is out, the account the island would offer.
 */
export type ComposerUsage = { shown: HarnessPlan; others: HarnessPlan[]; offer?: AccountSwitch };

export function composerUsageTone(usedPercent: number): ComposerUsageTone {
  if (usedPercent >= 100) return 'out';
  if (usedPercent >= USAGE_WARNING_PERCENT) return 'warning';
  return 'normal';
}

/** A full allowance stops the account until it resets; when two are full, the later reset is when it runs again. */
function roomAgainAt(windows: readonly HarnessUsageWindow[], tightest: HarnessUsageWindow): string | undefined {
  const full = windows.filter(window => window.usedPercent >= 100 && window.resetsAt);
  if (!full.length) return tightest.resetsAt;
  return full.map(window => window.resetsAt!).reduce((latest, next) => Date.parse(next) > Date.parse(latest) ? next : latest);
}

/** The account in use of one harness, when the vendor gave windows for it (fresh, or the last reading with its time). */
function planOf(harness: HarnessInfo, rows: readonly HarnessAccountUsage[] | undefined): HarnessPlan | undefined {
  const usage = rows?.find(row => row.accountId === harness.accountId);
  if (!usage) return undefined;
  const tightest = tightestWindow(usage);
  if (!tightest) return undefined;
  const resetsAt = roomAgainAt(usage.windows, tightest);
  return { harness, usage, tightest, tone: composerUsageTone(tightest.usedPercent), ...(resetsAt ? { resetsAt } : {}) };
}

/**
 * The providers of the orglets that answer in this chat, in roster order. API connections, Demo, and harnesses that
 * report no plan usage (Cursor Agent, Gemini CLI, an API-key sign-in, a signed-out account) give nothing. With several
 * harnesses (a crew, a group chat) the one closest to its limit is shown, since it stops the chat first; a tie keeps
 * roster order.
 */
export function composerUsageFor(providers: readonly string[], harnesses: readonly HarnessInfo[] | undefined, usage: HarnessUsage | undefined): ComposerUsage | undefined {
  if (!harnesses || !usage) return undefined;
  const harnessIds = [...new Set(providers.filter(isHarness))];
  const plans: HarnessPlan[] = [];
  for (const id of harnessIds) {
    const harness = harnesses.find(item => item.id === id);
    const plan = harness ? planOf(harness, usage[id]) : undefined;
    if (plan) plans.push(plan);
  }
  if (!plans.length) return undefined;
  const ordered = [...plans].sort((a, b) => b.tightest.usedPercent - a.tightest.usedPercent);
  const [shown, ...others] = ordered;
  if (shown.tone !== 'out') return { shown, others };
  return { shown, others, offer: accountSwitchFor(shown.harness, usage[shown.harness.id]) };
}

/**
 * How full the model's context was on the chat's latest run that knows it, and how Orglet trimmed the chat for that
 * run: the latest turns sent word for word, older ones folded into a summary (`core/context/thread.ts`).
 */
export type ChatContextUse = { usedTokens: number; windowTokens: number; workerName: string; verbatimTurns?: number; summarizedTurns: number };

/** The latest run that reported both how many tokens its last call sent and the model's window; nothing is estimated. */
export function latestContextUse(runs: readonly Run[]): ChatContextUse | undefined {
  const run = runs.findLast(item => item.contextUse?.windowTokens && item.contextUse.windowTokens > 0);
  if (!run?.contextUse?.windowTokens) return undefined;
  const manifest = run.snapshot.context?.manifest;
  const summarized = new Set((manifest?.omitted ?? []).filter(item => item.kind === 'turn' && item.reason === 'summarized').map(item => item.revision));
  return {
    usedTokens: run.contextUse.usedTokens,
    windowTokens: run.contextUse.windowTokens,
    workerName: run.snapshot.worker.name,
    ...(manifest?.verbatimTurns !== undefined ? { verbatimTurns: manifest.verbatimTurns } : {}),
    summarizedTurns: summarized.size,
  };
}

export const contextPercent = (context: Pick<ChatContextUse, 'usedTokens' | 'windowTokens'>) => Math.min(100, (context.usedTokens / context.windowTokens) * 100);

/**
 * The ring under the message box: the share of whichever is closer to its limit, the tightest plan allowance or the
 * context window, and the tone that share takes. Nothing when neither is known (Demo, an API model without a window).
 */
export function usageRingFor(plans: ComposerUsage | undefined, context: ChatContextUse | undefined): { percent: number; tone: ComposerUsageTone } | undefined {
  const shares = [plans?.shown.tightest.usedPercent, context ? contextPercent(context) : undefined].filter((share): share is number => share !== undefined);
  if (!shares.length) return undefined;
  const percent = Math.max(...shares);
  return { percent, tone: composerUsageTone(percent) };
}
