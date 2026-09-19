import type { HarnessProgress, RunProgressUpdate } from '../../shared/progress';

/** At most this many milliseconds between live updates sent to the window. */
const SEND_INTERVAL_MS = 120;

/**
 * Sends a run's live progress to the window without flooding it: the first update goes out at once, later ones at
 * most every SEND_INTERVAL_MS, and the newest one always arrives. `close` sends whatever is still waiting on the
 * timer, then a final null so the live view ends.
 */
export class ProgressSender {
  private readonly startedAt = Date.now();
  private latest: HarnessProgress | null = null;
  private lastSentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly taskId: string,
    private readonly runId: string,
    private readonly send: (update: RunProgressUpdate) => void,
  ) {}

  /** The newest progress received, including updates that were not sent yet. */
  get lastProgress(): HarnessProgress | null {
    return this.latest;
  }

  update(progress: HarnessProgress) {
    if (this.closed) return;
    this.latest = progress;
    if (this.timer) return;

    const waitMs = this.lastSentAt + SEND_INTERVAL_MS - Date.now();
    if (waitMs <= 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => this.flush(), waitMs);
  }

  close() {
    if (this.closed) return;
    // A run that ends inside the throttle window still has its newest progress waiting on the timer. Sending it
    // first is what lets a short run show its answer at all: Codex reports whole items, so a quick one can put
    // its reasoning and its answer in the same window and lose the second one.
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.flush();
    }
    this.closed = true;
    this.send({ taskId: this.taskId, runId: this.runId, startedAt: this.startedAt, progress: null });
  }

  private flush() {
    this.timer = null;
    if (this.closed || !this.latest) return;
    this.lastSentAt = Date.now();
    this.send({ taskId: this.taskId, runId: this.runId, startedAt: this.startedAt, progress: this.latest });
  }
}
