import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { DecisionQuestions, DecisionState } from '../../shared/decisions';
import { isVerified, type PinnedFile } from './download';
import { TacetEngine } from './engine';

/**
 * The decisions worker thread (COD-303), built to `decisions.js` next to `core.js`. It checks both model files against
 * their pinned SHA-256 before loading them, then answers requests one at a time until the core ends it.
 */

const WorkerInput = z.object({
  model: z.object({ path: z.string(), file: z.object({ name: z.string(), url: z.string(), sha256: z.string(), bytes: z.number() }) }),
  tokenizer: z.object({ path: z.string(), file: z.object({ name: z.string(), url: z.string(), sha256: z.string(), bytes: z.number() }) }),
});
const Request = z.object({ id: z.number().int(), state: DecisionState, questions: DecisionQuestions, maxLength: z.number().int().min(256).max(4096) });

async function start() {
  const input = WorkerInput.parse(workerData);
  const pinned: [string, PinnedFile][] = [[input.model.path, input.model.file], [input.tokenizer.path, input.tokenizer.file]];
  for (const [path, file] of pinned) {
    if (!await isVerified(path, file)) throw new Error('Tệp của Tacet trên máy không khớp với bản đã ghim. Xóa rồi tải lại trong Cài đặt.');
  }
  return TacetEngine.load({ model: input.model.path, tokenizer: input.tokenizer.path });
}

const port = parentPort!;
const ready = start();
ready.then(() => port.postMessage({ type: 'ready' }), error => port.postMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) }));
port.on('message', async message => {
  const request = Request.safeParse(message);
  if (!request.success) return;
  try {
    const engine = await ready;
    const response = await engine.decide(request.data.state, request.data.questions, request.data.maxLength);
    port.postMessage({ type: 'answer', id: request.data.id, response });
  } catch (error) {
    port.postMessage({ type: 'error', id: request.data.id, error: error instanceof Error ? error.message : String(error) });
  }
});
