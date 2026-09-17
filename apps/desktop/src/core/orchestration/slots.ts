/**
 * Workspace-wide cap on in-flight model requests per provider. Team and task limits alone allow
 * several tasks to hit one API key at once; this queue keeps that bounded and cancellable.
 */
export class ProviderSlots {
  private active = new Map<string, number>();
  private queue: { provider: string; grant: () => void }[] = [];
  constructor(private limit: () => number) {}
  busy(provider: string) { return (this.active.get(provider) ?? 0) >= this.limit(); }
  acquire(provider: string, signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const abort = () => { this.queue = this.queue.filter(item => item !== entry); reject(signal.reason); };
      const entry = {
        provider,
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
    });
  }
  private drain() {
    for (const entry of [...this.queue]) {
      if (this.busy(entry.provider)) continue;
      this.queue = this.queue.filter(item => item !== entry);
      entry.grant();
    }
  }
}
