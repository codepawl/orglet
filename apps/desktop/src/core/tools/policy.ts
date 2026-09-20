import type { Run, Task } from '../../shared/contracts';
import { snapshotCapabilities, type ToolCapability } from '../../shared/tool-policy';

export function hasCapability(run: Run, task: Task, capability: ToolCapability): boolean {
  const frozen = run.snapshot.toolCapabilities ?? snapshotCapabilities(run.snapshot.worker.provider);
  const current = task.toolCapabilities ?? snapshotCapabilities(run.snapshot.worker.provider);
  return frozen.includes(capability) && current.includes(capability);
}

export function assertCapability(run: Run, task: Task, capability: ToolCapability): void {
  if (!hasCapability(run, task, capability)) throw new Error('Quyền công cụ chưa được cấp hoặc đã bị thu hồi.');
}

/** Read tools may finish their IO after cancellation, but must never expose that result. */
export async function executeReadTool<Result>(options: {
  signal: AbortSignal;
  timeoutMs: number;
  authorize: () => void;
  execute: (signal: AbortSignal) => Promise<Result> | Result;
}): Promise<Result> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(new Error('Công cụ chạy quá thời gian cho phép.')), options.timeoutMs);
  let onAbort: () => void = () => {};
  try {
    signal.throwIfAborted();
    options.authorize();
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const result = await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted();
      return options.execute(signal);
    }), aborted]);
    signal.throwIfAborted();
    options.authorize();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
