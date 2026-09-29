import { Worker } from 'node:worker_threads';
import type { DecisionResponse } from '../../shared/decisions';
import type { DecisionRuntime, DecisionRuntimeFactory } from './service';

/** Loading checks two hashes and builds a 256k-token vocabulary; well past this, something is wrong. */
const LOAD_TIMEOUT_MS = 60_000;
/** The longest request (4096 tokens) takes seconds on a slow CPU, never minutes. */
const ANSWER_TIMEOUT_MS = 120_000;

type Pending = { resolve: (response: DecisionResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/**
 * The model in its own worker thread, started from `decisions.js` beside the core's bundle. The core's thread only
 * posts a request and waits, so the IPC it serves for the window never stalls behind a forward pass.
 */
export function workerRuntime(scriptPath: string): DecisionRuntimeFactory {
  return files => new Promise<DecisionRuntime>((resolve, reject) => {
    const worker = new Worker(scriptPath, { workerData: files, stdout: true, stderr: true });
    worker.stdout.resume();
    worker.stderr.resume();
    const pending = new Map<number, Pending>();
    let nextId = 1;
    let loaded = false;
    const failAll = (error: Error) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
    };
    const loadTimer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Tacet không tải xong trong một phút.'));
    }, LOAD_TIMEOUT_MS);
    const runtime: DecisionRuntime = {
      decide: (state, questions, maxLength) => new Promise((resolveAnswer, rejectAnswer) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectAnswer(new Error('Tacet không trả lời kịp.'));
        }, ANSWER_TIMEOUT_MS);
        pending.set(id, { resolve: resolveAnswer, reject: rejectAnswer, timer });
        worker.postMessage({ id, state, questions, maxLength });
      }),
      close: async () => {
        failAll(new Error('Tacet đã được gỡ khỏi bộ nhớ.'));
        await worker.terminate();
      },
    };
    worker.on('message', (message: { type: string; id?: number; response?: DecisionResponse; error?: string }) => {
      if (message.type === 'ready') {
        loaded = true;
        clearTimeout(loadTimer);
        resolve(runtime);
        return;
      }
      if (message.type === 'failed') {
        clearTimeout(loadTimer);
        void worker.terminate();
        reject(new Error(message.error ?? 'Không mở được Tacet.'));
        return;
      }
      const request = message.id === undefined ? undefined : pending.get(message.id);
      if (!request) return;
      pending.delete(message.id!);
      clearTimeout(request.timer);
      if (message.type === 'answer' && message.response) request.resolve(message.response);
      else request.reject(new Error(message.error ?? 'Tacet gặp lỗi.'));
    });
    worker.on('error', (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      clearTimeout(loadTimer);
      failAll(failure);
      if (!loaded) reject(failure);
    });
    worker.on('exit', () => {
      clearTimeout(loadTimer);
      failAll(new Error('Tacet đã dừng.'));
      if (!loaded) reject(new Error('Tacet đã dừng trước khi tải xong.'));
    });
  });
}
