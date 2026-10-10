import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { answerLine } from '../../apps/desktop/src/main/cli-server';
import { CliElevation, operationHash } from '../../apps/desktop/src/main/cli-elevation';
import { CliJournal, TERMINAL_JOURNAL_FILE } from '../../apps/desktop/src/main/cli-journal';
import type { CliDependencies } from '../../apps/desktop/src/main/cli-turns';
import { type HeldBody, type WaitingCard } from '../../apps/desktop/src/cli/held-protocol';
import { runCli } from '../../apps/desktop/src/cli/run';
import type { CliResponse } from '../../apps/desktop/src/cli/protocol';
import type { ElevationScope } from '../../apps/desktop/src/shared/terminal-access';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * The last decisions the terminal reaches (issue 554): a sync conflict, a skill package, a deleted file, evidence, a
 * report and a note. Each is locked without the right key, done with it, refused for other arguments, and has its own rule.
 */

const token = 'a'.repeat(64);
const HASH = 'b'.repeat(64);
const NEW_HASH = 'c'.repeat(64);
let directory: string;
let store: Store;
let core: CoreService;
let clock = 1_000_000;
let calls: [string, unknown][] = [];
let currentHash = HASH;
let generation = 3;
let ids = { chat: '', report: '', reportRun: '', evidence: '', run: '', conflict: '', thisVersion: '', accountVersion: '', skill: '' };
let workerName = '';

const MUTATIONS = ['accept', 'acknowledgeEvidence', 'restoreWorkspaceFile', 'resolveSyncConflict', 'reviewSkill', 'saveKnowledge'];

function sequentialRandom(): (size: number) => Buffer {
  let counter = 11;
  return size => Buffer.from(Array.from({ length: size }, () => (counter += 29) % 256));
}

async function pair(elevation: CliElevation, scope: ElevationScope, operation?: HeldBody): Promise<string> {
  const started = await elevation.startPairing(scope, operation ? { hash: operationHash(operation), words: 'x' } : undefined);
  return elevation.finishPairing(started.pairingId, elevation.state().pairing!.code).key;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-cli-last-held-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No model here.'); });
  calls = [];
  currentHash = HASH;
  generation = 3;
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

type Harness = { send: (body: Record<string, unknown>, key?: string) => Promise<CliResponse>; elevation: CliElevation; journal: CliJournal };

async function harness(): Promise<Harness> {
  const [worker] = store.all<Worker>('workers');
  workerName = worker.name;
  const chat = await core.command('createTask', { workerId: worker.id, brief: 'Hello there', sourceIds: [], excludedSources: [], consent: true, providerScopes: [], budgetMicros: 500_000 }) as string;
  for (let tries = 0; tries < 300 && (core.teams.isActive(chat) || core.runner.isActive(chat)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  ids = { chat, report: randomUUID(), reportRun: randomUUID(), evidence: randomUUID(), run: randomUUID(), conflict: randomUUID(), thisVersion: randomUUID(), accountVersion: randomUUID(), skill: randomUUID() };
  const elevation = new CliElevation({ isEnabled: async () => true, now: () => clock, randomBytes: sequentialRandom() });
  const journal = new CliJournal(directory, () => new Date(clock));
  const request: CliDependencies['request'] = async (command, args) => {
    if (MUTATIONS.includes(command)) {
      calls.push([command, args]);
      return undefined;
    }
    if (command === 'task') {
      const detail = await core.command('task', args as never) as unknown as Record<string, unknown> & { task: Record<string, unknown> };
      return {
        ...detail,
        task: { ...detail.task, status: 'completed', accepted: false, inputRevision: 0, evidenceRequests: [{ id: ids.evidence, artifactId: ids.report, checks: ['Missing: the baseline run'], state: 'pending', createdAt: new Date(clock).toISOString() }] },
        artifacts: [{ id: ids.report, runId: ids.reportRun, report: { title: 'Weekly report', summary: 'Two findings.', findings: [1, 2] } }],
        runs: [{ id: ids.reportRun, snapshot: { inputRevision: 0 } }],
      };
    }
    if (command === 'workspaceRecovery') {
      return { taskId: chat, attempts: [{ runId: ids.run, reviewToken: 'd'.repeat(64), retired: false }], processes: [], uncertainCalls: [], truncated: false,
        copies: [{ runId: ids.run, state: 'integrated', kind: 'copy', changeCount: 1, changes: [{ kind: 'delete', path: 'old/notes.md', status: 'applied' }] }] };
    }
    if (command === 'recoveryDeletedFile') return { path: 'old/notes.md', bytes: 1234, restored: false };
    if (command === 'syncConflicts') {
      return [{ entity: 'worker', id: ids.conflict, name: 'Researcher', generation, versions: [
        { revisionId: ids.thisVersion, current: false, thisComputer: true, text: 'Researcher\n\nAnswer in one line.' },
        { revisionId: ids.accountVersion, current: true, thisComputer: false, text: 'Researcher\n\nAnswer in detail.' },
      ] }];
    }
    if (command === 'inspectSkill') return { metadata: {}, hash: currentHash, blockers: [], files: [{ path: 'SKILL.md', bytes: 12, text: 'Hello skill.' }, { path: 'logo.png', bytes: 90, text: null }] };
    if (command === 'workspace') {
      const workspace = await core.command('workspace', {}) as unknown as { skills: unknown[] };
      return { ...workspace, skills: [...workspace.skills, { id: ids.skill, name: 'Helper', package: { hash: currentHash } }] };
    }
    return core.command(command as never, args as never);
  };
  const dependencies: CliDependencies = { version: () => 'test', open: () => undefined, translate: text => text, request, terminalAccess: { elevation, journal } };
  const operations = new CliOperations(dependencies);
  const options = { token, translate: (text: string) => text, elevation, handle: (parsed: never, signal: AbortSignal, progress: never, grant: never) => operations.run(parsed, signal, progress, grant) };
  const send = (body: Record<string, unknown>, key?: string) => answerLine(JSON.stringify({ token, ...body, ...(key ? { elevation: key } : {}) }), options as never, new AbortController().signal);
  return { send, elevation, journal };
}

async function cardsOf(send: Harness['send'], target: Record<string, unknown>): Promise<WaitingCard[]> {
  return ((await send({ op: 'waiting', ...target })) as { ok: true; value: { cards: WaitingCard[] } }).value.cards;
}

function choiceOf(cards: WaitingCard[], kind: string, key: string): HeldBody {
  return cards.find(card => card.kind === kind)!.choices.find(choice => choice.key === key)!.request;
}

describe('the cards a chat and the app wait on', () => {
  it('prints the facts before an answer: the report, the missing evidence, the deleted file with its size, both versions of a conflict', async () => {
    const { send } = await harness();
    const chatCards = await cardsOf(send, { chat: ids.chat });
    const report = chatCards.find(card => card.kind === 'accept')!;
    expect(report.facts.join('\n')).toContain('Weekly report');
    expect(chatCards.find(card => card.kind === 'evidence')!.facts.join('\n')).toContain('baseline run');
    const restore = chatCards.find(card => card.kind === 'restore-file')!;
    expect(restore.facts.join('\n')).toContain('old/notes.md');
    expect(restore.facts.join('\n')).toContain('1234');
    const conflict = (await cardsOf(send, {})).find(card => card.kind === 'sync-conflict')!;
    expect(conflict.facts.join('\n')).toContain('Answer in one line.');
    expect(conflict.facts.join('\n')).toContain('Answer in detail.');
    expect(conflict.choices.map(choice => choice.key)).toEqual(['keep-this', 'keep-account']);
  });
});

describe('every decision of this change', () => {
  function bodies(chatCards: WaitingCard[], appCards: WaitingCard[]): { name: string; body: HeldBody; command: string; arguments: unknown }[] {
    return [
      { name: 'accept', body: choiceOf(chatCards, 'accept', 'accept'), command: 'accept', arguments: { id: ids.chat } },
      { name: 'evidence', body: choiceOf(chatCards, 'evidence', 'acknowledge'), command: 'acknowledgeEvidence', arguments: { taskId: ids.chat, requestId: ids.evidence } },
      { name: 'restore', body: choiceOf(chatCards, 'restore-file', 'restore'), command: 'restoreWorkspaceFile', arguments: { taskId: ids.chat, runId: ids.run, path: 'old/notes.md' } },
      { name: 'keep this computer', body: choiceOf(appCards, 'sync-conflict', 'keep-this'), command: 'resolveSyncConflict', arguments: { entity: 'worker', id: ids.conflict, revisionId: ids.thisVersion, generation: 3 } },
      { name: 'keep the account', body: choiceOf(appCards, 'sync-conflict', 'keep-account'), command: 'resolveSyncConflict', arguments: { entity: 'worker', id: ids.conflict, revisionId: ids.accountVersion, generation: 3 } },
      { name: 'note', body: { action: 'note', title: 'House style', content: 'Short sentences.', tags: ['tone'], pinned: true }, command: 'saveKnowledge', arguments: { title: 'House style', content: 'Short sentences.', tags: ['tone'], pinned: true, scope: { type: 'workspace' } } },
      { name: 'note for an orglet', body: { action: 'note', title: 'Only for one', content: 'Be brief.', tags: [], pinned: false, orglet: workerName }, command: 'saveKnowledge', arguments: { title: 'Only for one', content: 'Be brief.', tags: [], pinned: false, scope: { type: 'worker', id: store.all<Worker>('workers')[0].id } } },
    ];
  }

  async function prepare() {
    const made = await harness();
    const rows = bodies(await cardsOf(made.send, { chat: ids.chat }), await cardsOf(made.send, {}));
    return { ...made, rows };
  }

  it('is `locked` with the token alone, with a dead key and with a one key made for another operation, and nothing runs', async () => {
    const { send, elevation, rows } = await prepare();
    const dead = await pair(elevation, 'decisions');
    elevation.endElevation();
    const other = await pair(elevation, 'one', { action: 'install-update' });
    for (const row of rows) {
      for (const key of [undefined, dead, other]) expect(await send({ op: 'held', request: row.body }, key), row.name).toMatchObject({ ok: false, code: 'locked' });
    }
    expect(calls).toEqual([]);
  });

  it('is done with a decisions key, by the core command the window sends, with exactly the arguments the card named', async () => {
    const { send, elevation, rows, journal } = await prepare();
    const key = await pair(elevation, 'decisions');
    for (const row of rows) {
      calls = [];
      expect(await send({ op: 'held', request: row.body }, key), row.name).toMatchObject({ ok: true });
      expect(calls, row.name).toEqual([[row.command, row.arguments]]);
    }
    const written = (await journal.list()).map(item => item.operation).join('\n');
    expect(written).toContain('House style');
    expect(written).toContain('old/notes.md');
  });

  it('is done once with a matching one key, and refused with a one key made for other arguments', async () => {
    const { send, elevation, rows } = await prepare();
    for (const row of rows) {
      calls = [];
      const matching = await pair(elevation, 'one', row.body);
      expect(await send({ op: 'held', request: row.body }, matching), row.name).toMatchObject({ ok: true });
      expect(calls).toHaveLength(1);
      expect(await send({ op: 'held', request: row.body }, matching), row.name).toMatchObject({ ok: false, code: 'locked' });
      expect(calls).toHaveLength(1);
    }
    calls = [];
    const note = rows.find(row => row.name === 'note')!.body as Extract<HeldBody, { action: 'note' }>;
    const key = await pair(elevation, 'one', note);
    expect(await send({ op: 'held', request: { ...note, content: 'Different text.' } }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(calls).toEqual([]);
  });

  it('refuses a card that changed since it was shown', async () => {
    const { send, elevation, rows } = await prepare();
    const key = await pair(elevation, 'decisions');
    const keepThis = rows.find(row => row.name === 'keep this computer')!.body as Extract<HeldBody, { action: 'sync-conflict' }>;
    // The version of the account's side sent with "keep this computer", and a conflict that moved on.
    expect(await send({ op: 'held', request: { ...keepThis, revisionId: ids.accountVersion } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { ...keepThis, keep: 'account' } }, key)).toMatchObject({ ok: false });
    generation = 4;
    expect(await send({ op: 'held', request: keepThis }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'accept', chat: ids.chat, cardId: randomUUID() } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'evidence', chat: ids.chat, cardId: randomUUID() } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'restore-file', chat: ids.chat, runId: ids.run, path: 'elsewhere.md' } }, key)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('shows the person the name main finds for a conflict, not a name the terminal chose', async () => {
    const { send, elevation, rows } = await prepare();
    const keepThis = rows.find(row => row.name === 'keep this computer')!.body;
    expect(await send({ op: 'pair-start', scope: 'one', operation: keepThis })).toMatchObject({ ok: true });
    expect(elevation.state().pairing!.operation).toContain('Researcher');
  });

  it('names a note by its title in the dialog and the journal, and refuses an orglet that is not there', async () => {
    const { send, elevation, journal } = await harness();
    const note: HeldBody = { action: 'note', title: 'House style', content: 'Short sentences.', tags: [], pinned: false };
    await send({ op: 'pair-start', scope: 'one', operation: note });
    expect(elevation.state().pairing!.operation).toContain('House style');
    elevation.cancelPairing();
    const key = await pair(elevation, 'decisions');
    expect(await send({ op: 'held', request: { ...note, orglet: 'Nobody' } }, key)).toMatchObject({ ok: false, code: 'not_found' });
    expect(calls).toEqual([]);
    await send({ op: 'held', request: note }, key);
    expect((await journal.list())[0].operation).toContain('House style');
    expect(await readFile(join(directory, TERMINAL_JOURNAL_FILE), 'utf8')).toContain('House style');
  });
});

describe('a skill package', () => {
  const show: HeldBody = { action: 'skill-show', skill: 'Helper' };
  const approve = (hash: string): HeldBody => ({ action: 'skill-review', skill: 'Helper', hash });

  it('is `locked` for show and approve with the token alone and with a key of another one-operation scope', async () => {
    const { send, elevation } = await harness();
    const other = await pair(elevation, 'one', { action: 'install-update' });
    for (const body of [show, approve(HASH)]) {
      expect(await send({ op: 'held', request: body })).toMatchObject({ ok: false, code: 'locked' });
      expect(await send({ op: 'held', request: body }, other)).toMatchObject({ ok: false, code: 'locked' });
    }
    expect(calls).toEqual([]);
  });

  it('prints the files and their text, and approves only the hash it showed to this same elevation', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'decisions');
    expect(await send({ op: 'held', request: approve(HASH) }, key)).toMatchObject({ ok: false });
    const shown = await send({ op: 'held', request: show }, key) as { ok: true; value: { report: string[]; skillHash: string } };
    expect(shown.value.skillHash).toBe(HASH);
    expect(shown.value.report.join('\n')).toContain('SKILL.md (12 bytes)');
    expect(shown.value.report.join('\n')).toContain('Hello skill.');
    expect(await send({ op: 'held', request: approve(NEW_HASH) }, key)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(await send({ op: 'held', request: approve(HASH) }, key)).toMatchObject({ ok: true });
    expect(calls).toEqual([['reviewSkill', { id: ids.skill, hash: HASH }]]);
  });

  it('does not carry what one elevation was shown to the next, nor to a package that changed after it was shown', async () => {
    const { send, elevation } = await harness();
    const first = await pair(elevation, 'decisions');
    await send({ op: 'held', request: show }, first);
    const second = await pair(elevation, 'decisions');
    expect(await send({ op: 'held', request: approve(HASH) }, second)).toMatchObject({ ok: false });
    await send({ op: 'held', request: show }, second);
    currentHash = NEW_HASH;
    // The package changed after it was shown: the old hash is what this elevation saw, and the core refuses a stale one.
    expect(await send({ op: 'held', request: approve(NEW_HASH) }, second)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('cannot be approved with a one key, which cannot have shown anything first', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'one', approve(HASH));
    expect(await send({ op: 'held', request: approve(HASH) }, key)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('refuses a skill with no package, by name', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'decisions');
    expect(await send({ op: 'held', request: { action: 'skill-show', skill: 'No such skill' } }, key)).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('the commands', () => {
  it('exit with 2 before sending anything when there is no terminal', async () => {
    const printed: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => printed.push(text) };
    const environment = { ORGLET_USER_DATA: join(directory, 'nobody-home') };
    for (const argumentList of [['skill', 'show', 'Helper'], ['note', '--title', 'T', '--text', 'x'], ['grant', 'browser', '--to', 'R', '--allow', 'example.com'], ['grant', 'desktop', '--to', 'R', '--add', 'notepad']]) {
      expect(await runCli(argumentList, output, environment), argumentList.join(' ')).toBe(2);
    }
  });
});
