import { setTimeout as delay } from 'node:timers/promises';

/**
 * How long Orglet waits before trying a refused model request again, once per entry (user, 2026-10-07: a 429 or a
 * dropped network ended the run and the person had to retry by hand). A little jitter is added so several runs do not
 * come back at the same moment.
 */
export const TRANSIENT_RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
/** A provider asking for a longer wait than this is not retried here; the run stops and says so as before. */
export const LONGEST_RETRY_AFTER_MS = 60_000;

/** HTTP answers that say the provider turned the request away before working on it, so nothing was charged. */
const REFUSED_STATUSES = new Set([429, 503, 529]);
/** Connection failures that happen before the request reaches the provider at all. */
const UNREACHED_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);

/**
 * Whether a failed request certainly never ran, so sending it again cannot charge twice, and how long the provider asked
 * to wait. Anything else (a cut in the middle of an answer, a timeout, a server error that may have done the work) is
 * not retried: the run stops as before, because its cost is unknown (`assertResumable` in runner.ts).
 */
export function refusedBeforeWork(error: unknown): { afterMs?: number } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && REFUSED_STATUSES.has(status)) return { afterMs: retryAfterMs((error as { headers?: unknown }).headers) };
  const code = connectionCode(error);
  if (code && UNREACHED_CODES.has(code)) return {};
  return undefined;
}

function connectionCode(error: object): string | undefined {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** `retry-after` in seconds or as a date, from either a Headers object or a plain record. */
export function retryAfterMs(headers: unknown, now = Date.now()): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const raw = typeof (headers as { get?: unknown }).get === 'function'
    ? (headers as Headers).get('retry-after')
    : (headers as Record<string, unknown>)['retry-after'];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Runs `request`, and runs it again after a pause when it was refused before any work (see `refusedBeforeWork`), at most
 * once per entry of `delays`. `onWait` hears each pause, so the chat can say the provider is busy. Stopping the run ends
 * the wait at once.
 */
export async function withTransientRetry<T>(request: () => Promise<T>, signal: AbortSignal, onWait: (waitMs: number, attempt: number, attempts: number) => void, delays = TRANSIENT_RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const refused = attempt < delays.length && !signal.aborted ? refusedBeforeWork(error) : undefined;
      if (!refused || (refused.afterMs ?? 0) > LONGEST_RETRY_AFTER_MS) throw error;
      const waitMs = refused.afterMs ?? Math.round(delays[attempt] * (1 + Math.random() * 0.2));
      onWait(waitMs, attempt + 1, delays.length);
      await delay(waitMs, undefined, { signal });
    }
  }
}
