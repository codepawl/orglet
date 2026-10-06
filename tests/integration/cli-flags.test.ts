import { describe, expect, it } from 'vitest';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import { CliRequest, type LibraryValue } from '../../apps/desktop/src/cli/protocol';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import type { Task, Workspace } from '../../apps/desktop/src/shared/contracts';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';

/** One flag for one thing: `--rename` renames, `--confirm` confirms a delete, and `--file` attaches to a message. */

const researcherId = '11111111-1111-4111-8111-111111111111';
const mainId = 'aaaa0000-0000-4000-8000-000000000000';
const sideId = 'bbbb0000-0000-4000-8000-000000000000';
const channelId = 'c1c10000-0000-4000-8000-000000000000';
const groupId = 'cccc0000-0000-4000-8000-000000000000';
const memoryId = 'a1a1a1a1-0000-4000-8000-000000000000';
const token = 'a'.repeat(64);
const signal = new AbortController().signal;
const wait = { wait: false, timeoutSeconds: 5 };

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, workerId: researcherId, brief: 'brief', status: 'completed', createdAt: '2026-10-01T09:00:00.000Z', budgetMicros: 300_000, sourceIds: [], consent: true, accepted: false, ...extra } as Task;
}

function memory(): Knowledge {
  return { id: memoryId, title: 'T', content: 'Prefers short answers', tags: [], pinned: false, scope: { type: 'worker', id: researcherId }, kind: 'memory', revision: 1, status: 'approved', hash: 'x'.repeat(64), provenance: { kind: 'user' }, createdAt: '2026-10-01T10:00:00.000Z' } as Knowledge;
}

function fakeCore() {
  const calls: { command: string; args: unknown }[] = [];
  const workspace = {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'openai' }],
    teams: [],
    tasks: [task(mainId)],
    knowledge: [memory()],
    spaces: [],
  } as unknown as Workspace;
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return workspace;
    if (command === 'task') return { task: { ...task(mainId), channel: undefined }, runs: [], artifacts: [], sources: [] };
    if (command === 'importSources') return (args as string[]).map((path, index) => ({ id: `imported-${index}`, name: path }));
    if (command === 'startSideThread') return sideId;
    if (command === 'createChannel') return channelId;
    if (command === 'createTask') return groupId;
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message, pollMilliseconds: 1 });
  const argsOf = (command: string) => calls.find(call => call.command === command)?.args;
  const sent = (command: string) => calls.some(call => call.command === command);
  return { calls, operations, argsOf, sent };
}

describe('--rename renames, and --title still does', () => {
  it('takes either spelling for a chat, and refuses both or neither', () => {
    const expected = { kind: 'chat-change', change: 'rename', chat: 'bbbb', title: 'New', json: false };
    expect(parseArguments(['rename', '--chat', 'bbbb', '--rename', 'New'])).toEqual(expected);
    expect(parseArguments(['rename', '--chat', 'bbbb', '--title', 'New'])).toEqual(expected);
    expect(() => parseArguments(['rename', '--chat', 'bbbb', '--rename', 'A', '--title', 'B'])).toThrow(UsageError);
    expect(() => parseArguments(['rename', '--chat', 'bbbb'])).toThrow('Renaming needs --rename');
  });

  it('keeps --rename for schedules and spaces, and rejects it where nothing renames', () => {
    expect(parseArguments(['space', 'edit', 'Launch', '--rename', 'Liftoff'])).toMatchObject({ kind: 'space', rename: 'Liftoff' });
    expect(parseArguments(['schedule', 'edit', 'Morning', '--rename', 'Evening'])).toMatchObject({ kind: 'schedule-save' });
    expect(() => parseArguments(['send', 'hi', '--to', 'R', '--rename', 'x'])).toThrow(UsageError);
  });
});

describe('--confirm deletes a memory, and --yes still does', () => {
  it('parses either way and refuses none or both', () => {
    expect(parseArguments(['memory', 'delete', '#a1a1', '--yes'])).toEqual({ kind: 'memory-delete', id: 'a1a1', json: false });
    expect(parseArguments(['memory', 'delete', 'a1a1', '--confirm', 'a1a1a1a1'])).toEqual({ kind: 'memory-delete', id: 'a1a1', confirm: 'a1a1a1a1', json: false });
    for (const mistake of [['memory', 'delete', 'a1a1'], ['memory', 'delete', 'a1a1', '--yes', '--confirm', 'x'], ['memory', 'edit', 'a1a1', '--confirm', 'x', '--pin'], ['send', 'hi', '--to', 'R', '--confirm', 'x']]) {
      expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    }
  });

  it('deletes when the typed text is the memory\'s id, the id as printed, or its exact text', async () => {
    for (const confirm of [memoryId, memoryId.slice(0, 8), `#${memoryId.slice(0, 8)}`, 'Prefers short answers']) {
      const core = fakeCore();
      const value = await core.operations.run({ op: 'memory-delete', token, id: 'a1a1', confirm }, signal) as LibraryValue;
      expect(core.argsOf('deleteMemory'), confirm).toEqual({ id: memoryId });
      expect(value.items[0].id).toBe(memoryId);
    }
  });

  it('refuses and deletes nothing when the typed text is something else', async () => {
    for (const confirm of ['prefers', 'a1a1a1', '']) {
      const core = fakeCore();
      await expect(core.operations.run({ op: 'memory-delete', token, id: 'a1a1', confirm: confirm || 'x' }, signal)).rejects.toThrow('--confirm');
      expect(core.sent('deleteMemory')).toBe(false);
    }
  });

  it('does not take a delete at all from a request that confirms nothing', () => {
    expect(CliRequest.safeParse({ op: 'memory-delete', token, id: 'a1a1' }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'memory-delete', token, id: 'a1a1', confirmed: false }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'memory-delete', token, id: 'a1a1', confirm: 'x' }).success).toBe(true);
    expect(CliRequest.safeParse({ op: 'memory-delete', token, id: 'a1a1', confirmed: true }).success).toBe(true);
  });

  it('still deletes with the older confirmation', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'memory-delete', token, id: 'a1a1', confirmed: true }, signal);
    expect(core.sent('deleteMemory')).toBe(true);
  });
});

describe('--file attaches to a side thread and to a channel\'s first message', () => {
  it('parses --file for side and channel, and keeps it off answer', () => {
    expect(parseArguments(['side', 'try', '--to', 'Researcher', '--file', 'a.txt', '--file', 'b.txt'])).toMatchObject({ kind: 'side', files: ['a.txt', 'b.txt'] });
    expect(parseArguments(['side', 'try', '--to', 'Researcher'])).not.toHaveProperty('files');
    expect(parseArguments(['channel', 'hello', '--with', 'Researcher', '--file', 'a.txt'])).toMatchObject({ kind: 'channel', files: ['a.txt'] });
    expect(parseArguments(['group', 'hello', '--with', 'Researcher', '--file', 'a.txt'])).toMatchObject({ kind: 'channel', files: ['a.txt'] });
    expect(() => parseArguments(['answer', '1', '--to', 'R', '--file', 'a.txt'])).toThrow('--file belongs to');
    // A file goes with a message; a channel made with only a name has none.
    expect(() => parseArguments(['channel', '--name', 'ideas', '--with', 'Researcher', '--file', 'a.txt'])).toThrow(UsageError);
    expect(() => parseArguments(['side', 'x', '--to', 'R', ...Array.from({ length: 21 }, () => ['--file', 'a.txt']).flat()])).toThrow('Attach at most');
  });

  it('imports the files and starts the side thread with their ids', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'side-thread', token, to: 'Researcher', message: 'try this', files: ['C:/work/a.txt'], ...wait }, signal);
    expect(core.argsOf('importSources')).toEqual(['C:/work/a.txt']);
    expect(core.argsOf('startSideThread')).toMatchObject({ taskId: mainId, sourceIds: ['imported-0'] });
  });

  it('imports the files and sends them with the first message of the channel', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'channel', token, names: ['Researcher'], message: 'hello', files: ['C:/work/a.txt', 'C:/work/b.txt'], ...wait }, signal);
    expect(core.argsOf('createTask')).toMatchObject({ channelId, sourceIds: ['imported-0', 'imported-1'] });
  });

  it('attaches nothing, and imports nothing, when no file is named', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'side-thread', token, to: 'Researcher', message: 'try this', ...wait }, signal);
    expect(core.argsOf('startSideThread')).toMatchObject({ sourceIds: [] });
    expect(core.sent('importSources')).toBe(false);
  });

  it('makes no channel when files come without a message', async () => {
    const core = fakeCore();
    await expect(core.operations.run({ op: 'channel', token, names: ['Researcher'], name: 'ideas', files: ['C:/work/a.txt'], ...wait }, signal)).rejects.toThrow('Tệp đi kèm');
    expect(core.sent('createChannel')).toBe(false);
  });
});
