import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import type { CliAppState, CliDependencies } from '../../apps/desktop/src/main/cli-turns';
import { CliRequest, type ShowValue } from '../../apps/desktop/src/cli/protocol';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import { ManagementCatalog } from '../../apps/desktop/src/cli/management';
import { ManagementEditor } from '../../apps/desktop/src/cli/management-editor';
import { formatChatSettings, formatMarket, formatPreferences, formatScheduleNotice, formatShow, formatSpaceChange } from '../../apps/desktop/src/cli/output';
import { COMMAND_PARITY } from '../../apps/desktop/src/cli/parity';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Issue 554, phase 2: what the core already offers and the terminal now reaches. Each step goes through the same
 * core command the window uses; the steps that would be a grant, a secret or an approval are refused or not there.
 */

let directory: string;
let store: Store;
let core: CoreService;
const token = 'a'.repeat(64);
const signal = new AbortController().signal;
const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

type Overrides = Record<string, (args: unknown) => unknown>;

function operationsWith(overrides: Overrides = {}, app?: CliAppState): CliOperations {
  const dependencies: CliDependencies = {
    version: () => 'test', open: () => undefined, translate: text => text, ...(app ? { app } : {}),
    request: async (command, args) => (overrides[command] ? overrides[command](args) : core.command(command as never, args as never)),
  };
  return new CliOperations(dependencies);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-cli-reach-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('The terminal must not call a model here.'); });
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function settled(taskId: string): Promise<void> {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
}

async function newChat(worker: Worker): Promise<Task> {
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Hello there', ...message }) as string;
  await settled(taskId);
  return store.get<Task>('tasks', taskId);
}

describe('the commands that grew', () => {
  it('reads the new commands and options, and refuses the ones that do not belong', () => {
    expect(parseArguments(['show', 'spend'])).toMatchObject({ kind: 'show', what: 'spend', refresh: false });
    expect(parseArguments(['show', 'changes', '--chat', 'abcd'])).toMatchObject({ kind: 'show', what: 'changes', chat: 'abcd' });
    expect(() => parseArguments(['show', 'changes'])).toThrow(UsageError);
    expect(() => parseArguments(['show', 'spend', '--to', 'Writer'])).toThrow('does not take --to or --chat');
    expect(() => parseArguments(['show', 'secrets'])).toThrow('orglet show');
    expect(parseArguments(['update'])).toEqual({ kind: 'update-check', json: false });
    expect(parseArguments(['assign', '--chat', 'abcd', '--with', 'Writer', '--budget', '0.25'])).toMatchObject({ kind: 'chat-settings', chat: 'abcd', names: ['Writer'], budgetMicros: 250_000 });
    expect(() => parseArguments(['assign', '--chat', 'abcd'])).toThrow('--with');
    expect(parseArguments(['schedule', 'dismiss', 'Morning'])).toEqual({ kind: 'schedule-notice', schedule: 'Morning', action: 'dismiss', json: false });
    expect(parseArguments(['schedule', 'catch-up', 'Morning'])).toMatchObject({ action: 'catch-up' });
    expect(() => parseArguments(['schedule', 'dismiss', 'Morning', '--budget', '1'])).toThrow('takes only');
    expect(parseArguments(['market', 'update', 'Launch', '--confirm', 'abcdef01'])).toMatchObject({ kind: 'market', verb: 'update', installed: 'Launch', confirmCode: 'abcdef01' });
    expect(() => parseArguments(['market', 'update', 'Launch', '--confirm', 'nope'])).toThrow('eight-character');
    expect(() => parseArguments(['market', 'add', 'launch', '--confirm', 'abcdef01'])).toThrow('--confirm');
    expect(parseArguments(['space', 'folder', 'Launch', '--value', 'Work'])).toMatchObject({ verb: 'folder', value: 'Work' });
    expect(parseArguments(['space', 'color', 'Launch', '--value', '#7c8be8'])).toMatchObject({ verb: 'color', value: '#7c8be8' });
    expect(() => parseArguments(['space', 'color', 'Launch', '--value', 'red'])).toThrow('#7c8be8');
    expect(parseArguments(['space', 'order', 'Launch', '--name', '#ideas', '--position', '2'])).toMatchObject({ verb: 'order', channelName: 'ideas', position: 2 });
    expect(parseArguments(['space', 'order', 'Launch', '--category', 'Ready', '--position', '1'])).toMatchObject({ verb: 'order', category: 'Ready', position: 1 });
    expect(() => parseArguments(['space', 'order', 'Launch', '--position', '1'])).toThrow('needs a channel');
    expect(() => parseArguments(['list', '--position', '1'])).toThrow('does not take --position');
  });

  it('reads the preference options as the window checks them', () => {
    expect(parseArguments(['preferences', '--titles', 'off', '--retention', '7', '--copy-format', 'markdown', '--accent', '#112233', '--font', 'default', '--code-font', 'Fira Code', '--notifications', 'on']))
      .toMatchObject({ kind: 'preferences', autoTitles: false, archiveRetentionDays: 7, copyFormat: 'markdown', accentColor: '#112233', interfaceFont: null, codeFont: 'Fira Code', backgroundNotifications: true });
    expect(() => parseArguments(['preferences', '--retention', '5'])).toThrow('--retention');
    expect(() => parseArguments(['preferences', '--titles', 'maybe'])).toThrow('needs on or off');
    expect(() => parseArguments(['preferences', '--accent', 'blue'])).toThrow('--accent');
    expect(() => parseArguments(['status', '--titles', 'on'])).toThrow('does not take --titles');
    expect(CliRequest.safeParse({ op: 'preferences', token, connectionLimitMicros: 5_000_000 }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'preferences', token, providerConsent: ['openai'] }).success).toBe(false);
  });
});

describe('preferences', () => {
  it('shows and changes the looks and behaviour settings and nothing else', async () => {
    const operations = operationsWith();
    const before = store.workspace();
    const shown = await operations.run({ op: 'preferences', token }, signal) as Record<string, unknown>;
    expect(shown).toMatchObject({ language: before.language, theme: before.theme, autoTitles: before.autoTitles });
    const changed = await operations.run({ op: 'preferences', token, autoTitles: !before.autoTitles, archiveRetentionDays: 30, copyFormat: 'markdown', accentColor: '#112233', interfaceFont: 'Fira Sans', backgroundNotifications: false }, signal);
    expect(changed).toMatchObject({ autoTitles: !before.autoTitles, archiveRetentionDays: 30, copyFormat: 'markdown', accentColor: '#112233', interfaceFont: 'Fira Sans', backgroundNotifications: false });
    const after = store.workspace();
    expect(after.connectionLimitMicros).toBe(before.connectionLimitMicros);
    expect(after.providerConsent ?? []).toEqual(before.providerConsent ?? []);
    await operations.run({ op: 'preferences', token, interfaceFont: null }, signal);
    expect(store.workspace().interfaceFont).toBeUndefined();
    expect(formatPreferences(changed as never)).toContain('30');
  });
});

describe('a chat\'s assignee and limit', () => {
  it('lowers the limit and changes who answers, but never raises what a chat may spend', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await core.command('saveWorker', { ...first, id: undefined, name: 'Second orglet' }) as Worker;
    const chat = await newChat(first);
    const operations = operationsWith();
    await expect(operations.run({ op: 'chat-settings', token, chat: chat.id.slice(0, 8), budgetMicros: chat.budgetMicros + 1000 }, signal)).rejects.toThrow('hạ');
    expect(store.get<Task>('tasks', chat.id).budgetMicros).toBe(chat.budgetMicros);
    const lowered = await operations.run({ op: 'chat-settings', token, chat: chat.id.slice(0, 8), budgetMicros: 200_000 }, signal);
    expect(lowered).toMatchObject({ taskId: chat.id, budgetMicros: 200_000, with: [first.name] });
    const assigned = await operations.run({ op: 'chat-settings', token, to: first.name, names: ['Second orglet'] }, signal) as { with: string[] };
    expect(assigned.with).toEqual([second.name]);
    expect(store.get<Task>('tasks', chat.id)).toMatchObject({ workerId: second.id, budgetMicros: 200_000 });
    expect(formatChatSettings(assigned as never)).toContain('Second orglet');
    expect(CliRequest.safeParse({ op: 'chat-settings', token, to: 'x', toolCapabilities: ['workspace_write'] }).success).toBe(false);
  });

  it('keeps a channel\'s members for orglet members and refuses a chat that is running', async () => {
    const [first] = store.all<Worker>('workers');
    const channelId = await core.command('createChannel', { name: 'ideas', topic: '', members: [{ kind: 'orglet', id: first.id }] }) as string;
    const taskId = await core.command('createTask', { workerId: first.id, channelId, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    await expect(operationsWith().run({ op: 'chat-settings', token, chat: taskId.slice(0, 8), names: [first.name] }, signal)).rejects.toThrow('members');
    await expect(operationsWith({ updateTask: () => { throw new Error('Công việc đang chạy. Đợi xong rồi hãy đổi thiết lập.'); } }).run({ op: 'chat-settings', token, chat: taskId.slice(0, 8), budgetMicros: 100_000 }, signal)).rejects.toThrow('đang chạy');
  });
});

describe('spaces: folder, colour and order', () => {
  async function spaceWithChannels() {
    const [first] = store.all<Worker>('workers');
    const spaceId = await core.command('createSpace', { name: 'Launch', orgletIds: [first.id], categories: [] }) as string;
    const members = [{ kind: 'orglet' as const, id: first.id }];
    const ids: string[] = [];
    for (const name of ['one', 'two', 'three']) ids.push(await core.command('createChannel', { name, topic: '', members, spaceId, access: 'inherit' }) as string);
    return { spaceId, ids };
  }

  it('sets and clears a space\'s folder and colour without touching its orglets, categories or defaults', async () => {
    const { spaceId } = await spaceWithChannels();
    const operations = operationsWith();
    await operations.run({ op: 'space-change', token, verb: 'folder', space: 'Launch', names: [], value: 'Work' }, signal);
    await operations.run({ op: 'space-change', token, verb: 'color', space: 'Launch', names: [], value: '#7c8be8' }, signal);
    const space = store.workspace().spaces.find(item => item.id === spaceId)!;
    expect(space).toMatchObject({ folder: 'Work', color: '#7c8be8' });
    const cleared = await operations.run({ op: 'space-change', token, verb: 'folder', space: 'Launch', names: [] }, signal);
    expect(store.workspace().spaces.find(item => item.id === spaceId)).toMatchObject({ color: '#7c8be8' });
    expect(store.workspace().spaces.find(item => item.id === spaceId)).not.toHaveProperty('folder');
    expect(formatSpaceChange(cleared as never)).toContain('Launch');
    expect(CliRequest.safeParse({ op: 'space-change', token, verb: 'folder', space: 'Launch', names: [], defaults: { capabilities: ['workspace_write'] } }).success).toBe(false);
  });

  it('moves a channel to a place among its neighbours and keeps the others where they were', async () => {
    const { spaceId, ids } = await spaceWithChannels();
    const operations = operationsWith();
    const moved = await operations.run({ op: 'space-change', token, verb: 'order', space: 'Launch', names: [], channelName: 'three', position: 1 }, signal);
    expect(moved).toMatchObject({ verb: 'order', channel: 'three', position: 1 });
    const listed = await operations.run({ op: 'spaces', token }, signal) as { spaces: { name: string; channels: { name: string }[] }[] };
    expect(listed.spaces.find(item => item.name === 'Launch')!.channels.map(channel => channel.name)[0]).toBe('three');
    expect(store.workspace().channelOrder).toEqual(expect.arrayContaining(ids));
    await expect(operations.run({ op: 'space-change', token, verb: 'order', space: 'Launch', names: [], channelName: 'missing', position: 1 }, signal)).rejects.toThrow();
    expect(spaceId).toBeTruthy();
  });

  it('moves a category to a place among the space\'s categories', async () => {
    const { spaceId } = await spaceWithChannels();
    const operations = operationsWith();
    await operations.run({ op: 'space-change', token, verb: 'category', space: 'Launch', names: [], category: 'Ready' }, signal);
    await operations.run({ op: 'space-change', token, verb: 'category', space: 'Launch', names: [], category: 'Done' }, signal);
    await operations.run({ op: 'space-change', token, verb: 'order', space: 'Launch', names: [], category: 'Done', position: 1 }, signal);
    expect(store.workspace().spaces.find(item => item.id === spaceId)!.categories.map(category => category.name)).toEqual(['Done', 'Ready']);
  });
});

describe('the marketplace update', () => {
  const entityId = '44444444-4444-4444-8444-444444444444';
  const token64 = 'ab12cd34'.repeat(8);
  function marketCalls() {
    const calls: { command: string; args: unknown }[] = [];
    const overrides: Overrides = {
      marketInstallations: () => [{ entityId, kind: 'orglet', listingId: 'launch', version: 1, name: 'Launch orglet', updateAvailable: true }],
      marketPreviewUpdate: args => { calls.push({ command: 'marketPreviewUpdate', args }); return { entityId, listing: { version: 2 }, installedVersion: 1, token: token64, changes: [{ name: 'Instructions', before: 'Old', after: 'New' }] }; },
      marketApplyUpdate: args => { calls.push({ command: 'marketApplyUpdate', args }); return { entityId, kind: 'orglet', workerIds: [], fallbackNames: [] }; },
    };
    return { calls, overrides };
  }

  it('shows what changes with a code, and applies exactly the update the code names', async () => {
    const { calls, overrides } = marketCalls();
    const operations = operationsWith(overrides);
    const preview = await operations.run({ op: 'market', token, verb: 'update', installed: 'launch orglet', refresh: false }, signal) as { code: string; applied: boolean; changes: unknown[] };
    expect(preview).toMatchObject({ applied: false, code: 'ab12cd34', changes: [{ name: 'Instructions' }] });
    expect(calls.map(call => call.command)).toEqual(['marketPreviewUpdate']);
    expect(formatMarket(preview as never)).toContain('--confirm ab12cd34');
    await expect(operations.run({ op: 'market', token, verb: 'update', installed: 'Launch orglet', confirmCode: '00000000', refresh: false }, signal)).rejects.toThrow('Mã xác nhận');
    expect(calls.map(call => call.command)).not.toContain('marketApplyUpdate');
    const applied = await operations.run({ op: 'market', token, verb: 'update', installed: 'Launch orglet', confirmCode: 'ab12cd34', refresh: false }, signal);
    expect(applied).toMatchObject({ applied: true, version: 2 });
    expect(calls.at(-1)).toEqual({ command: 'marketApplyUpdate', args: { entityId, token: token64 } });
  });

  it('refuses a listing with no update and a name nothing was added under', async () => {
    const operations = operationsWith({ marketInstallations: () => [{ entityId, kind: 'orglet', listingId: 'launch', version: 2, name: 'Launch orglet', updateAvailable: false }] });
    await expect(operations.run({ op: 'market', token, verb: 'update', installed: 'Launch orglet', refresh: false }, signal)).rejects.toThrow('mới nhất');
    await expect(operations.run({ op: 'market', token, verb: 'update', installed: 'Nothing', refresh: false }, signal)).rejects.toThrow('Không có mục nào');
  });
});

describe('schedule notices', () => {
  it('dismisses a notice and runs a missed time through the two core commands', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const routine = { id: '55555555-5555-4555-8555-555555555555', name: 'Morning review', enabled: true, schedule: { frequency: 'daily', time: '08:00', weekday: 1, timeZone: 'UTC' }, task: { workerId: '66666666-6666-4666-8666-666666666666', brief: 'x', budgetMicros: 1000 } };
    const operations = operationsWith({
      workspace: () => ({ routines: [routine], workers: [], teams: [], tasks: [] }),
      dismissRoutine: args => { calls.push({ command: 'dismissRoutine', args }); },
      catchUpRoutine: args => { calls.push({ command: 'catchUpRoutine', args }); return '77777777-7777-4777-8777-777777777777'; },
    });
    const dismissed = await operations.run({ op: 'schedule-notice', token, schedule: 'morning review', action: 'dismiss' }, signal);
    expect(dismissed).toEqual({ schedule: { id: routine.id, name: routine.name }, action: 'dismiss' });
    const caught = await operations.run({ op: 'schedule-notice', token, schedule: 'Morning review', action: 'catch-up' }, signal);
    expect(caught).toMatchObject({ action: 'catch-up', taskId: '77777777-7777-4777-8777-777777777777' });
    expect(calls).toEqual([{ command: 'dismissRoutine', args: { id: routine.id } }, { command: 'catchUpRoutine', args: { id: routine.id } }]);
    expect(formatScheduleNotice(caught as never)).toContain('Morning review');
  });
});

describe('looking at the app', () => {
  const app: CliAppState = {
    connections: async () => ({ openai: true, anthropic: false, xai: false, openrouter: false, 'opencode-zen': false, 'opencode-go': false, ollama: false, custom: {}, search: { exa: true } }),
    changelog: async () => ({ releases: [{ version: '0.13.0', name: 'Release 0.13.0', notes: 'Notes', publishedAt: '2026-10-08T00:00:00.000Z', url: 'https://example.com/r' }], fetchedAt: '2026-10-09T00:00:00.000Z', stale: false }),
    updateState: () => ({ status: 'ready', version: '0.14.0' }),
    checkForUpdates: () => ({ status: 'checking' }),
  };

  async function show(what: string, extra: Record<string, unknown> = {}, overrides: Overrides = {}): Promise<ShowValue> {
    return await operationsWith(overrides, app).run({ op: 'show', token, what, refresh: false, ...extra } as never, signal) as ShowValue;
  }

  it('lists which connections and sign-ins exist as yes or no, never a key', async () => {
    const shown = await show('connections', {}, { harnesses: () => [{ id: 'codex', name: 'Codex', status: 'signed_in', authDetail: 'someone@example.com', executable: 'C:\\secret\\codex.exe' }] });
    expect(shown.rows).toEqual(expect.arrayContaining([{ connection: 'openai', kind: 'key', saved: true }, { connection: 'anthropic', kind: 'key', saved: false }, { connection: 'exa', kind: 'search', saved: true }, { connection: 'Codex', kind: 'sign-in', status: 'signed_in' }]));
    expect(JSON.stringify(shown)).not.toContain('example.com');
    expect(JSON.stringify(shown)).not.toContain('secret');
  });

  it('shows spend, the release notes and the updater', async () => {
    const spend = await show('spend');
    expect(spend.rows[0]).toMatchObject({ chargedMicros: expect.any(Number), reservedMicros: expect.any(Number), connectionLimitMicros: expect.any(Number) });
    expect((await show('changelog')).rows).toEqual([{ version: '0.13.0', name: 'Release 0.13.0', publishedAt: '2026-10-08T00:00:00.000Z', url: 'https://example.com/r' }]);
    expect((await show('update')).rows).toEqual([{ status: 'ready', version: '0.14.0' }]);
    expect(await operationsWith({}, app).run({ op: 'update-check', token }, signal)).toEqual({ status: 'checking' });
    await expect(operationsWith().run({ op: 'update-check', token }, signal)).rejects.toThrow('đang chạy');
  });

  it('lists a chat\'s sources by name and size, without where they came from', async () => {
    const [first] = store.all<Worker>('workers');
    const chat = await newChat(first);
    const shown = await show('sources', { chat: chat.id.slice(0, 8) }, { sourceMetadata: () => [{ id: 'a', name: 'notes.txt', bytes: 12, hash: 'h', revoked: false, format: 'text' }] });
    const withSource = await operationsWith({ sourceMetadata: () => [{ id: 'a', name: 'notes.txt', bytes: 12, hash: 'h', revoked: false }], workspace: async () => ({ ...store.workspace(), tasks: store.workspace().tasks.map(task => ({ ...task, sourceIds: ['a'] })) }) }, app).run({ op: 'show', token, what: 'sources', chat: chat.id.slice(0, 8), refresh: false }, signal) as ShowValue;
    expect(shown.rows).toEqual([]);
    expect(withSource.rows).toEqual([{ name: 'notes.txt', bytes: 12, revoked: false, format: null }]);
  });

  it('lists the journals and what a run changed, and never returns the review token', async () => {
    const [first] = store.all<Worker>('workers');
    const chat = await newChat(first);
    const reviewToken = 'f'.repeat(64);
    const runId = '88888888-8888-4888-8888-888888888888';
    const shown = await show('changes', { chat: chat.id.slice(0, 8) }, {
      workspaceRecovery: () => ({
        taskId: chat.id, truncated: false, restored: [], processes: [{ id: runId, runId, command: 'npm test', state: 'exited', exitCode: 0 }], uncertainCalls: [],
        attempts: [{ runId, reviewToken, retired: false }],
        copies: [{ runId, state: 'ready', kind: 'copy', changeCount: 1, changes: [{ path: 'src/a.ts', status: 'pending' }], review: { state: 'pending' } }],
      }),
    });
    expect(shown.rows).toEqual([
      { run: '88888888', copy: 'ready', kind: 'copy', review: 'pending', files: 1, path: null, status: null },
      { run: '88888888', copy: null, kind: 'write', review: null, files: null, path: 'src/a.ts', status: 'pending' },
    ]);
    expect(JSON.stringify(shown)).not.toContain(reviewToken);
    expect(shown.note).toContain('1 lệnh');
    const browser = await show('browser', { chat: chat.id.slice(0, 8) }, { browserActions: () => [{ at: '2026-10-10T00:00:00.000Z', kind: 'open', origin: 'https://example.com', target: null, risk: 'low', outcome: 'done', screenshotId: null }] });
    expect(browser.rows).toEqual([{ at: '2026-10-10T00:00:00.000Z', kind: 'open', origin: 'https://example.com', target: null, risk: 'low', outcome: 'done' }]);
    const desktop = await show('desktop', { chat: chat.id.slice(0, 8) }, { desktopActions: () => [] });
    expect(desktop.rows).toEqual([]);
    expect(formatShow(shown)).toContain('src/a.ts');
  });
});

describe('the terminal editor for a channel that takes turns', () => {
  it('lists it, edits its name, topic and members, and saves them as a channel patch', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await core.command('saveWorker', { ...first, id: undefined, name: 'Second orglet' }) as Worker;
    const operations = operationsWith();
    const catalog = ManagementCatalog.parse(await operations.run({ op: 'config', token }, signal));
    const channelId = await core.command('createChannel', { name: 'ideas', topic: 'Old', members: [{ kind: 'orglet', id: first.id }, { kind: 'orglet', id: second.id }] }) as string;
    const withChannel = ManagementCatalog.parse(await operations.run({ op: 'config', token }, signal));
    expect(catalog.channels).toEqual([]);
    const editor = new ManagementEditor('edit', withChannel, 'team', 'ideas');
    expect(editor.target).toEqual({ id: channelId });
    expect(editor.choices().map(choice => choice.label)).toEqual(['Name  ideas', 'Topic  Old', 'Members  2 selected', 'Save', 'Cancel']);
    editor.submit('Topic');
    editor.submit('New topic');
    editor.submit('Members');
    editor.submit(second.name);
    editor.submit('Done choosing');
    const saved = editor.submit('Save');
    expect(saved).toEqual({ action: 'save', kind: 'team', target: { id: channelId }, config: { name: 'ideas', topic: 'New topic', memberIds: [first.id], mode: 'turns' } });
    const result = await operations.run({ op: 'save-crew', token, config: (saved as { config: Record<string, unknown> }).config, target: { id: channelId } } as never, signal);
    expect(result).toMatchObject({ name: 'ideas', channelId });
    expect(store.workspace().emptyChannels.find(channel => channel.id === channelId)).toMatchObject({ topic: 'New topic', members: [{ kind: 'orglet', id: first.id }] });
  });
});

describe('the parity table for what this phase reaches', () => {
  it('says reached for the commands above and keeps saving a note held', () => {
    for (const key of ['updateTask', 'reorder', 'dismissRoutine', 'catchUpRoutine', 'marketPreviewUpdate', 'marketApplyUpdate', 'workspaceRecovery', 'sourceMetadata', 'browserActions', 'desktopActions', 'harnesses'] as const) {
      expect(COMMAND_PARITY[key].status, key).toBe('reached');
    }
    expect(COMMAND_PARITY.saveKnowledge.status).toBe('held');
    for (const key of ['applyWorkspaceReview', 'discardWorkspaceReview', 'restoreWorkspaceFile'] as const) expect(COMMAND_PARITY[key].status, key).toBe('held');
  });
});
