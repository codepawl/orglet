import { describe, expect, it } from 'vitest';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import { formatLibrary, formatRunning, formatSearch, formatUsage } from '../../apps/desktop/src/cli/output';
import { CliRequest, type LibraryValue, type ModelsValue, type PreferencesValue, type RunningValue, type SearchValue, type UsageValue } from '../../apps/desktop/src/cli/protocol';
import { parseSlash } from '../../apps/desktop/src/cli/slash';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { createCliToken } from '../../apps/desktop/src/main/cli-server';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';

/** Reading across the app from the terminal (COD-354): search, Running, Library, usage, models and preferences. */

const researcherId = '11111111-1111-4111-8111-111111111111';
const taskId = '44444444-4444-4444-8444-444444444444';
const approvedId = 'a1a1a1a1-0000-4000-8000-000000000000';
const proposedId = 'b2b2b2b2-0000-4000-8000-000000000000';
const noteId = 'c3c3c3c3-0000-4000-8000-000000000000';
const token = createCliToken();

function knowledge(id: string, extra: Partial<Knowledge>): Knowledge {
  return { id, title: 'T', content: 'Prefers short answers', tags: [], pinned: false, scope: { type: 'worker', id: researcherId }, kind: 'memory', revision: 1, status: 'approved', hash: 'x'.repeat(64), provenance: { kind: 'user' }, createdAt: '2026-10-01T10:00:00.000Z', ...extra } as Knowledge;
}

function fakeCore() {
  const calls: { command: string; args: unknown }[] = [];
  const settingsChanges: unknown[] = [];
  const workspace = {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'codex' }],
    teams: [],
    tasks: [{ id: taskId, workerId: researcherId, brief: 'Contract review', status: 'running', createdAt: '2026-10-01T09:00:00.000Z' }],
    knowledge: [knowledge(approvedId, {}), knowledge(proposedId, { status: 'proposed', content: 'Uses metric units' }), knowledge(noteId, { kind: 'note', title: 'Style guide', content: 'Write plainly', scope: { type: 'workspace' } })],
    running: [{ key: 'r', runId: 'r', taskId, state: 'queued', wait: { kind: 'provider', provider: 'codex', ahead: 1 }, worker: { id: researcherId, name: 'Researcher', provider: 'codex' }, provider: 'codex', since: Date.parse('2026-10-01T10:00:00.000Z') }],
    language: 'en',
    theme: 'system',
    connectionLimitMicros: 5_000_000,
  } as unknown as Workspace;
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return workspace;
    if (command === 'searchChats') return { terms: ['contract'], orgletIds: [researcherId], crewIds: [], chats: [{ taskId, messageId: approvedId, sender: { kind: 'you' }, snippet: [{ text: 'the ' }, { text: 'contract', match: true }, { text: ' terms' }], at: '2026-10-01T09:00:00.000Z' }], indexing: false };
    if (command === 'searchKnowledge') return [workspace.knowledge[2]];
    if (command === 'updateMemory') return { ...workspace.knowledge[0], content: (args as { text?: string }).text ?? 'Prefers short answers', pinned: true, revision: 2 };
    if (command === 'harnessUsage') return { codex: [{ accountId: 'default', email: 'person@example.com', plan: 'plus', windows: [{ kind: 'weekly', usedPercent: 42, resetsAt: '2026-10-05T00:00:00.000Z' }], checkedAt: '2026-10-01T10:00:00.000Z' }] };
    if (command === 'modelList') return { models: [{ provider: 'codex', id: 'gpt-5-codex', displayName: 'GPT-5 Codex' }], fetchedAt: '2026-10-01T10:00:00.000Z', stale: false, customIdOk: true, source: 'live' };
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message, settingsChanged: changes => { settingsChanges.push(changes); } });
  const signal = new AbortController().signal;
  const argsOf = (command: string) => calls.find(call => call.command === command)?.args;
  return { calls, operations, signal, argsOf, settingsChanges };
}

describe('orglet library arguments', () => {
  it('parses search, running, library, memory, usage, models and preferences', () => {
    expect(parseArguments(['search', 'contract terms'])).toEqual({ kind: 'search', query: 'contract terms', json: false });
    expect(parseArguments(['running', '--json'])).toEqual({ kind: 'running', json: true });
    expect(parseArguments(['library'])).toEqual({ kind: 'library', library: 'memory', json: false });
    expect(parseArguments(['library', 'notes', '--query', 'style', '--to', 'Researcher'])).toEqual({ kind: 'library', library: 'note', query: 'style', owner: 'Researcher', json: false });
    expect(parseArguments(['memory', 'edit', 'a1a1a1a1', '--text', 'New', '--pin'])).toEqual({ kind: 'memory-edit', id: 'a1a1a1a1', text: 'New', pinned: true, json: false });
    expect(parseArguments(['memory', 'delete', '#a1a1', '--yes'])).toEqual({ kind: 'memory-delete', id: 'a1a1', json: false });
    expect(parseArguments(['usage', '--refresh'])).toEqual({ kind: 'usage', refresh: true, json: false });
    expect(parseArguments(['models', 'openai'])).toEqual({ kind: 'models', provider: 'openai', refresh: false, json: false });
    expect(parseArguments(['models', '--to', 'Researcher'])).toEqual({ kind: 'models', to: 'Researcher', refresh: false, json: false });
    expect(parseArguments(['preferences', '--language', 'vi', '--theme', 'dark'])).toEqual({ kind: 'preferences', language: 'vi', theme: 'dark', json: false });
    expect(parseArguments(['preferences'])).toEqual({ kind: 'preferences', json: false });
  });

  it('refuses mistakes as usage errors', () => {
    const mistakes = [['search'], ['library', 'secrets'], ['memory', 'show', 'a1a1'], ['memory', 'delete', 'a1a1'], ['memory', 'edit', 'a1a1'], ['memory', 'edit', 'a1a1', '--pin', '--unpin'],
      ['memory', 'delete', 'a1a1', '--yes', '--text', 'x'], ['models'], ['models', 'nobody'], ['models', 'openai', '--to', 'R'], ['preferences', '--language', 'fr'], ['preferences', '--theme', 'blue'],
      ['status', '--refresh'], ['list', '--query', 'x'], ['send', 'hi', '--to', 'R', '--yes']];
    for (const mistake of mistakes) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    expect(parseSlash('/search contract')).toEqual({ kind: 'search', query: 'contract' });
    expect(parseSlash('/usage')).toEqual({ kind: 'plan-usage' });
    expect(parseSlash('/language en-gb')).toEqual({ kind: 'language', language: 'en-GB' });
    expect(parseSlash('/theme neon').kind).toBe('usage');
  });
});

describe('orglet library in the app', () => {
  it('searches chats and names, and lists the Running view', async () => {
    const core = fakeCore();
    const found = await core.operations.run({ op: 'search', token, query: 'contract' }, core.signal) as SearchValue;
    expect(found).toEqual({ orglets: ['Researcher'], crews: [], chats: [{ chat: '44444444', name: 'Researcher', sender: 'you', snippet: 'the contract terms', at: '2026-10-01T09:00:00.000Z' }], indexing: false });
    expect(formatSearch(found)).toBe('Orglets: Researcher\n  44444444  Researcher  you:  the contract terms');
    const running = await core.operations.run({ op: 'running', token }, core.signal) as RunningValue;
    expect(running.items).toEqual([{ chat: '44444444', name: 'Researcher', orglet: 'Researcher', state: 'queued', provider: 'codex', waitsFor: 'provider', since: '2026-10-01T10:00:00.000Z' }]);
    expect(formatRunning(running)).toBe('  44444444  Researcher  Researcher  queued  waits for provider  codex');
  });

  it('lists memories and notes, an orglet\'s own, or what a search finds', async () => {
    const core = fakeCore();
    const memories = await core.operations.run({ op: 'library', token, kind: 'memory', owner: 'res' }, core.signal) as LibraryValue;
    expect(memories.items.map(item => [item.short, item.status, item.owner])).toEqual([['a1a1a1a1', 'approved', 'Researcher'], ['b2b2b2b2', 'proposed', 'Researcher']]);
    expect(formatLibrary(memories)).toBe('a1a1a1a1  (Researcher)\n  Prefers short answers\n\nb2b2b2b2  (proposed · Researcher)\n  Uses metric units');
    const notes = await core.operations.run({ op: 'library', token, kind: 'note', query: 'style' }, core.signal) as LibraryValue;
    expect(core.argsOf('searchKnowledge')).toEqual({ query: 'style' });
    expect(notes.items.map(item => item.title)).toEqual(['Style guide']);
  });

  it('edits and deletes only an approved memory; a proposed one stays for the desktop to review', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'memory-edit', token, id: 'a1a1', text: 'Prefers bullet points', pinned: true }, core.signal);
    expect(core.argsOf('updateMemory')).toEqual({ id: approvedId, text: 'Prefers bullet points', pinned: true });
    await expect(core.operations.run({ op: 'memory-edit', token, id: 'b2b2', pinned: true }, core.signal)).rejects.toThrow('đang chờ duyệt');
    await expect(core.operations.run({ op: 'memory-delete', token, id: 'b2b2', confirmed: true }, core.signal)).rejects.toThrow('đang chờ duyệt');
    await expect(core.operations.run({ op: 'memory-edit', token, id: 'c3c3', text: 'x' }, core.signal)).rejects.toThrow('Không có ghi nhớ');
    await core.operations.run({ op: 'memory-delete', token, id: 'a1a1', confirmed: true }, core.signal);
    expect(core.argsOf('deleteMemory')).toEqual({ id: approvedId });
    expect(core.calls.filter(call => call.command === 'updateMemory' || call.command === 'deleteMemory')).toHaveLength(2);
    expect(CliRequest.safeParse({ op: 'memory-delete', token, id: 'a1a1' }).success).toBe(false);
    // Reviewing a proposal is a trust decision: no operation approves or archives one.
    expect(CliRequest.safeParse({ op: 'reviewKnowledge', token, id: proposedId, revision: 1, decision: 'approve' }).success).toBe(false);
  });

  it('reads plan usage with emails in part, and an orglet\'s model list', async () => {
    const core = fakeCore();
    const usage = await core.operations.run({ op: 'usage', token, refresh: true }, core.signal) as UsageValue;
    expect(core.argsOf('harnessUsage')).toEqual({ refresh: true });
    expect(usage.accounts[0].email).not.toContain('person@');
    expect(formatUsage(usage)).toContain('weekly  42%');
    const models = await core.operations.run({ op: 'models', token, to: 'res', refresh: false }, core.signal) as ModelsValue;
    expect(core.argsOf('modelList')).toEqual({ provider: 'codex' });
    expect(models.models).toEqual([{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }]);
  });

  it('changes only the language and theme, keeping every other setting, and tells main', async () => {
    const core = fakeCore();
    expect(await core.operations.run({ op: 'preferences', token }, core.signal)).toEqual({ language: 'en', theme: 'system' } satisfies PreferencesValue);
    expect(core.calls.some(call => call.command === 'settings')).toBe(false);
    await core.operations.run({ op: 'preferences', token, language: 'vi', theme: 'dark' }, core.signal);
    expect(core.argsOf('settings')).toEqual({ theme: 'dark', connectionLimitMicros: 5_000_000, language: 'vi' });
    expect(core.settingsChanges).toEqual([{ language: 'vi', theme: 'dark' }]);
    // Issue 554 phase 2 lets the terminal change the looks and behaviour settings (cli-reach.test.ts); consent, limits and providers stay out.
    for (const extra of [{ providerConsent: ['openai'] }, { showWork: false }, { connectionLimitMicros: 1 }, { webSearchProvider: 'exa' }, { providerConcurrency: 4 }]) {
      expect(CliRequest.safeParse({ op: 'preferences', token, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });
});
