/**
 * Turns a burst of "something changed" notices into as few runs of `work` as keep the screen right. A notice that
 * arrives while `work` is running asks for one more run after it, however many arrive; a notice that finds nothing
 * running starts one at once. Every notice is covered by a run that began after it, so nothing is lost.
 *
 * The core announces a change for each step of a run (a status, an event, an answer), and each announcement made the
 * window read the whole workspace and the open chat again: 20 to 30 full reads for one short message.
 */
export function coalesceRuns(work: () => Promise<unknown>): () => void {
  let running = false;
  let again = false;
  const start = async (): Promise<void> => {
    running = true;
    try {
      await work();
    } catch {
      // `work` reports its own failures; a failed run must not stop the next one.
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      await start();
    }
  };
  return () => {
    if (running) {
      again = true;
      return;
    }
    void start();
  };
}
