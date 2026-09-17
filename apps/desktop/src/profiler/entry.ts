import { ProfileInput } from '../shared/profiles';
import { analyze } from './analyze';
import { RunAuditInputError } from './run-audit';
const port = (process as unknown as { parentPort: { on(event: string, listener: (event: { data: unknown }) => void): void; postMessage(message: unknown): void } }).parentPort;
let started = false;
port.on('message', async ({ data }) => {
  if (started) return; started = true;
  try { port.postMessage({ ok: true, value: await analyze(ProfileInput.parse(data), process.argv[2]) }); }
  catch (error) { port.postMessage(error instanceof RunAuditInputError ? { ok: false, kind: 'run_audit_input', error: error.message } : { ok: false, error: 'Checker không đọc được dataset trong giới hạn 32 MB, 128 cột, 128 MB bộ nhớ và 20 giây. Kiểm tra định dạng hoặc chia nhỏ nguồn.' }); }
});
port.postMessage({ ready: true });
