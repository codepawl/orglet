/** Who is waiting for a slot, so the Running view can name the run and its place in line (COD-244). */
export type SlotOwner = { runId: string; taskId: string };

/** A run waiting for its provider: how many wait ahead of it for the same provider, and since when. */
export type SlotWait = SlotOwner & { provider: string; ahead: number; since: number };

type QueueEntry = { provider: string; owner?: SlotOwner; since: number; waited: boolean; grant: () => void };

/**
 * Workspace-wide cap on in-flight model requests per provider. Team and task limits alone allow
 * several tasks to hit one API key at once; this queue keeps that bounded and cancellable.
 */
export class ProviderSlots {
  private active = new Map<string, number>();
  private queue: QueueEntry[] = [];
  /** Called whenever a run starts or stops waiting, so the window can redraw the queue. */
  onChange: () => void = () => {};
  constructor(private limit: () => number) {}
  busy(provider: string) { return (this.active.get(provider) ?? 0) >= this.limit(); }
  acquire(provider: string, signal: AbortSignal, owner?: SlotOwner): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const abort = () => {
        this.queue = this.queue.filter(item => item !== entry);
        reject(signal.reason);
        if (entry.waited) this.onChange();
      };
      const entry: QueueEntry = {
        provider,
        owner,
        since: Date.now(),
        waited: false,
        grant: () => {
          signal.removeEventListener('abort', abort);
          this.active.set(provider, (this.active.get(provider) ?? 0) + 1);
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active.set(provider, (this.active.get(provider) ?? 1) - 1);
            this.drain();
          });
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      this.queue.push(entry);
      this.drain();
      // Only a run that has to wait changes what the queue shows; a free slot is taken without a word.
      if (this.queue.includes(entry)) {
        entry.waited = true;
        this.onChange();
      }
    });
  }
  /**
   * Every run waiting right now, in the order the queue will serve it. `ahead` counts only the runs waiting for
   * the same provider, because a free slot for one provider never goes to another.
   */
  waiting(): SlotWait[] {
    const aheadByProvider = new Map<string, number>();
    const waits: SlotWait[] = [];
    for (const entry of this.queue) {
      const ahead = aheadByProvider.get(entry.provider) ?? 0;
      aheadByProvider.set(entry.provider, ahead + 1);
      if (!entry.owner) continue;
      waits.push({ ...entry.owner, provider: entry.provider, ahead, since: entry.since });
    }
    return waits;
  }
  /** Grants every waiting entry whose provider has room, in queue order. */
  private drain() {
    let servedWaitingRun = false;
    for (const entry of [...this.queue]) {
      if (this.busy(entry.provider)) continue;
      this.queue = this.queue.filter(item => item !== entry);
      entry.grant();
      if (entry.waited) servedWaitingRun = true;
    }
    // A run leaving the line starts, and moves everyone behind it up one place.
    if (servedWaitingRun) this.onChange();
  }
}
