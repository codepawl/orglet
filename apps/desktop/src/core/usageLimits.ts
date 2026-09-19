/**
 * Recognizes when a provider refuses work because the user's plan, credits or rate limit ran out, and words it so the
 * user knows what happened and what to do. Covers Claude Code and Codex subscriptions and the OpenAI and Anthropic APIs.
 */

export type UsageLimit = {
  /** `quota`: the plan or credits are used up. `rate`: too many requests in a short time. */
  kind: 'quota' | 'rate';
  resetsAt: Date | null;
};

/** Claude Code's `rate_limit_event` info, sent before each request in stream-json output. */
export type ClaudeRateLimitInfo = {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
};

const quotaPattern = /usage limit|usage_limit|hit your limit|limit reached|out of (?:credits|usage)|insufficient_quota|exceeded your current quota|credit balance is too low|purchase more credits|billing hard limit/i;
const ratePattern = /rate[ _-]?limit|too many requests|\b429\b/i;

/** The limit described by a provider error message, or null when the error is about something else. */
export function detectUsageLimit(text: string): UsageLimit | null {
  if (quotaPattern.test(text)) return { kind: 'quota', resetsAt: resetTimeIn(text) };
  if (ratePattern.test(text)) return { kind: 'rate', resetsAt: resetTimeIn(text) };
  return null;
}

/** The limit Claude Code reported in its stream, when it refused the request. */
export function claudeRejection(info: ClaudeRateLimitInfo | null): UsageLimit | null {
  if (!info || info.status !== 'rejected') return null;
  return { kind: 'quota', resetsAt: typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000) : null };
}

/** A short notice when Claude Code says the plan is close to its limit, or null when there is nothing to say. */
export function claudeLimitWarning(info: ClaudeRateLimitInfo | null): string | null {
  if (!info || info.status !== 'allowed_warning' || typeof info.utilization !== 'number') return null;
  const percent = Math.round(info.utilization * 100);
  const resetsAt = typeof info.resetsAt === 'number' ? formatResetTime(new Date(info.resetsAt * 1000)) : null;
  const window = info.rateLimitType === 'five_hour' ? '5 giờ' : info.rateLimitType === 'seven_day' || info.rateLimitType?.startsWith('seven_day') ? '7 ngày' : null;

  if (window === '5 giờ' && resetsAt) return `Gói Claude Code đã dùng ${percent}% hạn mức 5 giờ, làm mới lúc ${resetsAt}.`;
  if (window === '7 ngày' && resetsAt) return `Gói Claude Code đã dùng ${percent}% hạn mức 7 ngày, làm mới lúc ${resetsAt}.`;
  return `Gói Claude Code đã dùng ${percent}% hạn mức.`;
}

/** What the user sees when a worker could not run because of a usage limit. */
export function usageLimitMessage(providerName: string, limit: UsageLimit): string {
  if (limit.kind === 'rate') return `${providerName} đang tạm giới hạn vì có quá nhiều yêu cầu. Thử lại sau ít phút.`;
  if (limit.resetsAt) {
    return `${providerName} đã hết lượt dùng của gói, làm mới lúc ${formatResetTime(limit.resetsAt)}. Chờ đến lúc đó, hoặc đổi model của Tí trong menu Chỉnh sửa.`;
  }
  return `${providerName} đã hết lượt dùng của gói hoặc hết tín dụng. Chờ gói làm mới hay nạp thêm, hoặc đổi model của Tí trong menu Chỉnh sửa.`;
}

/** Local time as "2026-09-18 17:30", which reads the same in every interface language. */
export function formatResetTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A reset time written in the error, when there is one: a Unix timestamp after "|" (older Claude Code builds print
 * "Claude AI usage limit reached|1789667400"), or a clock time such as "try again at 5:04 PM" or "resets 3pm".
 */
function resetTimeIn(text: string): Date | null {
  const timestamp = /\|(\d{10})\b/.exec(text);
  if (timestamp) return new Date(Number(timestamp[1]) * 1000);

  const clock = /(?:try again at|resets?(?: at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!clock) return null;

  let hours = Number(clock[1]);
  const minutes = Number(clock[2] ?? 0);
  const period = clock[3]?.toLowerCase();
  if (hours > 23 || minutes > 59) return null;
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  const reset = new Date();
  reset.setHours(hours, minutes, 0, 0);
  // A clock time already past today means tomorrow.
  if (reset.getTime() <= Date.now()) reset.setDate(reset.getDate() + 1);
  return reset;
}
