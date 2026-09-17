import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ProfileInput, DatasetProfile } from '../shared/profiles';

const active = new Map<string, Electron.UtilityProcess>();
export function cancelProfile(id: string) { active.get(id)?.kill(); }
export function stopProfiles() { for (const child of active.values()) child.kill(); }
export async function executeProfile(id: string, raw: unknown): Promise<DatasetProfile> {
  const input = ProfileInput.parse(raw);
  if (active.size >= 2) throw new Error('Hai checker đang hoạt động. Thử lại sau.');
  return new Promise((resolve, reject) => {
    const scratch = mkdtempSync(join(tmpdir(), 'orglet-profile-'));
    // Parser process receives no API credentials or inherited secret environment variables.
    const child = utilityProcess.fork(join(__dirname, 'profiler.js'), [scratch], { serviceName: 'Orglet Dataset Checker', stdio: 'pipe', env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' } });
    active.set(id, child);
    let settled = false;
    const finish = (error?: Error, value?: DatasetProfile) => {
      if (settled) return; settled = true; clearTimeout(timer); active.delete(id); child.kill();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error('Checker vượt giới hạn 20 giây. Chia nhỏ nguồn và thử lại.')), 20_000);
    child.on('message', message => {
      if (message.ready) { child.postMessage(input); return; }
      const result = DatasetProfile.safeParse(message.value);
      if (message.ok && result.success) finish(undefined, result.data);
      else if (message.kind === 'run_audit_input' && typeof message.error === 'string' && message.error.length <= 500) finish(new Error(message.error));
      else finish(new Error('Checker không đọc được dữ liệu trong giới hạn cho phép. Kiểm tra định dạng, tên cột ID hoặc chia nhỏ nguồn.'));
    });
    child.on('exit', () => {
      // Also clean selected-source copies after timeout/cancel/native crash.
      void rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      finish(new Error('Checker đã dừng hoặc bị hủy. Không có kết quả được xác nhận.'));
    });
  });
}
