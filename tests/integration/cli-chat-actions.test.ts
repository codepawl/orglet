import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../apps/desktop/src/cli/run';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import type { ChatActionClient, ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { formatTurns } from '../../apps/desktop/src/cli/output';
import { cliEndpoint, CliRequest, type ControlValue, type ListValue, type ReadValue, type SendValue } from '../../apps/desktop/src/cli/protocol';
import { parseSlash } from '../../apps/desktop/src/cli/slash';
import { chatTurns, resolveMessage } from '../../apps/desktop/src/main/cli-chat-history';
import { CliFailure, CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { answerLine, CliServer, createCliToken, writeCliToken } from '../../apps/desktop/src/main/cli-server';
import type { Artifact, Run, Task, TaskDetail, Workspace } from '../../apps/desktop/src/shared/contracts';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';

/** The terminal's chat actions (COD-354): history, replies, reactions, forwards, controls and answers. */

const workerId = '11111111-1111-4111-8111-111111111111';
const writerId = '22222222-2222-4222-8222-222222222222';
const taskId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const runIds = ['a0000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000000'];
const artifactIds = ['b0000000-0000-4000-8000-000000000000', 'b1000000-0000-4000-8000-000000000000', 'b2000000-0000-4000-8000-000000000000'];

function run(index: number, revision: number, extra: Partial<Run> = {}): Run {
  return {
    id: runIds[index], taskId, status: 'completed', startedAt: `2026-10-01T10:0${index}:00.000Z`, error: null,
    snapshot: { worker: { id: workerId, name: 'Researcher', provider: 'openai' }, inputRevision: revision, input: { brief: `message ${revision + 1}`, sourceIds: [] } },
    ...extra,
  } as unknown as Run;
}

function artifact(index: number, summary: string): Artifact {
  return { id: artifactIds[index], runId: runIds[index], hash: 'x', createdAt: `2026-10-01T10:0${index}:30.000Z`, report: { format: 'chat', title: 'T', summary, findings: [], limitations: [] } } as unknown as Artifact;
}

/** A chat of three turns: the second replied to the first answer, and the person reacted to the third answer. */
function chatDetail(task: Partial<Task> = {}, runs?: Run[]): TaskDetail {
  const reply = { brief: 'message 2', sourceIds: [], replyTo: artifactIds[0] };
  const allRuns = runs ?? [run(0, 0), { ...run(1, 1), snapshot: { ...run(1, 1).snapshot, input: reply } } as Run, run(2, 2)];
  return {
    task: {
      id: taskId, workerId, status: 'completed', createdAt: '2026-10-01T10:00:00.000Z', budgetMicros: 500_000, sourceIds: [], brief: 'message 1', inputRevision: 2,
      currentInput: { brief: 'message 3', sourceIds: [] },
      messageReactions: [{ messageId: artifactIds[2], emoji: 'agree', actor: 'user', createdAt: '2026-10-01T10:03:00.000Z' }],
      ...task,
    },
    runs: allRuns,
    artifacts: [artifact(0, 'answer 1'), artifact(1, 'answer 2'), artifact(2, 'answer 3')],
    sources: [],
  } as unknown as TaskDetail;
}

function fakeCore(detail: () => TaskDetail) {
  const calls: { command: string; args: unknown }[] = [];
  const workspace = {
    workers: [{ id: workerId, name: 'Researcher', provider: 'openai' }, { id: writerId, name: 'Writer', provider: 'openai' }],
    teams: [],
    tasks: [detail().task],
  } as unknown as Workspace;
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return { ...workspace, tasks: [detail().task] };
    if (command === 'task') return detail();
    if (command === 'importSources') return (args as string[]).map((path, index) => ({ id: `imported-${index}`, name: path }));
    if (command === 'forwardMessage') return { sent: [{ target: { kind: 'worker', id: writerId }, taskId: 'other' }], failed: [] };
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message, pollMilliseconds: 1 });
  const signal = new AbortController().signal;
  return { calls, operations, signal, commands: () => calls.map(call => call.command).filter(command => command !== 'workspace' && command !== 'task') };
}

const token = createCliToken();
const wait = { wait: true, timeoutSeconds: 5 };

describe('orglet chat action arguments', () => {
  it('revises only explicitly numbered user messages, with normal targeting and wait options', () => {
    expect(parseArguments(['revise', 'corrected', '--chat', taskId, '--message', '#2', '--no-wait', '--timeout', '8', '--json'])).toEqual({ kind: 'revise', text: 'corrected', chat: taskId, message: '#2', wait: false, timeoutSeconds: 8, json: true });
    expect(parseSlash('/revise #2 corrected words')).toEqual({ kind: 'revise', ref: '#2', text: 'corrected words' });
    for (const message of ['last', '0', '2.1']) {
      expect(() => parseArguments(['revise', 'corrected', '--to', 'Res', '--message', message])).toThrow(UsageError);
      expect(parseSlash(`/revise ${message} corrected`).kind).toBe('usage');
      expect(CliRequest.safeParse({ op: 'revise', token, to: 'Res', text: 'corrected', message, ...wait }).success).toBe(false);
    }
    expect(() => parseArguments(['revise', 'corrected', '--to', 'Res'])).toThrow(UsageError);
    // A revision takes files now, which join the ones the message already had; an answer has nowhere to carry one.
    expect(parseArguments(['revise', 'corrected', '--to', 'Res', '--message', '2', '--file', 'extra.txt'])).toMatchObject({ kind: 'revise', message: '2', files: ['extra.txt'] });
    expect(() => parseArguments(['answer', '1', '--to', 'Res', '--file', 'extra.txt'])).toThrow(UsageError);
    expect(CliRequest.safeParse({ op: 'revise', token, to: 'Res', text: 'corrected', message: '2', ...wait, providerScopes: ['openai'] }).success).toBe(false);
  });
  it('parses history, replies, reactions, forwards, answers and controls', () => {
    expect(parseArguments(['read', '--to', 'Res', '--turns', '5'])).toEqual({ kind: 'read', to: 'Res', turns: 5, json: false });
    expect(parseArguments(['send', 'yes', '--to', 'Res', '--reply-to', '#2.1'])).toMatchObject({ kind: 'send', replyTo: '#2.1' });
    expect(parseArguments(['react', 'agree', '--to', 'Res', '--message', '3'])).toEqual({ kind: 'react', to: 'Res', emoji: 'agree', active: true, message: '3', json: false });
    expect(parseArguments(['react', 'funny', '--to', 'Res', '--off'])).toMatchObject({ active: false });
    expect(parseArguments(['forward', '--to', 'Res', '--target', 'Writer', '--target=Crew', '--note', 'look'])).toEqual({ kind: 'forward', to: 'Res', targets: ['Writer', 'Crew'], note: 'look', json: false });
    expect(parseArguments(['answer', '2', '--to', 'Res', '--no-wait'])).toMatchObject({ kind: 'answer', answer: '2', wait: false });
    for (const action of ['stop', 'pause', 'resume', 'retry', 'continue']) expect(parseArguments([action, '--to', 'Res'])).toMatchObject({ kind: 'control', action, wait: true });
  });

  it('refuses mistakes as usage errors', () => {
    const mistakes = [['read', '--to', 'Res', '--turns', '0'], ['read', '--to', 'Res', '--turns', '51'], ['react', 'love', '--to', 'Res'], ['react', 'agree'],
      ['react', 'agree', '--to', 'Res', '--message', 'first'], ['forward', '--to', 'Res'], ['send', 'hi', '--to', 'Res', '--reply-to', 'x'],
      ['answer', '--to', 'Res'], ['stop'], ['list', '--turns', '3'], ['status', '--off'], ['send', 'hi', '--to', 'Res', '--target', 'Writer'],
      ['forward', '--to', 'Res', ...Array.from({ length: 6 }, (_, index) => `--target=${index}`)]];
    for (const mistake of mistakes) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
  });

  it('reads slash commands for the same actions', () => {
    expect(parseSlash('/history 5')).toEqual({ kind: 'history', count: 5 });
    expect(parseSlash('/reply #2.1 sounds good')).toEqual({ kind: 'reply', ref: '#2.1', message: 'sounds good' });
    expect(parseSlash('/react agree 3')).toEqual({ kind: 'react', emoji: 'agree', active: true, ref: '3' });
    expect(parseSlash('/unreact agree')).toEqual({ kind: 'react', emoji: 'agree', active: false });
    expect(parseSlash('/forward Writer, Review crew #2.1')).toEqual({ kind: 'forward', targets: ['Writer', 'Review crew'], ref: '#2.1' });
    expect(parseSlash('/answer 2')).toEqual({ kind: 'answer', answer: '2' });
    expect(parseSlash('/stop')).toEqual({ kind: 'control', action: 'stop' });
    for (const usage of ['/history 0', '/reply hello', '/react love', '/forward', '/answer']) expect(parseSlash(usage).kind, usage).toBe('usage');
  });
});

describe('orglet chat history', () => {
  it('numbers every turn and answer, says what a reply answered and carries reactions', () => {
    const { turns, earlier } = chatTurns(chatDetail(), 2);
    expect(earlier).toBe(1);
    expect(turns.map(turn => [turn.number, turn.text, turn.replyTo, turn.answers.map(answer => [answer.ref, answer.text, answer.reaction])])).toEqual([
      [2, 'message 2', 'Researcher: answer 1', [['2.1', 'answer 2', undefined]]],
      [3, 'message 3', undefined, [['3.1', 'answer 3', 'agree']]],
    ]);
    expect(chatTurns(chatDetail(), 10, 2).turns.map(turn => turn.number)).toEqual([1]);
    expect(formatTurns(chatTurns(chatDetail(), 1).turns)).toBe('#3 You:\nmessage 3\n\n#3.1 Researcher:\nanswer 3');
  });

  it('finds the message a number points at, and refuses one that is not there', () => {
    const detail = chatDetail();
    expect(resolveMessage(detail, undefined)).toEqual({ messageId: artifactIds[2], ref: '3.1' });
    expect(resolveMessage(detail, '#2.1')).toEqual({ messageId: artifactIds[1], ref: '2.1' });
    expect(resolveMessage(detail, '1')).toEqual({ messageId: turnMessageId(taskId, 0), ref: '1' });
    expect(() => resolveMessage(detail, '9')).toThrow(CliFailure);
    expect(() => resolveMessage(detail, '2.4')).toThrow(CliFailure);
  });
});

describe('orglet chat actions in the app', () => {
  it('revises from the selected saved input, keeps history and omits revoked files and forward metadata', async () => {
    const detail = chatDetail({ sourceIds: ['original', 'revoked', 'later'] });
    detail.runs[1].snapshot.input = { brief: 'original text', sourceIds: ['original', 'revoked'], replyTo: artifactIds[0], planFirst: true, excludedSources: [{ name: 'skipped.txt', reason: 'binary' }], forwarded: { fromTaskId: taskId, messageId: artifactIds[0], from: 'Other chat', authorKind: 'orglet', text: 'forwarded original', files: [] } } as Run['snapshot']['input'];
    detail.sources = [{ id: 'original', revoked: false }, { id: 'revoked', revoked: true }, { id: 'later', revoked: false }] as TaskDetail['sources'];
    const before = structuredClone(detail);
    const core = fakeCore(() => detail);
    expect(await core.operations.run({ op: 'revise', token, to: 'res', message: '2', text: 'corrected text', wait: false, timeoutSeconds: 5 }, core.signal)).toMatchObject({ action: 'revise', waited: false });
    expect(core.calls.find(call => call.command === 'reviseTask')?.args).toEqual({ taskId, brief: 'corrected text', sourceIds: ['original'], excludedSources: detail.runs[1].snapshot.input!.excludedSources, replyTo: artifactIds[0], planFirst: true, consent: true, providerScopes: ['openai'], budgetMicros: 500_000, onlyWhenIdle: true });
    expect(detail).toEqual(before);
  });

  it('attaches the files given to a revision beside the ones the message already had', async () => {
    const detail = chatDetail();
    detail.runs[1].snapshot.input = { brief: 'original text', sourceIds: ['original'] } as Run['snapshot']['input'];
    detail.sources = [{ id: 'original', revoked: false }] as TaskDetail['sources'];
    const core = fakeCore(() => detail);
    await core.operations.run({ op: 'revise', token, to: 'res', message: '2', text: 'corrected', files: ['C:/work/extra.txt'], wait: false, timeoutSeconds: 5 }, core.signal);
    expect(core.calls.find(call => call.command === 'importSources')?.args).toEqual(['C:/work/extra.txt']);
    expect(core.calls.find(call => call.command === 'reviseTask')?.args).toMatchObject({ sourceIds: ['original', 'imported-0'] });
  });

  it('imports nothing when a revision names no files', async () => {
    const core = fakeCore(() => chatDetail());
    await core.operations.run({ op: 'revise', token, to: 'res', message: '2', text: 'corrected', wait: false, timeoutSeconds: 5 }, core.signal);
    expect(core.calls.some(call => call.command === 'importSources')).toBe(false);
  });

  it('refuses busy turns, missing messages and missing historical input without dispatching work', async () => {
    for (const status of ['running', 'queued', 'pausing'] as const) {
      const core = fakeCore(() => chatDetail({ status }));
      await expect(core.operations.run({ op: 'revise', token, to: 'res', message: '2', text: 'corrected', ...wait }, core.signal)).rejects.toThrow('Đợi lượt');
      expect(core.commands()).toEqual([]);
    }
    const detail = chatDetail();
    detail.runs[1].snapshot.input = undefined;
    const core = fakeCore(() => detail);
    await expect(core.operations.run({ op: 'revise', token, to: 'res', message: '2', text: 'corrected', ...wait }, core.signal)).rejects.toThrow('thiếu bản lưu');
    await expect(core.operations.run({ op: 'revise', token, to: 'res', message: '9', text: 'corrected', ...wait }, core.signal)).rejects.toThrow('Không tìm thấy');
    expect(core.commands()).toEqual([]);
  });

  it('can revise an unsent-to-a-run current input, but refuses a pending start', async () => {
    const detail = chatDetail({ inputRevision: 0, currentInput: { brief: 'first saved message', sourceIds: [] } }, []);
    const core = fakeCore(() => detail);
    await core.operations.run({ op: 'revise', token, to: 'res', message: '1', text: 'corrected', wait: false, timeoutSeconds: 5 }, core.signal);
    expect(core.commands()).toEqual(['reviseTask']);
    detail.task.pendingStart = true;
    await expect(core.operations.run({ op: 'revise', token, to: 'res', message: '1', text: 'again', ...wait }, core.signal)).rejects.toThrow('Đợi lượt');
    expect(core.commands()).toEqual(['reviseTask']);
  });

  it('uses the current channel roster for provider scope, including each non-Demo provider', async () => {
    const detail = chatDetail({ assignees: 'all' });
    const calls: { command: string; args: unknown }[] = [];
    const operations = new CliOperations({ request: async (command, args) => {
      calls.push({ command, args });
      if (command === 'workspace') return { workers: [{ id: workerId, name: 'Researcher', provider: 'openai' }, { id: writerId, name: 'Writer', provider: 'anthropic' }], teams: [], tasks: [detail.task] };
      if (command === 'task') return detail;
    }, version: () => '1', open: () => undefined, translate: message => message });
    await operations.run({ op: 'revise', token, chat: taskId, message: '3', text: 'corrected', wait: false, timeoutSeconds: 5 }, new AbortController().signal);
    expect(calls.find(call => call.command === 'reviseTask')?.args).toMatchObject({ providerScopes: ['openai', 'anthropic'] });
  });
  it('reads past turns and replies to a numbered message', async () => {
    const core = fakeCore(() => chatDetail());
    const read = await core.operations.run({ op: 'read', token, to: 'res', turns: 1 }, core.signal) as ReadValue;
    expect(read.turns?.map(turn => turn.number)).toEqual([3]);
    expect(read.earlier).toBe(2);
    await core.operations.run({ op: 'send', token, to: 'res', message: 'agreed', files: [], wait: false, timeoutSeconds: 5, replyTo: '1.1' }, core.signal);
    expect(core.calls.find(call => call.command === 'reviseTask')?.args).toMatchObject({ taskId, brief: 'agreed', replyTo: artifactIds[0] });
  });

  it('reacts and forwards through the core commands the desktop uses', async () => {
    const core = fakeCore(() => chatDetail());
    expect(await core.operations.run({ op: 'react', token, to: 'res', message: '2', emoji: 'funny', active: true }, core.signal)).toMatchObject({ ref: '2', emoji: 'funny' });
    expect(core.calls.find(call => call.command === 'setMessageReaction')?.args).toEqual({ taskId, messageId: turnMessageId(taskId, 1), emoji: 'funny', active: true });
    expect(await core.operations.run({ op: 'forward', token, to: 'res', targets: ['writer', 'Writer'], note: 'see' }, core.signal)).toEqual({ sent: [{ name: 'Writer', taskId: 'other' }], failed: [] });
    expect(core.calls.find(call => call.command === 'forwardMessage')?.args).toEqual({ taskId, messageId: artifactIds[2], targets: [{ kind: 'worker', id: writerId }], note: 'see', carrySourceIds: [] });
  });

  it('stops only a running turn, and resumes and waits for the answer', async () => {
    let status: Task['status'] = 'completed';
    const core = fakeCore(() => chatDetail({ status }));
    await expect(core.operations.run({ op: 'control', token, to: 'res', action: 'stop', ...wait }, core.signal)).rejects.toThrow('Không có lượt nào đang chạy');
    status = 'running';
    await core.operations.run({ op: 'control', token, to: 'res', action: 'stop', ...wait }, core.signal);
    expect(core.calls.find(call => call.command === 'cancel')?.args).toEqual({ id: taskId });
    status = 'completed';
    const resumed = await core.operations.run({ op: 'control', token, to: 'res', action: 'resume', ...wait }, core.signal) as ControlValue;
    expect(resumed).toMatchObject({ action: 'resume', waited: true, finished: true, turn: 3 });
    expect(resumed.answers.map(answer => answer.text)).toEqual(['answer 3']);
  });

  it('continues only an answer that ran out of steps, from its run', async () => {
    const plain = fakeCore(() => chatDetail());
    await expect(plain.operations.run({ op: 'control', token, to: 'res', action: 'continue', ...wait }, plain.signal)).rejects.toThrow('hết bước');
    const outOfSteps = [run(0, 0), run(1, 1), run(2, 2, { outOfSteps: true })];
    const core = fakeCore(() => chatDetail({}, outOfSteps));
    await core.operations.run({ op: 'control', token, to: 'res', action: 'continue', wait: false, timeoutSeconds: 5 }, core.signal);
    expect(core.calls.find(call => call.command === 'reviseTask')?.args).toMatchObject({ taskId, continueFrom: runIds[2], consent: true, providerScopes: ['openai'], budgetMicros: 500_000 });
  });

  it('answers a question with a choice number, and never an MCP approval', async () => {
    const question = { id: requestId, runId: runIds[2], inputRevision: 2, requestedAt: '2026-10-01T10:04:00.000Z', question: 'Which file?', options: ['notes.txt', 'plan.md'] };
    const core = fakeCore(() => chatDetail({ status: 'waiting_input', decisionRequests: [question] }));
    const read = await core.operations.run({ op: 'read', token, to: 'res' }, core.signal) as ReadValue;
    expect(read.question).toEqual({ question: 'Which file?', options: ['notes.txt', 'plan.md'] });
    await core.operations.run({ op: 'answer', token, to: 'res', answer: '2', wait: false, timeoutSeconds: 5 }, core.signal);
    expect(core.calls.find(call => call.command === 'answerDecision')?.args).toEqual({ taskId, requestId, answer: 'plan.md' });

    const approval = { ...question, options: ['once', 'tool', 'server', 'decline'], approval: { serverId: workerId, serverName: 'Files', tool: 'read', arguments: '{}' } };
    const guarded = fakeCore(() => chatDetail({ status: 'waiting_input', decisionRequests: [approval] }));
    await expect(guarded.operations.run({ op: 'answer', token, to: 'res', answer: 'once', ...wait }, guarded.signal)).rejects.toThrow('MCP');
    expect(guarded.commands()).toEqual([]);
    const waiting = await guarded.operations.run({ op: 'read', token, to: 'res' }, guarded.signal) as ReadValue;
    expect(waiting).toMatchObject({ needsDesktop: true });
    expect(waiting.question).toBeUndefined();
  });
});

describe('orglet chat actions end to end through the real pipe', () => {
  let folder: string | undefined;
  let server: CliServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (folder) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it('prints numbered turns, and the question a message stopped on with how to answer it', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-cli-actions-'));
    const pipeToken = createCliToken();
    await writeCliToken(folder, pipeToken);
    const question = { id: requestId, runId: runIds[2], inputRevision: 2, requestedAt: '2026-10-01T10:04:00.000Z', question: 'Which file?', options: ['notes.txt', 'plan.md'] };
    const core = fakeCore(() => chatDetail({ status: 'waiting_input', decisionRequests: [question] }));
    server = new CliServer({ endpoint: cliEndpoint(folder), token: pipeToken, handle: (request, signal) => core.operations.run(request, signal), translate: message => message });
    await server.start();
    const printed: string[] = [];
    const errors: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => errors.push(text) };
    const environment = { ORGLET_USER_DATA: folder };
    expect(await runCli(['read', '--to', 'res', '--turns', '1'], output, environment)).toBe(0);
    expect(printed).toEqual(['… 2 earlier turns. Raise --turns to see more.', '#3 You:\nmessage 3\n\n#3.1 Researcher:\nanswer 3']);
    expect(await runCli(['send', 'go on', '--to', 'res'], output, environment)).toBe(1);
    expect(errors.pop()).toBe('Which file?\n  1. notes.txt\n  2. plan.md\nAnswer with: orglet answer <number or answer> --to "Researcher"');
    expect(await runCli(['react', 'agree', '--to', 'res', '--message', '#3.1'], output, environment)).toBe(0);
    expect(printed.pop()).toBe('Reacted agree to #3.1.');
    expect(await runCli(['revise', 'corrected text', '--to', 'res', '--message', '2', '--no-wait', '--json'], output, environment)).toBe(0);
    expect(JSON.parse(printed.pop()!)).toMatchObject({ action: 'revise', waited: false });
    expect(core.calls.find(call => call.command === 'reviseTask' && (call.args as { brief?: string }).brief === 'corrected text')?.args).toMatchObject({ replyTo: artifactIds[0], onlyWhenIdle: true });
  });
});

describe('trust decisions stay in the desktop', () => {
  it('has no operation for an approval, a permission, a key, a grant or a backup', async () => {
    const refused = [
      { op: 'answerBrowserApproval', taskId, requestId, answer: 'allow' },
      { op: 'answerDesktopApproval', taskId, requestId, answer: 'allow' },
      { op: 'setToolCapabilities', taskId, capabilities: [] },
      { op: 'setMcpGrant', taskId, serverId: workerId, allowed: true },
      { op: 'grantWorkspace', taskId },
      { op: 'setWorkspaceLevel', taskId, permissions: [] },
      { op: 'connect', provider: 'openai', key: 'sk-test' },
      { op: 'startHarnessSignIn', harness: 'codex', id: 'default' },
      { op: 'reviewKnowledge', id: workerId, revision: 1, decision: 'approve' },
      { op: 'applyAppProposal', id: workerId },
      { op: 'backupRestore' },
      { op: 'eraseData', scope: 'everything' },
    ];
    const handled: unknown[] = [];
    const options = { token, translate: (message: string) => message, handle: async (request: unknown) => { handled.push(request); return 'ran'; } };
    for (const request of refused) {
      expect(CliRequest.safeParse({ ...request, token }).success, request.op).toBe(false);
      expect(await answerLine(JSON.stringify({ ...request, token }), options, new AbortController().signal), request.op).toMatchObject({ ok: false, code: 'invalid' });
    }
    // The chat actions carry no approval either: a control or answer with an approval field is refused whole.
    expect(CliRequest.safeParse({ op: 'answer', token, to: 'Res', answer: 'once', ...wait, approval: true }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'control', token, to: 'Res', action: 'approve', ...wait }).success).toBe(false);
    expect(handled).toEqual([]);
  });
});

const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'openai', providerId: 'openai', color: '#4f7fe0' }], crews: [] };

async function notUsed(): Promise<never> {
  throw new Error('Not used in this test.');
}

/** A fake app whose chat with Researcher has three past turns and asks a question after a message. */
function actionClient() {
  const calls: string[] = [];
  const chat = { kind: 'worker' as const, id: 'w', name: 'Researcher', color: '#4f7fe0' };
  const turnValue = (status: string, extra: Partial<SendValue> = {}): SendValue => ({ chat, taskId: 't', turn: 4, waited: true, finished: true, status, answers: [], errors: [], ...extra });
  const history = chatTurns(chatDetail(), 50).turns;
  const actions: ChatActionClient = {
    history: async (_to, turns, before) => {
      calls.push(`history ${turns} ${before}`);
      const older = history.filter(turn => before === undefined || turn.number < before);
      return { chat, taskId: 't', status: 'completed', answers: [], turns: older.slice(-turns), earlier: Math.max(0, older.length - turns) };
    },
    reply: async (_to, message, replyTo) => {
      calls.push(`reply ${replyTo} ${message}`);
      return turnValue('completed', { answers: [{ name: 'Researcher', text: 'Replied.', createdAt: '1' }] });
    },
    revise: async (_to, message, text) => {
      calls.push(`revise ${message} ${text}`);
      return { ...turnValue('completed', { answers: [{ name: 'Researcher', text: 'Corrected answer.', createdAt: '1' }] }), action: 'revise' };
    },
    react: async (_to, emoji, active, message) => {
      calls.push(`react ${emoji} ${active} ${message}`);
      return { chat, taskId: 't', ref: message ?? '3.1', emoji, active };
    },
    forward: async (_to, targets) => {
      calls.push(`forward ${targets.join('|')}`);
      return { sent: targets.map(name => ({ name, taskId: 'x' })), failed: [] };
    },
    control: async (_to, action) => {
      calls.push(`control ${action}`);
      return { ...turnValue('completed', { answers: [{ name: 'Researcher', text: `After ${action}.`, createdAt: '1' }] }), action };
    },
    answer: async (_to, answer) => {
      calls.push(`answer ${answer}`);
      return { ...turnValue('completed', { answers: [{ name: 'Researcher', text: 'Using plan.md.', createdAt: '1' }] }), action: 'answer' };
    },
    // The chats themselves have their own tests in cli-chat-admin.test.ts.
    chats: notUsed,
    side: notUsed,
    bring: notUsed,
    channel: notUsed,
    members: notUsed,
    rename: notUsed,
    archive: notUsed,
    schedules: notUsed,
    spaces: notUsed,
    enableSchedule: notUsed,
    runSchedule: notUsed,
    search: notUsed,
    running: notUsed,
    memories: notUsed,
    usage: notUsed,
    models: notUsed,
    preferences: notUsed,
  };
  const client: ChatClient = {
    list: async () => list,
    send: async () => turnValue('waiting_input', { question: { question: 'Which file?', options: ['notes.txt', 'plan.md'] } }),
    read: async () => ({ chat, taskId: 't', status: 'completed', answers: [] }),
    open: async () => ({ chat }),
    actions,
  };
  return { client, calls };
}

async function chatSession(script: string) {
  const input = new PassThrough();
  let transcript = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      transcript += chunk.toString();
      callback();
    },
  });
  const fake = actionClient();
  const running = runInteractive({ input, output, client: fake.client, mode: 'none', version: '9.9.9', terminal: false, to: 'Researcher' });
  input.end(script);
  const code = await running;
  return { code, transcript, calls: fake.calls };
}

describe('orglet chat session actions', () => {
  it('runs the revised message and prints its answer', async () => {
    const result = await chatSession('/revise #2 corrected words\n/exit\n');
    expect(result.code).toBe(0);
    expect(result.calls).toEqual(['revise #2 corrected words']);
    expect(result.transcript).toContain('Corrected answer.');
  });
  it('loads earlier turns before the first message this terminal sent', async () => {
    const result = await chatSession('hello\n/history 1\n/history 1\n/history\n/history\n/exit\n');
    expect(result.calls).toEqual(['history 1 4', 'history 1 3', 'history 10 2']);
    expect(result.transcript).toContain('Which file?\n  1. notes.txt\n  2. plan.md');
    expect(result.transcript).toContain('#3 You\n  message 3\n\nResearcher · #3.1 · agree\n  answer 3');
    expect(result.transcript).toContain('Start of the chat');
    expect(result.transcript).toContain('The whole chat is already shown.');
  });

  it('answers, replies, reacts, forwards and controls the chat', async () => {
    const result = await chatSession('/answer 2\n/reply #2.1 yes\n/react funny 2\n/forward Writer, Crew\n/pause\n/retry\n/react love\n/exit\n');
    expect(result.calls).toEqual(['answer 2', 'reply #2.1 yes', 'react funny true 2', 'forward Writer|Crew', 'control pause', 'control retry']);
    expect(result.transcript).toContain('Using plan.md.');
    expect(result.transcript).toContain('Reacted funny to #2.');
    expect(result.transcript).toContain('Forwarded to Crew.');
    expect(result.transcript).toContain('Researcher will pause after the current step.');
    expect(result.transcript).toContain('After retry.');
    expect(result.transcript).toContain('Type /react, then a reaction');
  });
});
