/**
 * Recognizes when a provider refuses work because the user's plan, credits or rate limit ran out, and words it so the
 * user knows what happened and what to do. Covers Claude Code and Codex subscriptions and the OpenAI and Anthropic APIs.
 *
 * The wording each CLI prints was read from its own build (COD-301): Claude Code 2.1.280's limit messages and its
 * `rate_limit_info` schema, and codex-cli 0.157.0's `UsageLimitReachedError` (codex-rs/protocol/src/error.rs).
 */

export type UsageLimit = {
  /**
   * `quota`: the account's plan or credits are used up, whatever model it asks for. `model`: only the allowance of the
   * model in use is used up, so another model still runs on the same account. `rate`: too many requests in a short time.
   */
  kind: 'quota' | 'model' | 'rate';
  resetsAt: Date | null;
  /** For `model`, the model or allowance the provider named, when it named one. */
  model?: string;
};

/** Claude Code's `rate_limit_event` info, sent before each request in stream-json output. */
export type ClaudeRateLimitInfo = {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  /** Extra usage (paid credits past the plan): `allowed` or `allowed_warning` means it carries the requests on. */
  overageStatus?: string;
  overageResetsAt?: number;
  isUsingOverage?: boolean;
};

/**
 * Claude Code's allowances that belong to one model: when one is used up, the other models keep running on the same
 * plan. The names are the ones Claude Code itself prints for them.
 */
const claudeModelAllowances: Record<string, string | undefined> = {
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  seven_day_overage_included: undefined,
};

const isClaudeModelAllowance = (rateLimitType: string | undefined): rateLimitType is string =>
  rateLimitType !== undefined && Object.hasOwn(claudeModelAllowances, rateLimitType);

/** Claude Code 2.1 says this for a 429 that is the server's own throttling ("Server is temporarily limiting requests"). */
const notPlanLimitPattern = /not your usage limit/i;
/**
 * The allowance of one model: Codex "You’ve hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now",
 * Claude Code "You've hit your Opus limit". Model names start with a capital; the plan's own windows ("session",
 * "weekly", "usage") do not, so this is matched case-sensitively.
 */
const codexModelLimitPattern = /usage limit for (.+?)\. Switch to another model/i;
const claudeModelLimitPattern = /hit your ([A-Z][\w.-]*) limit\b/;
/**
 * A used-up plan or credit balance. `usage limit\b` leaves out "usage limits" (Claude Code's resume hint), and nothing
 * here matches the other "limit reached" lines Claude Code prints (context, subagent nesting, budget).
 */
const quotaPattern = /usage limit\b|usage_limit|hit your (?:[a-z'’]+ ){0,3}(?:limit|budget)\b|out of (?:usage|credits)\b|spend cap|insufficient_quota|exceeded your current quota|quota exceeded\. check your plan|credit balance is too low|purchase more credits|billing hard limit/i;
const ratePattern = /rate[ _-]?limit|too many requests|\b429\b/i;

/** The limit described by a provider error message, or null when the error is about something else. */
export function detectUsageLimit(text: string): UsageLimit | null {
  if (notPlanLimitPattern.test(text)) return { kind: 'rate', resetsAt: null };
  const model = codexModelLimitPattern.exec(text) ?? claudeModelLimitPattern.exec(text);
  if (model) return { kind: 'model', model: model[1].trim(), resetsAt: resetTimeIn(text) };
  if (quotaPattern.test(text)) return { kind: 'quota', resetsAt: resetTimeIn(text) };
  if (ratePattern.test(text)) return { kind: 'rate', resetsAt: resetTimeIn(text) };
  return null;
}

/**
 * The limit Claude Code reported in its stream, when it refused the request. A refusal while extra usage carries the
 * requests on is not one: Claude Code keeps running on the credits, so a run that failed then failed for another reason.
 * The reset time is the provider's own, never guessed.
 */
export function claudeRejection(info: ClaudeRateLimitInfo | null): UsageLimit | null {
  if (!info || info.status !== 'rejected') return null;
  if (info.isUsingOverage === true || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning') return null;
  const resetSeconds = info.rateLimitType === 'overage' ? info.overageResetsAt ?? info.resetsAt : info.resetsAt;
  const resetsAt = typeof resetSeconds === 'number' ? new Date(resetSeconds * 1000) : null;
  if (isClaudeModelAllowance(info.rateLimitType)) {
    const model = claudeModelAllowances[info.rateLimitType];
    return { kind: 'model', resetsAt, ...(model ? { model } : {}) };
  }
  return { kind: 'quota', resetsAt };
}

/** A short notice when Claude Code says the plan is close to its limit, or null when there is nothing to say. */
export function claudeLimitWarning(info: ClaudeRateLimitInfo | null): string | null {
  if (!info || info.status !== 'allowed_warning' || typeof info.utilization !== 'number') return null;
  const percent = Math.round(info.utilization * 100);
  const resetsAt = typeof info.resetsAt === 'number' ? formatResetTime(new Date(info.resetsAt * 1000)) : null;
  const model = isClaudeModelAllowance(info.rateLimitType) ? claudeModelAllowances[info.rateLimitType] : undefined;
  const window = info.rateLimitType === 'five_hour' ? '5 giờ' : info.rateLimitType?.startsWith('seven_day') ? '7 ngày' : null;

  if (model && resetsAt) return `Gói Claude Code đã dùng ${percent}% hạn mức 7 ngày của ${model}, làm mới lúc ${resetsAt}.`;
  if (window === '5 giờ' && resetsAt) return `Gói Claude Code đã dùng ${percent}% hạn mức 5 giờ, làm mới lúc ${resetsAt}.`;
  if (window === '7 ngày' && resetsAt) return `Gói Claude Code đã dùng ${percent}% hạn mức 7 ngày, làm mới lúc ${resetsAt}.`;
  return `Gói Claude Code đã dùng ${percent}% hạn mức.`;
}

/** What the user sees when a worker could not run because of a usage limit. */
export function usageLimitMessage(providerName: string, limit: UsageLimit): string {
  if (limit.kind === 'rate') return `${providerName} đang tạm giới hạn vì có quá nhiều yêu cầu. Thử lại sau ít phút.`;
  if (limit.kind === 'model') return modelLimitMessage(providerName, limit);
  if (limit.resetsAt) {
    return `${providerName} đã hết lượt dùng của gói, làm mới lúc ${formatResetTime(limit.resetsAt)}. Chờ đến lúc đó, hoặc đổi model của Tí trong menu Chỉnh sửa.`;
  }
  return `${providerName} đã hết lượt dùng của gói hoặc hết tín dụng. Chờ gói làm mới hay nạp thêm, hoặc đổi model của Tí trong menu Chỉnh sửa.`;
}

/** Only one model's allowance ran out: the plan still runs other models, so the way on is another model. */
function modelLimitMessage(providerName: string, limit: UsageLimit): string {
  const resetsAt = limit.resetsAt ? formatResetTime(limit.resetsAt) : null;
  if (limit.model && resetsAt) {
    return `${providerName} đã hết hạn mức riêng của model ${limit.model}, làm mới lúc ${resetsAt}. Gói vẫn chạy được model khác: đổi model của Tí trong menu Chỉnh sửa, hoặc chờ đến lúc đó.`;
  }
  if (limit.model) return `${providerName} đã hết hạn mức riêng của model ${limit.model}. Gói vẫn chạy được model khác: đổi model của Tí trong menu Chỉnh sửa.`;
  if (resetsAt) {
    return `${providerName} đã hết hạn mức riêng của model đang dùng, làm mới lúc ${resetsAt}. Gói vẫn chạy được model khác: đổi model của Tí trong menu Chỉnh sửa, hoặc chờ đến lúc đó.`;
  }
  return `${providerName} đã hết hạn mức riêng của model đang dùng. Gói vẫn chạy được model khác: đổi model của Tí trong menu Chỉnh sửa.`;
}

/** Local time as "2026-09-18 17:30", which reads the same in every interface language. */
export function formatResetTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A reset time written in the error, when there is one: a Unix timestamp after "|" (older Claude Code builds print
 * "Claude AI usage limit reached|1789667400"), Codex's dated form for a reset on another day ("try again at Oct 4th,
 * 2026 9:15 AM", its own local time), or a clock time such as "try again at 5:04 PM" or "resets 3pm".
 */
function resetTimeIn(text: string): Date | null {
  const timestamp = /\|(\d{10})\b/.exec(text);
  if (timestamp) return new Date(Number(timestamp[1]) * 1000);

  const dated = /try again at ([a-z]{3}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) (\d{1,2}):(\d{2}) ?(am|pm)/i.exec(text);
  if (dated) return datedReset(dated);

  const clock = /(?:try again at|resets?(?: at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!clock) return null;

  const hours = hourOfDay(Number(clock[1]), clock[3]);
  const minutes = Number(clock[2] ?? 0);
  if (hours === null || minutes > 59) return null;

  const reset = new Date();
  reset.setHours(hours, minutes, 0, 0);
  // A clock time already past today means tomorrow.
  if (reset.getTime() <= Date.now()) reset.setDate(reset.getDate() + 1);
  return reset;
}

function datedReset(match: RegExpExecArray): Date | null {
  const month = MONTHS.indexOf(match[1].toLowerCase());
  const hours = hourOfDay(Number(match[4]), match[6]);
  const minutes = Number(match[5]);
  if (month < 0 || hours === null || minutes > 59) return null;
  return new Date(Number(match[3]), month, Number(match[2]), hours, minutes);
}

/** 12-hour clock to 24-hour; null for an hour that is not one. */
function hourOfDay(hour: number, period: string | undefined): number | null {
  if (hour > 23) return null;
  const lowered = period?.toLowerCase();
  if (lowered === 'pm' && hour < 12) return hour + 12;
  if (lowered === 'am' && hour === 12) return 0;
  return hour;
}
