import { accountSwitchFor, type AccountSwitch } from './account-switch';
import type { Run, Worker } from './contracts';
import { defaultEntryId } from './modelChoices';
import type { ModelEntry, ModelListProvider } from './models';
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
 * One orglet of the chat and the model its next message will run on (COD-326): that model's name, how much of its
 * context the orglet's latest run in this chat sent, and how much the model holds.
 */
export type ContextLine = {
  workerId: string;
  workerName: string;
  /** The model's versioned name, else its id; absent for a CLI default nobody has named. */
  modelLabel?: string;
  /** What the orglet's latest run here sent on its last call; 0 before its first run in the chat. */
  usedTokens: number;
  /** Whether `usedTokens` was measured on a run, or the chat has not run this orglet yet. */
  measured: boolean;
  /**
   * How many tokens the model holds: what a run here reported for this same model, else the model list (the provider's
   * own figure, or the window the harness reported on an earlier run anywhere). Absent when nobody has said.
   */
  windowTokens?: number;
};

/**
 * The chat's context for the usage popover: a line per orglet that answers here, in roster order, and how Orglet
 * trimmed the chat on its latest measured run (the latest turns word for word, older ones folded into a summary).
 */
export type ChatContext = { lines: ContextLine[]; verbatimTurns?: number; summarizedTurns: number };

export type ContextWorker = Pick<Worker, 'id' | 'name' | 'provider' | 'modelId'>;

function entryNamed(models: readonly ModelEntry[], modelId: string): ModelEntry | undefined {
  return models.find(entry => entry.id === modelId || entry.resolvedId === modelId || entry.aliases?.includes(modelId));
}

/** The model that runs when the orglet names none: the one the CLI named its default, else Orglet's suggestion. */
function defaultEntry(provider: ModelListProvider, models: readonly ModelEntry[]): ModelEntry | undefined {
  const defaultId = defaultEntryId(provider, models);
  return defaultId ? entryNamed(models, defaultId) : undefined;
}

/** Which model an id means, with every name of the default (none set, its id, what the CLI resolved it to) read as ''. */
function modelKey(modelId: string | undefined, fallback: ModelEntry | undefined): string {
  if (!modelId) return '';
  if (fallback && (fallback.id === modelId || fallback.resolvedId === modelId)) return '';
  return modelId;
}

function contextLine(worker: ContextWorker, models: readonly ModelEntry[], runs: readonly Run[]): ContextLine {
  const provider = worker.provider as ModelListProvider;
  const fallback = defaultEntry(provider, models);
  const next = worker.modelId ? entryNamed(models, worker.modelId) : fallback;
  const nextKey = modelKey(worker.modelId, fallback);
  const own = runs.filter(run => run.snapshot.worker.id === worker.id);
  const measured = own.findLast(run => run.contextUse);
  const reported = own.findLast(run => run.contextUse?.windowTokens && modelKey(run.snapshot.model, fallback) === nextKey)?.contextUse?.windowTokens;
  const windowTokens = reported ?? next?.contextTokens;
  const modelLabel = next?.displayName ?? next?.id ?? worker.modelId;
  return {
    workerId: worker.id,
    workerName: worker.name,
    ...(modelLabel ? { modelLabel } : {}),
    usedTokens: measured?.contextUse?.usedTokens ?? 0,
    measured: Boolean(measured),
    ...(windowTokens ? { windowTokens } : {}),
  };
}

/**
 * The context window of the model each orglet of the chat will use next (COD-326). `modelLists` is each connection's
 * list as the renderer has it (undefined until it arrives). Demo has no context and gets no line; a chat with only
 * Demo gets nothing. Nothing is estimated: a window comes from a run's own report or from the list, else stays unknown.
 */
export function chatContextFor(workers: readonly ContextWorker[], modelLists: Readonly<Record<string, readonly ModelEntry[] | undefined>>, runs: readonly Run[]): ChatContext | undefined {
  const seen = new Set<string>();
  const lines: ContextLine[] = [];
  for (const worker of workers) {
    if (worker.provider === 'demo' || seen.has(worker.id)) continue;
    seen.add(worker.id);
    lines.push(contextLine(worker, modelLists[worker.provider] ?? [], runs));
  }
  if (!lines.length) return undefined;
  const manifest = runs.findLast(run => run.contextUse)?.snapshot.context?.manifest;
  const summarized = new Set((manifest?.omitted ?? []).filter(item => item.kind === 'turn' && item.reason === 'summarized').map(item => item.revision));
  return { lines, ...(manifest?.verbatimTurns !== undefined ? { verbatimTurns: manifest.verbatimTurns } : {}), summarizedTurns: summarized.size };
}

export const contextPercent = (line: { usedTokens: number; windowTokens: number }) => Math.min(100, (line.usedTokens / line.windowTokens) * 100);

/** The share of each line whose window is known; a line with an unknown window has no share. */
export function contextShares(context: ChatContext | undefined): number[] {
  return (context?.lines ?? []).flatMap(line => line.windowTokens ? [contextPercent({ usedTokens: line.usedTokens, windowTokens: line.windowTokens })] : []);
}

/**
 * The ring under the message box: the share of whichever is closest to its limit, the tightest plan allowance or the
 * fullest context window among the chat's orglets, and the tone that share takes. Nothing when none is known (Demo,
 * a model nobody gave a window for and no plan).
 */
export function usageRingFor(plans: ComposerUsage | undefined, context: ChatContext | undefined): { percent: number; tone: ComposerUsageTone } | undefined {
  const shares = [...(plans ? [plans.shown.tightest.usedPercent] : []), ...contextShares(context)];
  if (!shares.length) return undefined;
  const percent = Math.max(...shares);
  return { percent, tone: composerUsageTone(percent) };
}
