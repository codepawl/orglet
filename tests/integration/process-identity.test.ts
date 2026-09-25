import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseStartTimes, readStartTimesNow, StartTimeReader, stillOurs } from '../../apps/desktop/src/core/tools/process-identity';

let reader: StartTimeReader | undefined;
let child: ChildProcess | undefined;

afterEach(() => {
  reader?.close();
  child?.kill();
  reader = undefined;
  child = undefined;
});

/** A process that waits, so its id and creation time can be read while it lives. */
function startSleeper() {
  child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
  return child.pid!;
}

async function stopSleeper() {
  const exited = new Promise(resolve => child!.once('exit', resolve));
  child!.kill();
  await exited;
}

it('stops only a process whose id and creation time both still match', () => {
  const reported = [
    { pid: 101, startedAt: '638000000000000001' },
    { pid: 202, startedAt: '638000000000000002' },
    { pid: 303, startedAt: '638000000000000003' },
  ];
  const live = new Map([
    // Still the server Orglet started.
    [101, '638000000000000001'],
    // The id now belongs to another program, created later.
    [202, '638999999999999999'],
    // 303 is gone.
  ]);
  expect(stillOurs(reported, live)).toEqual([101]);
  // Nothing could be read (the lookup timed out or failed): nothing is stopped.
  expect(stillOurs(reported, new Map())).toEqual([]);
  expect(stillOurs([], live)).toEqual([]);
});

it('reads the lookup output and drops lines it cannot use', () => {
  const windows = parseStartTimes('1234 638950123456789012\r\n5678 -\r\n9012 \r\n\r\n');
  expect([...windows]).toEqual([[1234, '638950123456789012']]);
  const posix = parseStartTimes('  4321 Thu Sep 25 17:30:01 2026\n');
  expect(posix.get(4321)).toBe('Thu Sep 25 17:30:01 2026');
});

// The waits below are generous because a cold CI runner can take seconds to start PowerShell once; they are bounded
// by the reader's own 30 s limit and the test's 60 s.
it('reads a live process with one reused lookup process, and nothing once the process exited', { timeout: 60_000 }, async () => {
  const pid = startSleeper();
  reader = new StartTimeReader();
  const first = await reader.read([pid]);
  expect(first.get(pid)).toMatch(/\S/);
  const helper = reader.helperPid;
  const [again, missing] = await Promise.all([reader.read([pid]), reader.read([999_999_999])]);
  expect(again.get(pid)).toBe(first.get(pid));
  expect(missing.size).toBe(0);
  if (process.platform === 'win32') expect(reader.helperPid).toBe(helper);
  // The quit-time lookup, as main runs it, reads the same value, so the process is confirmed as ours.
  const atQuit = readStartTimesNow([pid], process.platform, 20_000);
  expect(stillOurs([{ pid, startedAt: first.get(pid)! }], atQuit)).toEqual([pid]);
  await stopSleeper();
  expect((await reader.read([pid])).get(pid)).toBeUndefined();
});

it('confirms nothing when the quit-time lookup runs out of time', () => {
  const pid = process.pid;
  expect(readStartTimesNow([pid], process.platform, 1).size).toBe(0);
});
