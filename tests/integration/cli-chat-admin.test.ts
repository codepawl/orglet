import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import { chatFields, type ChatActionClient, type ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { formatChats } from '../../apps/desktop/src/cli/output';
import { CliRequest, type ChatsValue, type ListValue, type SendValue } from '../../apps/desktop/src/cli/protocol';
import { parseSlash } from '../../apps/desktop/src/cli/slash';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { createCliToken } from '../../apps/desktop/src/main/cli-server';
import type { Artifact, Run, Task, TaskDetail, Workspace } from '../../apps/desktop/src/shared/contracts';

/** Chats themselves from the terminal (COD-354): listing, side threads, group chats, archive, delete and templates. */

const researcherId = '11111111-1111-4111-8111-111111111111';
const writerId = '22222222-2222-4222-8222-222222222222';
const crewId = '33333333-3333-4333-8333-333333333333';
const mainId = 'aaaa0000-0000-4000-8000-000000000000';
const sideId = 'bbbb0000-0000-4000-8000-000000000000';
const groupId = 'cccc0000-0000-4000-8000-000000000000';
const crewChatId = 'dddd0000-0000-4000-8000-000000000000';
const oldId = 'eeee0000-0000-4000-8000-000000000000';
const runId = 'f0000000-0000-4000-8000-000000000000';
const artifactId = 'f1000000-0000-4000-8000-000000000000';
const token = createCliToken();
const wait = { wait: false, timeoutSeconds: 5 };

function task(id: string, createdAt: string, extra: Partial<Task> = {}): Task {
  return { id, workerId: researcherId, brief: `brief of ${id.slice(0, 4)}`, status: 'completed', createdAt, budgetMicros: 300_000, sourceIds: [], consent: true, accepted: false, ...extra } as Task;
}

function workspace(): Workspace {
  return {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'openai' }, { id: writerId, name: 'Writer', provider: 'anthropic', taskBudgetMicros: 200_000 }],
    teams: [{ id: crewId, name: 'Review crew', memberIds: [researcherId], synthesizerId: writerId }],
    archivedWorkers: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Old helper', provider: 'demo' }],
    archivedTeams: [],
    tasks: [
      task(mainId, '2026-10-01T09:00:00.000Z'),
      task(sideId, '2026-10-01T10:00:00.000Z', { sideOf: { taskId: mainId, throughRevision: 0 }, title: 'Try again' }),
      task(groupId, '2026-10-01T11:00:00.000Z', { assignees: [researcherId, writerId] }),
      task(crewChatId, '2026-10-01T08:00:00.000Z', { workerId: writerId, teamId: crewId }),
      task(oldId, '2026-09-01T08:00:00.000Z', { archivedAt: '2026-09-02T08:00:00.000Z', title: 'Old notes' }),
    ],
  } as unknown as Workspace;
}

function sideDetail(): TaskDetail {
  const run = { id: runId, taskId: sideId, status: 'completed', startedAt: '2026-10-01T10:00:01.000Z', error: null, snapshot: { worker: { id: researcherId, name: 'Researcher' }, inputRevision: 0 } } as unknown as Run;
  const answer = { id: artifactId, runId, hash: 'x', createdAt: '2026-10-01T10:00:05.000Z', report: { format: 'chat', title: 'T', summary: 'side answer', findings: [], limitations: [] } } as unknown as Artifact;
  return { task: workspace().tasks[1], runs: [run], artifacts: [answer], sources: [] } as unknown as TaskDetail;
}

function fakeCore() {
  const calls: { command: string; args: unknown }[] = [];
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return workspace();
    if (command === 'task') {
      const id = (args as { id: string }).id;
      if (id === sideId) return sideDetail();
      return { task: workspace().tasks.find(item => item.id === id), runs: [], artifacts: [], sources: [] };
    }
    if (command === 'startSideThread') return sideId;
    if (command === 'createTask') return groupId;
    if (command === 'bringIntoMainChat') return mainId;
    if (command === 'createTemplate') return { id: crewId, name: 'Research Review', memberIds: [researcherId], synthesizerId: writerId };
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message, pollMilliseconds: 1 });
  const signal = new AbortController().signal;
  const argsOf = (command: string) => calls.find(call => call.command === command)?.args;
  return { calls, operations, signal, argsOf };
}

describe('orglet chat arguments', () => {
  it('parses chats, side threads, group chats and changes to chats, orglets and crews', () => {
    expect(parseArguments(['chats', '--archived'])).toEqual({ kind: 'chats', archived: true, json: false });
    expect(parseArguments(['read', '--chat', '#bbbb0000'])).toEqual({ kind: 'read', chat: 'bbbb0000', json: false });
    expect(parseArguments(['side', 'try this', '--to', 'Researcher', '--no-wait'])).toMatchObject({ kind: 'side', message: 'try this', to: 'Researcher', wait: false });
    expect(parseArguments(['bring', '--chat', 'bbbb', '--message', '1.1'])).toEqual({ kind: 'bring', chat: 'bbbb', message: '1.1', json: false });
    expect(parseArguments(['group', 'hello', '--with', 'Researcher', '--with', 'Writer'])).toMatchObject({ kind: 'group', names: ['Researcher', 'Writer'], message: 'hello' });
    expect(parseArguments(['members', '--chat', 'cccc', '--with', 'A', '--with=B'])).toEqual({ kind: 'members', chat: 'cccc', names: ['A', 'B'], json: false });
    expect(parseArguments(['rename', '--chat', 'bbbb', '--title', 'New'])).toEqual({ kind: 'chat-change', change: 'rename', chat: 'bbbb', title: 'New', json: false });
    expect(parseArguments(['archive', '--to', 'Researcher'])).toEqual({ kind: 'chat-change', change: 'archive', to: 'Researcher', json: false });
    expect(parseArguments(['restore', '--chat', 'eeee'])).toEqual({ kind: 'chat-change', change: 'restore', chat: 'eeee', json: false });
    expect(parseArguments(['delete', '--chat', 'eeee', '--confirm', 'Old notes'])).toEqual({ kind: 'chat-change', change: 'delete', chat: 'eeee', confirmName: 'Old notes', json: false });
    expect(parseArguments(['archive', 'crew', 'Review crew'])).toEqual({ kind: 'archive-entity', entity: 'team', name: 'Review crew', archived: true, json: false });
    expect(parseArguments(['restore', 'orglet', 'Old helper'])).toEqual({ kind: 'archive-entity', entity: 'worker', name: 'Old helper', archived: false, json: false });
    expect(parseArguments(['template', 'research-review', '--provider', 'demo'])).toEqual({ kind: 'template', templateId: 'research-review', provider: 'demo', json: false });
    expect(parseArguments(['delete', 'orglet', 'Writer', '--confirm', 'Writer'])).toMatchObject({ kind: 'delete', entity: 'worker' });
  });

  it('refuses mistakes as usage errors', () => {
    const mistakes = [['read', '--to', 'A', '--chat', 'bbbb'], ['read', '--chat', 'xyz'], ['group', 'hi', '--with', 'A'], ['members', '--with', 'A', '--with', 'B'],
      ['restore', '--to', 'A'], ['rename', '--to', 'A'], ['bring'], ['template', 'research-review'], ['template', 'other', '--provider', 'demo'],
      ['delete', '--chat', 'eeee'], ['archive', 'crew'], ['archive', 'orglet', 'A', '--to', 'B'], ['chats', '--to', 'A'], ['list', '--chat', 'bbbb'], ['status', '--archived']];
    for (const mistake of mistakes) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
  });

  it('reads the slash commands for the same', () => {
    expect(parseSlash('/chats archived')).toEqual({ kind: 'chats', archived: true });
    expect(parseSlash('/side try this')).toEqual({ kind: 'side', message: 'try this' });
    expect(parseSlash('/bring #1.1')).toEqual({ kind: 'bring', ref: '#1.1' });
    expect(parseSlash('/group Researcher, Writer -- compare')).toEqual({ kind: 'group', names: ['Researcher', 'Writer'], message: 'compare' });
    expect(parseSlash('/members Researcher, Writer')).toEqual({ kind: 'members', names: ['Researcher', 'Writer'] });
    expect(parseSlash('/rename Plans')).toEqual({ kind: 'rename', title: 'Plans' });
    for (const usage of ['/side', '/group Researcher -- hi', '/group A, B', '/members A', '/rename', '/bring x']) expect(parseSlash(usage).kind, usage).toBe('usage');
    expect(chatFields('#bbbb')).toEqual({ chat: 'bbbb' });
    expect(chatFields('Researcher')).toEqual({ to: 'Researcher' });
  });
});

describe('orglet chats in the app', () => {
  it('lists open or archived chats with their kind, short id and who answers', async () => {
    const core = fakeCore();
    const open = await core.operations.run({ op: 'chats', token, archived: false }, core.signal) as ChatsValue;
    expect(open.chats.map(row => [row.short, row.kind, row.name, row.with])).toEqual([
      ['cccc0000', 'group', 'brief of cccc', ['Researcher', 'Writer']],
      ['bbbb0000', 'side', 'Try again', ['Researcher']],
      ['aaaa0000', 'orglet', 'Researcher', ['Researcher']],
      ['dddd0000', 'crew', 'Review crew', ['Researcher', 'Writer']],
    ]);
    const archived = await core.operations.run({ op: 'chats', token, archived: true }, core.signal) as ChatsValue;
    expect(archived.chats.map(row => row.name)).toEqual(['Old notes']);
    expect(formatChats(archived)).toBe('  eeee0000  orglet  Old notes  Researcher  completed');
  });

  it('starts a side thread from an orglet main chat only, carrying no permission of its own', async () => {
    const core = fakeCore();
    const value = await core.operations.run({ op: 'side-thread', token, to: 'res', message: 'try another way', ...wait }, core.signal) as SendValue;
    expect(core.argsOf('startSideThread')).toEqual({ taskId: mainId, brief: 'try another way', sourceIds: [], excludedSources: [], consent: true, providerScopes: ['openai'], budgetMicros: 300_000 });
    expect(value.chat).toMatchObject({ name: 'Try again', taskId: sideId });
    await expect(core.operations.run({ op: 'side-thread', token, to: 'review', message: 'x', ...wait }, core.signal)).rejects.toThrow('Chat phụ chỉ bắt đầu');
    expect(CliRequest.safeParse({ op: 'side-thread', token, to: 'res', message: 'x', ...wait, toolCapabilities: ['web'] }).success).toBe(false);
  });

  it('brings a side thread answer into its main chat, and only an answer', async () => {
    const core = fakeCore();
    expect(await core.operations.run({ op: 'bring', token, chat: 'bbbb' }, core.signal)).toMatchObject({ mainTaskId: mainId, ref: '1.1', chat: { name: 'Researcher' } });
    expect(core.argsOf('bringIntoMainChat')).toEqual({ artifactId });
    await expect(core.operations.run({ op: 'bring', token, chat: 'bbbb', message: '1' }, core.signal)).rejects.toThrow('Chọn một câu trả lời');
    await expect(core.operations.run({ op: 'bring', token, chat: 'aaaa' }, core.signal)).rejects.toThrow('chat phụ');
  });

  it('starts a group chat, sends into it by id and changes its members', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'group', token, names: ['writer', 'Researcher', 'Writer'], message: 'compare', ...wait }, core.signal);
    expect(core.argsOf('createTask')).toEqual({ workerId: writerId, assignees: [writerId, researcherId], brief: 'compare', sourceIds: [], excludedSources: [], consent: true, providerScopes: ['anthropic', 'openai'], budgetMicros: 200_000 });
    await expect(core.operations.run({ op: 'group', token, names: ['Writer', 'writer'], message: 'x', ...wait }, core.signal)).rejects.toThrow('hai Tí khác nhau');
    await core.operations.run({ op: 'send', token, chat: 'cccc', message: 'again', files: [], ...wait }, core.signal);
    expect(core.argsOf('reviseTask')).toMatchObject({ taskId: groupId, brief: 'again', providerScopes: ['openai', 'anthropic'], budgetMicros: 300_000 });
    await core.operations.run({ op: 'members', token, chat: 'cccc', names: ['Researcher', 'Writer'] }, core.signal);
    expect(core.argsOf('updateTask')).toEqual({ id: groupId, title: '', assignee: { kind: 'workers', workerIds: [researcherId, writerId] }, budgetMicros: 300_000 });
    await expect(core.operations.run({ op: 'members', token, chat: 'aaaa', names: ['Researcher', 'Writer'] }, core.signal)).rejects.toThrow('chat nhóm');
  });

  it('renames, archives, restores and deletes a chat, deleting only with its exact name', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'chat-change', token, chat: 'bbbb', change: 'rename', title: 'Plan B' }, core.signal);
    expect(core.argsOf('renameTask')).toEqual({ id: sideId, title: 'Plan B' });
    await core.operations.run({ op: 'chat-change', token, to: 'Researcher', change: 'archive' }, core.signal);
    expect(core.argsOf('archiveTask')).toEqual({ id: mainId, archived: true });
    await expect(core.operations.run({ op: 'chat-change', token, to: 'Researcher', change: 'restore' }, core.signal)).rejects.toThrow('--chat');
    await expect(core.operations.run({ op: 'chat-change', token, chat: 'eeee', change: 'delete', confirmName: 'old notes' }, core.signal)).rejects.toThrow('Old notes');
    expect(core.calls.some(call => call.command === 'deleteTask')).toBe(false);
    await core.operations.run({ op: 'chat-change', token, chat: 'eeee', change: 'delete', confirmName: 'Old notes' }, core.signal);
    expect(core.argsOf('deleteTask')).toEqual({ id: oldId });
    await expect(core.operations.run({ op: 'read', token, to: 'Researcher', chat: 'aaaa' }, core.signal)).rejects.toThrow('chỉ một trong hai');
  });

  it('archives and restores orglets and crews by full name, and makes a crew from a template', async () => {
    const core = fakeCore();
    expect(await core.operations.run({ op: 'archive-entity', token, kind: 'team', name: 'review crew', archived: true }, core.signal)).toEqual({ kind: 'team', id: crewId, name: 'Review crew', archived: true });
    expect(await core.operations.run({ op: 'archive-entity', token, kind: 'worker', name: 'Old helper', archived: false }, core.signal)).toMatchObject({ name: 'Old helper', archived: false });
    await expect(core.operations.run({ op: 'archive-entity', token, kind: 'worker', name: 'Old helper', archived: true }, core.signal)).rejects.toThrow('đang hoạt động');
    expect(await core.operations.run({ op: 'template', token, templateId: 'research-review', provider: 'demo' }, core.signal)).toEqual({ id: crewId, name: 'Research Review', members: ['Researcher', 'Writer'] });
    expect(core.argsOf('createTemplate')).toEqual({ templateId: 'research-review', provider: 'demo' });
  });
});

const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'openai', providerId: 'openai', color: '#4f7fe0' }], crews: [] };

async function notUsed(): Promise<never> {
  throw new Error('Not used in this test.');
}

/** A fake app that knows one side thread, so the terminal can open it by id. */
function adminClient() {
  const calls: string[] = [];
  const chat = { kind: 'worker' as const, id: 'w', name: 'Researcher', color: '#4f7fe0' };
  const sideChat = { ...chat, name: 'Try again', taskId: sideId };
  const turnValue = (value: Partial<SendValue>): SendValue => ({ chat, taskId: 't', waited: true, finished: true, status: 'completed', answers: [], errors: [], ...value });
  const actions: ChatActionClient = {
    history: notUsed, reply: notUsed, react: notUsed, forward: notUsed, control: notUsed, answer: notUsed,
    chats: async archived => {
      calls.push(`chats ${archived}`);
      return { chats: [{ id: sideId, short: 'bbbb0000', kind: 'side', name: 'Try again', with: ['Researcher'], status: 'completed', archived: false, createdAt: '1' }] };
    },
    side: async (to, message) => {
      calls.push(`side ${to} ${message}`);
      return turnValue({ chat: sideChat, answers: [{ name: 'Researcher', text: 'Side answer.', createdAt: '1' }] });
    },
    bring: async (chatId, message) => {
      calls.push(`bring ${chatId} ${message}`);
      return { mainTaskId: mainId, chat, ref: '1.1' };
    },
    group: async (names, message) => {
      calls.push(`group ${names.join('|')} ${message}`);
      return turnValue({ chat: { ...chat, name: 'compare', taskId: groupId }, answers: [{ name: 'Writer', text: 'Group answer.', createdAt: '1' }] });
    },
    members: async (chatId, names) => {
      calls.push(`members ${chatId} ${names.join('|')}`);
      return { taskId: chatId, names };
    },
    rename: async (to, title) => {
      calls.push(`rename ${to} ${title}`);
      return { taskId: sideId, name: 'Try again', change: 'rename', title };
    },
    archive: async to => {
      calls.push(`archive ${to}`);
      return { taskId: sideId, name: 'Try again', change: 'archive' };
    },
    // Schedules have their own tests in cli-schedules.test.ts.
    schedules: notUsed,
    enableSchedule: notUsed,
    runSchedule: notUsed,
  };
  const client: ChatClient = {
    list: async () => list,
    send: async to => {
      calls.push(`send ${to}`);
      return turnValue({ answers: [{ name: 'Researcher', text: `Answer in ${to}.`, createdAt: '1' }] });
    },
    read: notUsed,
    open: notUsed,
    actions,
  };
  return { client, calls };
}

async function adminSession(script: string) {
  const input = new PassThrough();
  let transcript = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      transcript += chunk.toString();
      callback();
    },
  });
  const fake = adminClient();
  const running = runInteractive({ input, output, client: fake.client, mode: 'none', version: '9.9.9', terminal: false, to: 'Researcher' });
  input.end(script);
  const code = await running;
  return { code, transcript, calls: fake.calls };
}

describe('orglet chat session and the chats themselves', () => {
  it('starts a side thread, opens it by id, and acts on it there', async () => {
    const result = await adminSession('/side try another way\n/chats\n/to #bbbb\nmore please\n/bring\n/rename Plan B\n/archive\n/exit\n');
    expect(result.calls).toEqual(['side Researcher try another way', 'chats false', 'chats false', 'send #bbbb0000', 'bring bbbb0000 undefined', 'rename #bbbb0000 Plan B', 'archive #bbbb0000']);
    expect(result.transcript).toContain('Side answer.');
    expect(result.transcript).toContain('/to #bbbb0000 opens this chat.');
    expect(result.transcript).toContain('bbbb0000  side  Try again  Researcher  completed');
    expect(result.transcript).toContain('Answer in #bbbb0000.');
    expect(result.transcript).toContain('Brought #1.1 into the main chat with Researcher.');
    expect(result.transcript).toContain('Renamed the chat to Plan B.');
  });

  it('starts a group chat and changes its members, and needs an opened chat for /bring', async () => {
    const result = await adminSession('/bring\n/group Researcher, Writer -- compare\n/members Researcher, Writer\n/exit\n');
    expect(result.calls).toEqual(['group Researcher|Writer compare']);
    expect(result.transcript).toContain('Open the chat with /to #id first');
    expect(result.transcript).toContain('Group answer.');
    expect(result.transcript).toContain('/to #cccc0000 opens this chat.');
  });
});
