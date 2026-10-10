import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { answerLine } from '../../apps/desktop/src/main/cli-server';
import { CliElevation, ELEVATION_IDLE_MS, ELEVATION_LIFE_MS, FAILED_PAIRINGS_BEFORE_HOLD, HOLD_MS, MAX_WRONG_CODES, PAIRING_LIFE_MS } from '../../apps/desktop/src/main/cli-elevation';
import { CliJournal, TERMINAL_JOURNAL_FILE } from '../../apps/desktop/src/main/cli-journal';
import type { CliDependencies } from '../../apps/desktop/src/main/cli-turns';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH, type HeldBody, type WaitingCard } from '../../apps/desktop/src/cli/held-protocol';
import { runCli } from '../../apps/desktop/src/cli/run';
import type { CliResponse } from '../../apps/desktop/src/cli/protocol';
import type { ElevationScope } from '../../apps/desktop/src/shared/terminal-access';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * The terminal and the decisions held for the person (docs/cli-held-actions-design.md), stages A and B: pairing,
 * elevation, scopes, the journal, and every decision operation refused without a key and working with one.
 */

const token = 'a'.repeat(64);
let directory: string;
let store: Store;
let core: CoreService;
let clock = 0;
let settingOn = true;
let calls: [string, Record<string, unknown>][] = [];
let chatId = '';
let ids = { run: '', proposal: '', undone: '', knowledge: '', reservation: '', server: '', decision: '', browser: '', desktop: '', hand: '' };

const ANSWER_COMMANDS = ['answerDecision', 'answerBrowserApproval', 'answerDesktopApproval', 'applyWorkspaceReview', 'discardWorkspaceReview', 'applyBlockedHandIn',
  'applyAppProposal', 'dismissAppProposal', 'undoAppProposal', 'reviewKnowledge', 'reconcileBudget', 'testMcpServer', 'testWebSearch', 'testDecisionModel'];

/** Deterministic bytes, so a test can predict nothing it should not and still run the same every time. */
function sequentialRandom(): (size: number) => Buffer {
  let counter = 1;
  return size => Buffer.from(Array.from({ length: size }, () => (counter += 37) % 256));
}

function newElevation(onChange?: (state: unknown) => void): CliElevation {
  return new CliElevation({ isEnabled: async () => settingOn, now: () => clock, randomBytes: sequentialRandom(), ...(onChange ? { onChange } : {}) });
}

/** Everything the window shows lives in `elevation.state()`; the test reads the code from there, as the person does. */
async function pairThrough(elevation: CliElevation, scope: ElevationScope, operation?: { hash: string; words: string }): Promise<string> {
  const started = await elevation.startPairing(scope, operation);
  return elevation.finishPairing(started.pairingId, elevation.state().pairing!.code).key;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-cli-held-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No model here.'); });
  clock = 1_000_000;
  settingOn = true;
  calls = [];
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

describe('pairing', () => {
  it('draws the code from an alphabet with no look-alikes, and issues the key once', async () => {
    const elevation = newElevation();
    const started = await elevation.startPairing('decisions');
    const { code } = elevation.state().pairing!;
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    for (const character of code) expect(PAIRING_CODE_ALPHABET).toContain(character);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    const finished = elevation.finishPairing(started.pairingId, `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`);
    expect(finished.key).toMatch(/^[a-f0-9]{64}$/);
    expect(() => elevation.finishPairing(started.pairingId, code)).toThrow('hết hạn');
    expect(elevation.state().pairing).toBeUndefined();
    expect(elevation.state().elevation?.scope).toBe('decisions');
  });

  it('counts wrong tries down and kills the code at five', async () => {
    const elevation = newElevation();
    const started = await elevation.startPairing('decisions');
    for (let wrong = 1; wrong < MAX_WRONG_CODES; wrong += 1) {
      expect(() => elevation.finishPairing(started.pairingId, 'AAAAAAAA')).toThrow(`Còn ${MAX_WRONG_CODES - wrong} lần`);
    }
    expect(() => elevation.finishPairing(started.pairingId, 'AAAAAAAA')).toThrow('quá nhiều lần');
    expect(() => elevation.finishPairing(started.pairingId, elevation.state().pairing?.code ?? 'AAAAAAAA')).toThrow('hết hạn');
    expect(elevation.state().pairing).toBeUndefined();
  });

  it('lets a code live two minutes, refuses a second pairing while one is open, and honours Cancel', async () => {
    const elevation = newElevation();
    const started = await elevation.startPairing('decisions');
    await expect(elevation.startPairing('decisions')).rejects.toThrow('yêu cầu ghép đôi khác');
    clock += PAIRING_LIFE_MS;
    expect(() => elevation.finishPairing(started.pairingId, 'AAAAAAAA')).toThrow('hết hạn');
    await elevation.startPairing('decisions');
    elevation.cancelPairing();
    expect(elevation.state().pairing).toBeUndefined();
  });

  it('holds pairing for ten minutes after three pairings that ended without a match', async () => {
    const elevation = newElevation();
    for (let attempt = 0; attempt < FAILED_PAIRINGS_BEFORE_HOLD; attempt += 1) {
      await elevation.startPairing('decisions');
      elevation.cancelPairing();
    }
    expect(elevation.state().hold).toBeDefined();
    await expect(elevation.startPairing('decisions')).rejects.toThrow('tạm khóa');
    clock += HOLD_MS;
    await expect(elevation.startPairing('decisions')).resolves.toBeDefined();
  });

  it('refuses to pair while "Let a terminal act for me" is off, with a sentence that names it', async () => {
    const elevation = newElevation();
    settingOn = false;
    await expect(elevation.startPairing('decisions')).rejects.toThrow('Cho phép terminal làm thay tôi');
  });

  it('never keeps the key: main holds a hash and the window state carries the code, not the key', async () => {
    const states: unknown[] = [];
    const elevation = newElevation(state => states.push(state));
    const key = await pairThrough(elevation, 'decisions');
    expect(JSON.stringify(elevation)).not.toContain(key);
    expect(JSON.stringify(states)).not.toContain(key);
    expect(JSON.stringify(elevation.state())).not.toContain(key);
  });
});

describe('elevation', () => {
  const required: ElevationScope = 'decisions';

  it('is locked without a key, with a wrong key, and after End now', async () => {
    const elevation = newElevation();
    await expect(elevation.authorize(required, undefined, 'x')).rejects.toMatchObject({ code: 'locked' });
    const key = await pairThrough(elevation, 'decisions');
    await expect(elevation.authorize(required, 'b'.repeat(64), 'x')).rejects.toMatchObject({ code: 'locked' });
    await expect(elevation.authorize(required, 'not a key', 'x')).rejects.toMatchObject({ code: 'locked' });
    await expect(elevation.authorize(required, key, 'x')).resolves.toEqual({ scope: 'decisions' });
    elevation.endElevation();
    await expect(elevation.authorize(required, key, 'x')).rejects.toMatchObject({ code: 'locked' });
  });

  it('ends after fifteen minutes, and after five without a held operation', async () => {
    const elevation = newElevation();
    const key = await pairThrough(elevation, 'decisions');
    clock += ELEVATION_IDLE_MS - 1;
    await elevation.authorize(required, key, 'x');
    clock += ELEVATION_IDLE_MS - 1;
    await elevation.authorize(required, key, 'x');
    clock += ELEVATION_IDLE_MS;
    await expect(elevation.authorize(required, key, 'x')).rejects.toMatchObject({ code: 'locked' });
    const second = await pairThrough(elevation, 'decisions');
    // Used often enough to never sit idle, it still ends when its fifteen minutes are over.
    for (let step = 0; step < 3; step += 1) {
      clock += ELEVATION_IDLE_MS - 1;
      await elevation.authorize(required, second, 'x');
    }
    clock += 3;
    expect(ELEVATION_LIFE_MS).toBe(3 * ELEVATION_IDLE_MS);
    await expect(elevation.authorize(required, second, 'x')).rejects.toMatchObject({ code: 'locked' });
  });

  it('is ended by a new pairing, so the older key no longer works', async () => {
    const elevation = newElevation();
    const first = await pairThrough(elevation, 'decisions');
    const second = await pairThrough(elevation, 'decisions');
    await expect(elevation.authorize(required, first, 'x')).rejects.toMatchObject({ code: 'locked' });
    await expect(elevation.authorize(required, second, 'x')).resolves.toBeDefined();
  });

  it('keeps a decisions key out of setup, and spends a one key on the exact operation it was made for', async () => {
    const elevation = newElevation();
    const decisions = await pairThrough(elevation, 'decisions');
    await expect(elevation.authorize('setup', decisions, 'x')).rejects.toMatchObject({ code: 'locked' });
    const one = await pairThrough(elevation, 'one', { hash: 'wanted', words: 'one thing' });
    await expect(elevation.authorize(required, one, 'other')).rejects.toMatchObject({ code: 'locked' });
    await expect(elevation.authorize(required, one, 'wanted')).resolves.toEqual({ scope: 'one' });
    await expect(elevation.authorize(required, one, 'wanted')).rejects.toMatchObject({ code: 'locked' });
  });

  it('is refused at once, and ended, when the setting is turned off', async () => {
    const elevation = newElevation();
    const key = await pairThrough(elevation, 'decisions');
    settingOn = false;
    await expect(elevation.authorize(required, key, 'x')).rejects.toThrow('Cho phép terminal làm thay tôi');
    settingOn = true;
    await expect(elevation.authorize(required, key, 'x')).rejects.toMatchObject({ code: 'locked' });
  });
});

type Harness = { operations: CliOperations; elevation: CliElevation; journal: CliJournal; options: Parameters<typeof answerLine>[1]; send: (body: Record<string, unknown>, key?: string) => Promise<CliResponse> };

async function harness(): Promise<Harness> {
  const [worker] = store.all<Worker>('workers');
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Hello there', sourceIds: [], excludedSources: [], consent: true, providerScopes: [], budgetMicros: 500_000 }) as string;
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  chatId = taskId;
  ids = { run: randomUUID(), proposal: randomUUID(), undone: randomUUID(), knowledge: randomUUID(), reservation: randomUUID(), server: randomUUID(), decision: randomUUID(), browser: randomUUID(), desktop: randomUUID(), hand: randomUUID() };
  const elevation = newElevation();
  const journal = new CliJournal(directory, () => new Date(clock));
  const request: CliDependencies['request'] = async (command, args) => {
    if (ANSWER_COMMANDS.includes(command)) {
      calls.push([command, args as Record<string, unknown>]);
      return undefined;
    }
    if (command === 'task') return cardDetail(await core.command('task', args as never) as never);
    if (command === 'workspaceRecovery') return { copies: [{ runId: ids.run, state: 'ready', kind: 'work', changeCount: 1, review: { state: 'pending' }, changes: [{ path: 'notes.md', status: 'added' }] }], processes: [], uncertainCalls: [], truncated: false, attempts: [] };
    if (command === 'workspace') return workspaceWithCards(await core.command('workspace', {}) as never);
    return core.command(command as never, args as never);
  };
  const dependencies: CliDependencies = {
    version: () => 'test', open: () => undefined, translate: text => text, request,
    app: { connections: async () => ({}) as never, changelog: async () => ({}) as never, updateState: () => ({ status: 'ready', version: '9.9.9' }) as never, checkForUpdates: () => ({}) as never, installUpdate: () => { calls.push(['installUpdate', {}]); } },
    terminalAccess: { elevation, journal },
  };
  const operations = new CliOperations(dependencies);
  const options = { token, translate: (text: string) => text, elevation, handle: (parsed: never, signal: AbortSignal, progress: never, grant: never) => operations.run(parsed, signal, progress, grant) };
  const send = (body: Record<string, unknown>, key?: string) => answerLine(JSON.stringify({ token, ...body, ...(key ? { elevation: key } : {}) }), options as never, new AbortController().signal);
  return { operations, elevation, journal, options: options as never, send };
}

/** The real chat, with the cards the window would draw: an MCP approval, a browser step, a desktop step, a blocked hand-in and proposals. */
function cardDetail(detail: Record<string, unknown> & { task: Task }) {
  const task = { ...detail.task, status: 'waiting_input', inputRevision: 0, decisionRequests: [{ id: ids.decision, runId: randomUUID(), inputRevision: 0, requestedAt: new Date(clock).toISOString(), question: 'Allow?', options: ['once', 'tool', 'server', 'refuse'], approval: { serverId: randomUUID(), serverName: 'Notes', tool: 'search', arguments: '{"q":"a"}' } }] };
  const approval = { runId: randomUUID(), actionId: randomUUID(), workerName: 'Researcher', element: 'Send', reasons: ['Gửi biểu mẫu'], requestedAt: new Date(clock).toISOString() };
  const proposal = (id: string, status: string, undo?: unknown) => ({ id, taskId: task.id, runId: ids.run, title: 'Rename', kind: 'worker', action: 'edit', changes: [{ field: 'name', before: 'A', after: 'B' }], status, ...(undo ? { undo } : {}) });
  return {
    ...detail, task,
    browser: { approval: { ...approval, id: ids.browser, kind: 'click', site: 'example.com', url: 'https://example.com/form' }, takenOver: false, inChrome: false, using: true, waiting: true },
    desktop: { approval: { ...approval, id: ids.desktop, kind: 'click', program: 'Notepad', window: 'Untitled' } },
    runs: [{ id: ids.hand, taskId: task.id, blockedHandIn: { commands: [{ program: 'npm', arguments: ['test'] }] } }],
    appProposals: [proposal(ids.proposal, 'pending'), proposal(ids.undone, 'applied', { kind: 'delete', entity: 'worker', id: randomUUID() })],
  };
}

function workspaceWithCards(workspace: Record<string, unknown>) {
  const note = { id: ids.knowledge, revision: 2, status: 'proposed', title: 'Style', content: 'Short sentences.', tags: ['tone'] };
  return { ...workspace, knowledge: [note], budgetReservations: [{ id: ids.reservation, resolvedAt: null, provider: 'openai' }], mcpServers: [{ id: ids.server, name: 'Notes' }] };
}

describe('every stage B operation', () => {
  /** What each choice of each card must end in: the core command the window's button sends. */
  const EXPECTED: Record<string, string[]> = {
    mcp: ['answerDecision'], browser: ['answerBrowserApproval'], desktop: ['answerDesktopApproval'],
    changes: ['applyWorkspaceReview', 'discardWorkspaceReview'], 'hand-in': ['applyBlockedHandIn'],
    proposal: ['applyAppProposal', 'dismissAppProposal', 'undoAppProposal'], memory: ['reviewKnowledge'], 'install-update': ['installUpdate'],
  };

  it('is refused with `locked` without a key, with a dead key and with a key of a one-operation scope for another operation', async () => {
    const { send, elevation } = await harness();
    const cards = ((await send({ op: 'waiting', chat: chatId })) as { ok: true; value: { cards: WaitingCard[] } }).value.cards;
    const bodies = cards.flatMap(card => card.choices.map(choice => choice.request));
    expect(bodies.length).toBeGreaterThan(8);
    const dead = await pairThrough(elevation, 'decisions');
    elevation.endElevation();
    const other = await pairThrough(elevation, 'one', { hash: 'something else', words: 'x' });
    for (const body of bodies) {
      expect(await send({ op: 'held', request: body }), body.action).toMatchObject({ ok: false, code: 'locked' });
      expect(await send({ op: 'held', request: body }, dead), body.action).toMatchObject({ ok: false, code: 'locked' });
      expect(await send({ op: 'held', request: body }, other), body.action).toMatchObject({ ok: false, code: 'locked' });
    }
    expect(calls).toEqual([]);
  });

  it('checks the token before anything about the elevation', async () => {
    const { options, elevation } = await harness();
    const key = await pairThrough(elevation, 'decisions');
    const line = JSON.stringify({ token: 'c'.repeat(64), elevation: key, op: 'held', request: { action: 'install-update' } });
    expect(await answerLine(line, options, new AbortController().signal)).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(calls).toEqual([]);
  });

  it('works with a decisions key: each choice a card offers sends the core command its window button sends', async () => {
    const { send, elevation, journal } = await harness();
    const chatCards = ((await send({ op: 'waiting', chat: chatId })) as { ok: true; value: { cards: WaitingCard[] } }).value.cards;
    const appCards = ((await send({ op: 'waiting' })) as { ok: true; value: { cards: WaitingCard[] } }).value.cards;
    const key = await pairThrough(elevation, 'decisions');
    const seen = new Set<string>();
    for (const card of [...chatCards, ...appCards]) {
      expect(card.facts.length + card.choices.length).toBeGreaterThan(0);
      for (const choice of card.choices) {
        calls = [];
        const answer = await send({ op: 'held', request: choice.request }, key);
        expect(answer, `${card.kind}/${choice.key}`).toMatchObject({ ok: true });
        expect(calls.map(([command]) => command)).toHaveLength(1);
        expect(EXPECTED[card.kind]).toContain(calls[0][0]);
        seen.add(calls[0][0]);
      }
    }
    expect([...seen].sort()).toEqual(Object.values(EXPECTED).flat().sort());
    expect((await journal.list()).length).toBeGreaterThan(10);
  });

  it('refuses a card that changed since it was shown', async () => {
    const { send, elevation } = await harness();
    const key = await pairThrough(elevation, 'decisions');
    const stale: HeldBody = { action: 'browser', chat: chatId, cardId: randomUUID(), answer: 'allow' };
    expect(await send({ op: 'held', request: stale }, key)).toMatchObject({ ok: false, code: 'failed' });
    expect(calls).toEqual([]);
  });

  it('runs the connection tests, the budget note and the update with a key, and refuses what is not there', async () => {
    const { send, elevation } = await harness();
    const key = await pairThrough(elevation, 'decisions');
    for (const body of [
      { action: 'test', what: 'web-search' }, { action: 'test', what: 'decision-model' }, { action: 'test', what: 'mcp', server: 'notes' },
      { action: 'budget', cardId: ids.reservation.slice(0, 8), amountMicros: 1500, source: 'invoice' },
    ]) expect(await send({ op: 'held', request: body }, key), JSON.stringify(body)).toMatchObject({ ok: true });
    expect(calls.map(([command]) => command)).toEqual(['testWebSearch', 'testDecisionModel', 'testMcpServer', 'reconcileBudget']);
    expect(calls[3][1]).toMatchObject({ reservationId: ids.reservation, amountMicros: 1500, source: 'invoice' });
    expect(await send({ op: 'held', request: { action: 'test', what: 'mcp', server: 'missing' } }, key)).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('spends a one-operation key on that operation only', async () => {
    const { send, elevation } = await harness();
    const wanted: HeldBody = { action: 'test', what: 'web-search' };
    const key = await pairThrough(elevation, 'one', { hash: (await import('../../apps/desktop/src/main/cli-elevation')).operationHash(wanted), words: 'test' });
    expect(await send({ op: 'held', request: { action: 'test', what: 'decision-model' } }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(await send({ op: 'held', request: wanted }, key)).toMatchObject({ ok: true });
    expect(await send({ op: 'held', request: wanted }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(calls.map(([command]) => command)).toEqual(['testWebSearch']);
  });

  it('refuses everything after End now and when the setting is off', async () => {
    const { send, elevation } = await harness();
    const key = await pairThrough(elevation, 'decisions');
    elevation.endElevation();
    expect(await send({ op: 'held', request: { action: 'install-update' } }, key)).toMatchObject({ ok: false, code: 'locked' });
    const second = await pairThrough(elevation, 'decisions');
    settingOn = false;
    const refused = await send({ op: 'held', request: { action: 'install-update' } }, second);
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toContain('Cho phép terminal làm thay tôi');
    expect(calls).toEqual([]);
  });
});

describe('pairing over the line protocol', () => {
  it('pairs through pair-start and pair-finish, never puts the code in an answer, and needs the operation for a one scope', async () => {
    const { send, elevation } = await harness();
    expect(await send({ op: 'pair-start', scope: 'one' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await send({ op: 'pair-start', scope: 'decisions', operation: { action: 'install-update' } })).toMatchObject({ ok: false, code: 'invalid' });
    const started = await send({ op: 'pair-start', scope: 'decisions' }) as { ok: true; value: { pairingId: string } };
    const { code } = elevation.state().pairing!;
    expect(JSON.stringify(started)).not.toContain(code);
    expect(await send({ op: 'pair-finish', pairingId: started.value.pairingId, code: 'WRONGONE' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await send({ op: 'pair-start', scope: 'decisions' })).toMatchObject({ ok: false, code: 'busy' });
    const finished = await send({ op: 'pair-finish', pairingId: started.value.pairingId, code }) as { ok: true; value: { key: string } };
    expect(finished.value.key).toMatch(/^[a-f0-9]{64}$/);
    expect(await send({ op: 'elevation-end' }, finished.value.key)).toMatchObject({ ok: true });
    expect(elevation.state().elevation).toBeUndefined();
  });

  it('opens a pairing for setup, which the dialog names as granting access and saving keys', async () => {
    const { send, elevation } = await harness();
    expect(await send({ op: 'pair-start', scope: 'setup' })).toMatchObject({ ok: true });
    expect(elevation.state().pairing?.scope).toBe('setup');
  });
});

describe('the journal', () => {
  it('records each elevated operation in words, free of the key, the code and the arguments, and orglet show terminal reads it', async () => {
    const { send, elevation } = await harness();
    const started = await send({ op: 'pair-start', scope: 'decisions' }) as { ok: true; value: { pairingId: string } };
    const { code } = elevation.state().pairing!;
    const finished = await send({ op: 'pair-finish', pairingId: started.value.pairingId, code }) as { ok: true; value: { key: string } };
    const key = finished.value.key;
    await send({ op: 'held', request: { action: 'mcp', chat: chatId, cardId: ids.decision, choice: 'refuse' } }, key);
    await send({ op: 'held', request: { action: 'browser', chat: chatId, cardId: randomUUID(), answer: 'allow' } }, key);
    const file = await readFile(join(directory, TERMINAL_JOURNAL_FILE), 'utf8');
    for (const secret of [key, code, '{"q":"a"}']) expect(file).not.toContain(secret);
    const shown = await send({ op: 'show', what: 'terminal', refresh: false }) as { ok: true; value: { rows: { outcome: string; operation: string }[] } };
    expect(shown.value.rows.map(row => row.outcome)).toEqual(['failed', 'done']);
    expect(shown.value.rows[1].operation).toContain('MCP');
    expect(JSON.stringify(shown)).not.toContain(key);
  });
});

describe('a held command without a terminal', () => {
  it('exits 2 before it sends anything: the app is not even looked for', async () => {
    const printed: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => printed.push(text) };
    const environment = { ORGLET_USER_DATA: join(directory, 'nobody-home') };
    for (const argumentList of [['unlock'], ['approve', '--to', 'Researcher'], ['approve', '--to', 'Researcher', 'allow'], ['reconcile', 'abcd', '1.5', 'invoice'], ['test', 'web-search'], ['install-update']]) {
      printed.length = 0;
      // Exit 3 would mean the command went looking for the app.
      expect(await runCli(argumentList, output, environment), argumentList.join(' ')).toBe(2);
      expect(printed.join('\n')).toContain('terminal');
    }
    const pipedInput = { isTTY: false, on: () => undefined } as never;
    expect(await runCli(['install-update'], output, environment, directory, { terminal: { input: pipedInput, output: { isTTY: true } as never, mode: 'none' } })).toBe(2);
  });

  it('reads the code from no argument: a code on the command line is not an option', async () => {
    const printed: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => printed.push(text) };
    expect(await runCli(['approve', '--to', 'Researcher', '--code', 'ABCD1234'], output, { ORGLET_USER_DATA: directory })).toBe(2);
  });
});

describe('the setting', () => {
  it('is on by default, validated with the settings schema, and saved', async () => {
    expect(store.workspace().terminalAccess).toBe(true);
    await core.command('settings', { theme: 'system', connectionLimitMicros: 1_000_000, terminalAccess: false } as never);
    expect(store.workspace().terminalAccess).toBe(false);
    await expect(core.command('settings', { theme: 'system', connectionLimitMicros: 1_000_000, terminalAccess: 'no' } as never)).rejects.toThrow();
  });
});
