import { describe, expect, it } from 'vitest';
import { parseArguments, UsageError, COMMAND_NAMES } from '../../apps/desktop/src/cli/arguments';
import { completionScript } from '../../apps/desktop/src/cli/completion';
import { formatMarket } from '../../apps/desktop/src/cli/output';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import type { MarketAddValue, MarketInstalledValue, MarketListValue, SearchValue } from '../../apps/desktop/src/cli/protocol';
import { createCliToken } from '../../apps/desktop/src/main/cli-server';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';

/*
 * The marketplace, shell completion and search within a space from the terminal (docs/cli.md). The operations run
 * against a fake core that records what the app would be asked.
 */

const token = createCliToken();
const researcherId = '11111111-1111-4111-8111-111111111111';
const spaceId = '55555555-5555-4555-8555-555555555555';
const inSpaceId = 'abab0000-0000-4000-8000-000000000000';
const outsideId = 'cdcd0000-0000-4000-8000-000000000000';

const listing = (listingId: string, kind: string, name: string) => ({ listingId, version: 2, kind, name, summary: `${name} summary`, tags: [], language: 'en', author: 'CodePawl', license: 'CC-BY-4.0', sha256: 'a'.repeat(64) });

function workspace(): Workspace {
  return {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'openai' }],
    teams: [],
    spaces: [{ id: spaceId, name: 'Launch', orgletIds: [researcherId], categories: [] }],
    tasks: [
      { id: inSpaceId, workerId: researcherId, brief: 'plan', status: 'completed', createdAt: '2026-10-01T09:00:00.000Z', channel: { id: 'c1c10000-0000-4000-8000-000000000000', name: 'plans', spaceId, members: [{ kind: 'orglet', id: researcherId }] } },
      { id: outsideId, workerId: researcherId, brief: 'other', status: 'completed', createdAt: '2026-10-01T10:00:00.000Z' },
    ],
  } as unknown as Workspace;
}

function fakeCore(pages: Record<string, unknown>) {
  const calls: { command: string; args: unknown }[] = [];
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return workspace();
    if (command === 'marketCatalog') return pages[(args as { cursor?: string }).cursor ?? 'first'];
    if (command === 'marketInstallations') return [{ entityId: spaceId, kind: 'space', listingId: 'launch-space', version: 1, name: 'Launch', updateAvailable: true }];
    if (command === 'marketAdd') return { entityId: spaceId, kind: 'space', workerIds: [researcherId], fallbackNames: ['Researcher'] };
    if (command === 'searchChats') {
      return {
        orgletIds: [researcherId], crewIds: [], indexing: false,
        chats: [{ taskId: inSpaceId, snippet: [{ text: 'the plan' }], at: '2026-10-01T09:00:00.000Z' }, { taskId: outsideId, snippet: [{ text: 'another plan' }], at: '2026-10-01T10:00:00.000Z' }],
      };
    }
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message, pollMilliseconds: 1 });
  const signal = new AbortController().signal;
  return { calls, operations, signal, argsOf: (command: string) => calls.filter(call => call.command === command).map(call => call.args) };
}

const twoPages = {
  first: { listings: [listing('research-friend', 'orglet', 'Research friend')], nextCursor: 'next', source: 'online', fetchedAt: null },
  next: { listings: [listing('launch-space', 'space', 'Launch space')], nextCursor: null, source: 'online', fetchedAt: null },
};

describe('orglet market', () => {
  it('parses the catalog, the installed list and an add, and refuses the rest', () => {
    expect(parseArguments(['market'])).toEqual({ kind: 'market', verb: 'list', refresh: false, json: false });
    expect(parseArguments(['market', '--refresh', '--json'])).toEqual({ kind: 'market', verb: 'list', refresh: true, json: true });
    expect(parseArguments(['market', 'installed'])).toEqual({ kind: 'market', verb: 'installed', refresh: false, json: false });
    expect(parseArguments(['market', 'add', 'launch-space'])).toEqual({ kind: 'market', verb: 'add', listingId: 'launch-space', refresh: false, json: false });
    for (const mistake of [['market', 'publish'], ['market', 'add'], ['market', 'add', 'Launch Space'], ['market', 'installed', 'x'], ['market', 'installed', '--refresh'], ['market', 'add', 'a', 'b'], ['market', '--to', 'A']]) {
      expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    }
  });

  it('lists every page of the catalog and says where it came from', async () => {
    const core = fakeCore(twoPages);
    const value = await core.operations.run({ op: 'market', token, verb: 'list', refresh: true }, core.signal) as MarketListValue;
    expect(value.listings.map(item => [item.id, item.kind, item.author])).toEqual([['research-friend', 'orglet', 'CodePawl'], ['launch-space', 'space', 'CodePawl']]);
    expect(value).toMatchObject({ source: 'online', more: false });
    expect(core.argsOf('marketCatalog')).toEqual([{ refresh: true }, { cursor: 'next' }]);
    const offline = fakeCore({ first: { listings: [listing('research-friend', 'orglet', 'Research friend')], nextCursor: null, source: 'bundled', fetchedAt: null } });
    const bundled = await offline.operations.run({ op: 'market', token, verb: 'list', refresh: false }, offline.signal) as MarketListValue;
    expect(formatMarket(bundled)).toContain('the catalog that ships with the app');
  });

  it('adds the current version of a listing and names the orglets it made', async () => {
    const core = fakeCore(twoPages);
    const value = await core.operations.run({ op: 'market', token, verb: 'add', listingId: 'launch-space', refresh: false }, core.signal) as MarketAddValue;
    expect(core.argsOf('marketAdd')).toEqual([{ listingId: 'launch-space', version: 2 }]);
    expect(value).toEqual({ id: 'launch-space', version: 2, kind: 'space', name: 'Launch space', orglets: ['Researcher'], withoutModel: ['Researcher'] });
    expect(formatMarket(value)).toContain('No suggested connection here for: Researcher');
    await expect(core.operations.run({ op: 'market', token, verb: 'add', listingId: 'nothing', refresh: false }, core.signal)).rejects.toThrow('không có mục nào mã "nothing"');
    expect(core.argsOf('marketAdd')).toHaveLength(1);
  });

  it('lists what was added, with the ones that have an update', async () => {
    const core = fakeCore(twoPages);
    const value = await core.operations.run({ op: 'market', token, verb: 'installed', refresh: false }, core.signal) as MarketInstalledValue;
    expect(value.installed).toEqual([{ id: 'launch-space', version: 1, kind: 'space', name: 'Launch', updateAvailable: true }]);
    expect(formatMarket(value)).toContain('update available');
  });
});

describe('orglet search in a space', () => {
  it('keeps only the messages of that space and no names', async () => {
    expect(parseArguments(['search', 'plan', '--space', 'Launch'])).toEqual({ kind: 'search', query: 'plan', space: 'Launch', json: false });
    expect(parseArguments(['running', '--space', 'Launch'])).toEqual({ kind: 'running', space: 'Launch', json: false });
    const core = fakeCore(twoPages);
    const everywhere = await core.operations.run({ op: 'search', token, query: 'plan' }, core.signal) as SearchValue;
    expect(everywhere.chats).toHaveLength(2);
    expect(everywhere.orglets).toEqual(['Researcher']);
    const inSpace = await core.operations.run({ op: 'search', token, query: 'plan', space: 'lau' }, core.signal) as SearchValue;
    expect(inSpace.chats.map(hit => hit.name)).toEqual(['#plans']);
    expect(inSpace.orglets).toEqual([]);
    await expect(core.operations.run({ op: 'search', token, query: 'plan', space: 'Nowhere' }, core.signal)).rejects.toThrow('Không có không gian nào tên "Nowhere"');
  });
});

describe('orglet completion', () => {
  it('prints a script for each shell with every command and option, and nothing from the app', () => {
    expect(parseArguments(['completion', 'bash'])).toEqual({ kind: 'completion', shell: 'bash' });
    for (const mistake of [['completion'], ['completion', 'fish'], ['completion', 'bash', 'extra']]) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    const options = ['--to', '--json'];
    const powershell = completionScript('powershell', COMMAND_NAMES, options);
    expect(powershell).toContain('Register-ArgumentCompleter -Native -CommandName orglet');
    const bash = completionScript('bash', COMMAND_NAMES, options);
    expect(bash).toContain('complete -o default -F _orglet_completion orglet');
    const zsh = completionScript('zsh', COMMAND_NAMES, options);
    expect(zsh).toContain('compdef _orglet orglet');
    for (const script of [powershell, bash, zsh]) {
      for (const command of ['send', 'space', 'market', 'completion']) expect(script).toContain(command);
      expect(script).toContain('--json');
    }
  });
});
