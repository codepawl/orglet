import { z } from 'zod';
import { BrowserEngine } from './engine';
import { detectBrowser } from './detect';

/**
 * The browser host process (COD-261), started by main the first time a run or Settings needs the browser. It gets
 * no API keys and no secrets: only the folder that holds the named profiles. Each message is one request from the
 * core (relayed by main) or from main itself; a cancel stops the request with that id.
 */
type ParentPort = { postMessage(message: unknown): void; on(event: 'message', callback: (event: { data: unknown }) => void): void };
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const profilesRoot = z.string().min(1).parse(process.argv[2]);
// Frames, the cursor, suggestions and a closed Chrome window go to main as they happen, outside any request.
const engine = new BrowserEngine({ profilesRoot, browser: () => detectBrowser(), emit: event => port.postMessage({ event }) });
const running = new Map<string, AbortController>();

const Envelope = z.union([
  z.object({ id: z.string().min(1).max(100), request: z.unknown() }).strict(),
  z.object({ id: z.string().min(1).max(100), cancel: z.literal(true) }).strict(),
  z.object({ shutdown: z.literal(true) }).strict(),
]);

port.on('message', async ({ data }) => {
  const parsed = Envelope.safeParse(data);
  if (!parsed.success) return;
  const envelope = parsed.data;
  if ('shutdown' in envelope) {
    await engine.shutdown();
    port.postMessage({ shutdown: true });
    return;
  }
  if ('cancel' in envelope) {
    running.get(envelope.id)?.abort(new Error('Đã dừng bước trình duyệt.'));
    return;
  }
  const controller = new AbortController();
  running.set(envelope.id, controller);
  try {
    const value = await engine.handle(envelope.request, controller.signal);
    port.postMessage({ id: envelope.id, ok: true, value });
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Yêu cầu trình duyệt không hợp lệ.' : error instanceof Error ? error.message.split('\n')[0].slice(0, 500) : 'Trình duyệt gặp lỗi.';
    port.postMessage({ id: envelope.id, ok: false, error: message });
  } finally {
    running.delete(envelope.id);
  }
});
port.postMessage({ ready: true });
