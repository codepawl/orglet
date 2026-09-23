import { useEffect, useSyncExternalStore } from 'react';

/**
 * Session memory for what the renderer has already asked the core for (COD-218). The rule it serves: a click never
 * opens an empty pane. Whatever a row or a tab will need is asked for while the pointer rests on it, kept once it
 * has been seen, and shown at once the next time, while a fresh copy is fetched behind it where freshness matters.
 *
 * This is UI chrome, not business state: it lives only as long as the window, it is never written to disk, and
 * it holds nothing the core does not hold better. Anything that must be right the moment it is shown (money,
 * a harness's sign-in for a run) is read again by the caller; the cache only answers what to draw first.
 */
export type SessionCacheOptions<Value> = {
  /** Fetches one entry; the promise's failure is the caller's to handle, and nothing is stored. */
  load: (key: string) => Promise<Value>;
  /** How many entries are kept; the least recently read is dropped first. */
  limit?: number;
  /** How long the pointer has to rest on something before its data is fetched. */
  dwellMs?: number;
};

const DEFAULT_LIMIT = 20;
const DEFAULT_DWELL_MS = 100;

export class SessionCache<Value> {
  private readonly values = new Map<string, Value>();
  private readonly inflight = new Map<string, Promise<Value>>();
  private readonly dwellTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly load: (key: string) => Promise<Value>;
  private readonly limit: number;
  private readonly dwellMs: number;

  constructor(options: SessionCacheOptions<Value>) {
    this.load = options.load;
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
  }

  /** The kept entry, if any. Reading it counts as use, so it is the last to be evicted. */
  get(key: string): Value | undefined {
    if (!this.values.has(key)) return undefined;
    const value = this.values.get(key) as Value;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  size(): number {
    return this.values.size;
  }

  /** Whether a fetch for this key is on its way. */
  loading(key: string): boolean {
    return this.inflight.has(key);
  }

  set(key: string, value: Value): void {
    this.values.delete(key);
    this.values.set(key, value);
    this.evict();
    this.notify();
  }

  /** The kept entry, or one fetch for it. Two callers asking at once share the same request. */
  read(key: string): Promise<Value> {
    if (this.values.has(key)) return Promise.resolve(this.get(key) as Value);
    return this.refresh(key);
  }

  /** Always fetches, sharing a request already on its way, and replaces the kept entry when it lands. */
  refresh(key: string): Promise<Value> {
    const running = this.inflight.get(key);
    if (running) return running;
    const request = this.load(key).then(value => {
      // An invalidation while the request was out means the answer describes something that has since changed.
      if (this.inflight.get(key) === request) this.set(key, value);
      return value;
    }).finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key);
    });
    this.inflight.set(key, request);
    return request;
  }

  /** Starts the dwell clock for a key: once the pointer has rested long enough, the entry is fetched. */
  prefetch(key: string): void {
    if (this.values.has(key) || this.inflight.has(key) || this.dwellTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.dwellTimers.delete(key);
      this.read(key).catch(() => { /* a prefetch that fails is simply not kept; opening asks again */ });
    }, this.dwellMs);
    this.dwellTimers.set(key, timer);
  }

  /** The pointer left before the dwell was up: nothing is fetched. */
  cancelPrefetch(key: string): void {
    const timer = this.dwellTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.dwellTimers.delete(key);
  }

  /** `prefetch` or `cancelPrefetch`, for a row's hover and focus handlers. */
  dwell(key: string, resting: boolean): void {
    if (resting) this.prefetch(key);
    else this.cancelPrefetch(key);
  }

  /** Drops one entry, or every entry, and disowns any fetch on its way so a stale answer is never kept. */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.values.clear();
      this.inflight.clear();
      for (const timer of this.dwellTimers.values()) clearTimeout(timer);
      this.dwellTimers.clear();
    } else {
      this.values.delete(key);
      this.inflight.delete(key);
      this.cancelPrefetch(key);
    }
    this.notify();
  }

  /** Keeps only the entries the predicate accepts: how the cache follows a workspace that changed under it. */
  prune(keep: (key: string, value: Value) => boolean): void {
    let dropped = false;
    for (const [key, value] of this.values) {
      if (keep(key, value)) continue;
      this.values.delete(key);
      this.inflight.delete(key);
      dropped = true;
    }
    if (dropped) this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private evict(): void {
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) return;
      this.values.delete(oldest);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * The kept entry for a key, fetched once if the cache has none. Re-renders when the cache changes, so a prefetch
 * that lands after mount fills the component in, and `undefined` means only that nothing has arrived yet.
 */
export function useCached<Value>(cache: SessionCache<Value>, key: string | undefined): Value | undefined {
  const value = useSyncExternalStore(
    listener => cache.subscribe(listener),
    () => (key === undefined ? undefined : cache.get(key)),
    () => undefined,
  );
  useEffect(() => {
    if (key === undefined || cache.has(key)) return;
    cache.read(key).catch(() => { /* the component shows its own empty state; the error surfaces where it is acted on */ });
  }, [cache, key]);
  return value;
}

/** Hover and focus handlers that start and stop a dwell, for any element whose click opens something with data behind it. */
export function dwellHandlers(onDwell: ((resting: boolean) => void) | undefined) {
  if (!onDwell) return {};
  return {
    onPointerEnter: () => onDwell(true),
    onPointerLeave: () => onDwell(false),
    onFocus: () => onDwell(true),
    onBlur: () => onDwell(false),
  };
}
