import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Routine, Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { commands } from '../../apps/desktop/src/shared/contracts';
import { liveWorkerTask } from '../../apps/desktop/src/shared/live-task';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import { chatHeadline, FORWARD_TEXT_CHARS, forwardBrief, type ForwardResult } from '../../apps/desktop/src/shared/forward';
import { forwardOptions, forwardPreview, forwardSummary } from '../../apps/desktop/src/renderer/forward';
import { sendToOptions } from '../../apps/desktop/src/renderer/sendTo';
import { t } from '../../apps/desktop/src/renderer/i18n';

/*
 * COD-257: forwarding one message to other chats. Each place takes it as the person's own message, a turn that goes
 * through the same send path as typing it there; the chat keeps a record of where it came from; files go along only
 * when the person ticked them, and then as the target chat's own copy. No network: the adapter records every request.
 */

let directory: string; let store: Store; let core: CoreService;
let requests: string[];
let hold: Promise<void> | undefined;
let release: () => void = () => {};

const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } });
const scope = { sourceIds: [] as string[], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-forward-'));
  store = new Store(join(directory, 'state.sqlite'));
  requests = [];
  hold = undefined;
  const adapter: ModelAdapter = { async request(messages) {
    const text = JSON.stringify(messages);
    requests.push(text);
    if (hold && text.includes('HOLD')) await hold;
    return answer('The answer, with a detail worth passing on.');
  } };
  core = new CoreService(store, () => {}, async () => adapter);
});
afterEach(async () => { release(); await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId) || core.runner.isActive(taskId)).toBe(false);
}

/** Researcher and a second orglet, both on a fixture API connection. */
async function orglets(): Promise<[Worker, Worker]> {
  const first = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
  const { id: _id, ...draft } = first;
  const second = await core.command('saveWorker', { ...draft, name: 'Lan' }) as Worker;
  return [first, second];
}

async function chat(worker: Worker, brief: string, sourceIds: string[] = []): Promise<string> {
  const taskId = await core.command('createTask', { workerId: worker.id, brief, ...scope, sourceIds }) as string;
  await settled(taskId);
  return taskId;
}

const task = (taskId: string) => store.get<Task>('tasks', taskId);
const forward = (args: Record<string, unknown>) => core.command('forwardMessage', args) as Promise<ForwardResult>;
const firstAnswer = (taskId: string) => store.detail(taskId).artifacts[0];

async function sourceFile(name: string, text: string): Promise<Source> {
  const path = join(directory, name);
  await writeFile(path, text);
  const [source] = await core.sources.import([path]);
  return source;
}

describe('forwarding a message', () => {
  it('starts the orglet’s chat with it as the person’s message, and the orglet answers', async () => {
    const [researcher, lan] = await orglets();
    const origin = await chat(researcher, 'Find the numbers');
    const result = await forward({ taskId: origin, messageId: firstAnswer(origin).id, targets: [{ kind: 'worker', id: lan.id }] });

    expect(result.failed).toEqual([]);
    const target = result.sent[0].taskId;
    expect(liveWorkerTask(store.workspace().tasks, lan.id)?.id).toBe(target);
    await settled(target);
    const forwarded = task(target).currentInput?.forwarded;
    expect(forwarded).toMatchObject({ fromTaskId: origin, messageId: firstAnswer(origin).id, from: researcher.name, authorKind: 'orglet', author: researcher.name, text: 'The answer, with a detail worth passing on.', files: [] });
    expect(forwarded?.note).toBeUndefined();
    expect(task(target).brief).toBe(forwardBrief(forwarded!));
    // It is a turn like a typed one: a run, an answer, and the model read the forward.
    expect(task(target).status).toBe('completed');
    expect(store.detail(target).artifacts).toHaveLength(1);
    expect(requests.at(-1)).toContain('Forwarded from the chat');
    // The chat it came from is untouched.
    expect(task(origin).inputRevision ?? 0).toBe(0);
  });

  it('lands in an existing chat as its next turn, with the note first, and the earlier turn keeps its record', async () => {
    const [researcher, lan] = await orglets();
    const origin = await chat(researcher, 'Find the numbers');
    const target = await chat(lan, 'Hello Lan');
    const result = await forward({ taskId: origin, messageId: turnMessageId(origin, 0), note: 'Can you check this?', targets: [{ kind: 'task', id: target }] });
    expect(result.sent).toEqual([{ target: { kind: 'task', id: target }, taskId: target }]);
    await settled(target);
    expect(task(target).inputRevision).toBe(1);
    const forwarded = task(target).currentInput!.forwarded!;
    expect(forwarded).toMatchObject({ authorKind: 'person', text: 'Find the numbers', note: 'Can you check this?' });
    expect(task(target).currentInput!.brief.startsWith('Can you check this?')).toBe(true);
    // The run froze the same input, so the turn still reads as a forward after the next message.
    await core.command('reviseTask', { taskId: target, brief: 'Thanks', ...scope });
    await settled(target);
    const frozen = store.detail(target).runs.find(run => run.snapshot.inputRevision === 1)!.snapshot.input!;
    expect(frozen.forwarded).toEqual(forwarded);
  });

  it('sends files by name unless the person ticks them, and a ticked file is the target chat’s own copy', async () => {
    const [researcher, lan] = await orglets();
    const source = await sourceFile('invoice.csv', 'id,total\n1,20\n');
    const origin = await chat(researcher, 'Check the invoice', [source.id]);
    const messageId = turnMessageId(origin, 0);

    const namesOnly = await forward({ taskId: origin, messageId, targets: [{ kind: 'worker', id: lan.id }] });
    const first = namesOnly.sent[0].taskId;
    await settled(first);
    expect(task(first).sourceIds).toEqual([]);
    expect(task(first).currentInput!.forwarded!.files).toEqual([{ name: 'invoice.csv' }]);
    expect(task(first).brief).toContain('invoice.csv (not shared with this chat)');

    const carried = await forward({ taskId: origin, messageId, targets: [{ kind: 'task', id: first }], carrySourceIds: [source.id] });
    expect(carried.failed).toEqual([]);
    await settled(first);
    const copyId = task(first).currentInput!.forwarded!.files[0].sourceId!;
    expect(copyId).toBeDefined();
    expect(copyId).not.toBe(source.id);
    expect(task(first).currentInput!.sourceIds).toEqual([copyId]);
    expect(task(first).sourceIds).not.toContain(source.id);
    // Revoking the copy in the target chat leaves the original chat's file readable, and the reverse.
    await core.command('revoke', { id: copyId });
    expect(store.get<Source>('sources', source.id).revoked).toBe(false);

    await expect(forward({ taskId: origin, messageId, targets: [{ kind: 'worker', id: lan.id }], carrySourceIds: [id()] })).rejects.toThrow('tệp của chính tin này');
  });

  it('goes to several places at once, and one that cannot take it does not stop the others', async () => {
    const [researcher, lan] = await orglets();
    const { id: _id, ...draft } = lan;
    const minh = await core.command('saveWorker', { ...draft, name: 'Minh' }) as Worker;
    const origin = await chat(researcher, 'Find the numbers');
    let open!: () => void;
    hold = new Promise(resolve => { open = resolve; });
    release = open;
    const busy = await core.command('createTask', { workerId: lan.id, brief: 'HOLD this one', ...scope }) as string;

    const result = await forward({ taskId: origin, messageId: firstAnswer(origin).id, targets: [
      { kind: 'task', id: busy }, { kind: 'worker', id: minh.id }, { kind: 'task', id: origin },
    ] });
    expect(result.sent.map(item => item.target)).toEqual([{ kind: 'worker', id: minh.id }]);
    expect(result.failed.map(item => [item.name, item.error])).toEqual([
      ['Lan', 'Chat này đang làm. Chuyển tiếp sau khi xong.'],
      [researcher.name, 'Tin này đã ở trong chat đó.'],
    ]);
    // The busy chat was not interrupted.
    expect(task(busy).inputRevision ?? 0).toBe(0);
    open();
    await settled(busy);
    await settled(result.sent[0].taskId);

    await expect(forward({ taskId: origin, messageId: firstAnswer(origin).id, targets: [{ kind: 'worker', id: minh.id }, { kind: 'worker', id: minh.id }] })).rejects.toThrow('trùng');
    // An orglet and its main chat from Recent are one place.
    const lanChat = liveWorkerTask(store.workspace().tasks, lan.id)!.id;
    await expect(forward({ taskId: origin, messageId: firstAnswer(origin).id, targets: [{ kind: 'task', id: lanChat }, { kind: 'worker', id: lan.id }] })).rejects.toThrow('trùng');
    const six = Array.from({ length: 6 }, () => ({ kind: 'worker' as const, id: minh.id }));
    await expect(forward({ taskId: origin, messageId: firstAnswer(origin).id, targets: six })).rejects.toThrow();
  });

  it('never lets the window write a forward into an ordinary message', () => {
    const forged = { taskId: id(), brief: 'Hi', ...scope, forwarded: { fromTaskId: id(), messageId: id(), from: 'X', authorKind: 'orglet', author: 'X', text: 'Made up', files: [] } };
    expect(commands.reviseTask.safeParse(forged).success).toBe(false);
    expect(commands.startSideThread.safeParse(forged).success).toBe(false);
  });

  it('keeps a side thread inside its main chat’s files', async () => {
    const [researcher, lan] = await orglets();
    const source = await sourceFile('notes.md', '# Notes\n');
    const origin = await chat(researcher, 'Read my notes', [source.id]);
    const main = await chat(lan, 'Hello Lan');
    const side = await core.command('startSideThread', { taskId: main, brief: 'On the side', ...scope }) as string;
    await settled(side);
    const refused = await forward({ taskId: origin, messageId: turnMessageId(origin, 0), targets: [{ kind: 'task', id: side }], carrySourceIds: [source.id] });
    expect(refused.failed[0].error).toContain('Chat phụ chỉ dùng tệp của chat chính');
    const named = await forward({ taskId: origin, messageId: turnMessageId(origin, 0), targets: [{ kind: 'task', id: side }] });
    expect(named.sent).toHaveLength(1);
    await settled(side);
    expect(task(side).currentInput!.sourceIds).toEqual([]);
  });

  it('reads @ tags in a group chat from the note only', async () => {
    const [researcher, lan] = await orglets();
    const { id: _id, ...draft } = lan;
    const minh = await core.command('saveWorker', { ...draft, name: 'Minh' }) as Worker;
    const origin = await chat(researcher, '@Lan should do this');
    const group = await core.command('createTask', { workerId: lan.id, assignees: [lan.id, minh.id], brief: 'Hi both', ...scope, providerScopes: ['openai'] }) as string;
    await settled(group);

    await forward({ taskId: origin, messageId: turnMessageId(origin, 0), targets: [{ kind: 'task', id: group }] });
    await settled(group);
    const answeredBy = (revision: number) => store.detail(group).runs.filter(run => run.snapshot.inputRevision === revision).map(run => run.snapshot.worker.name).sort();
    expect(answeredBy(1)).toEqual(['Lan', 'Minh']);

    await forward({ taskId: origin, messageId: turnMessageId(origin, 0), note: '@Minh your turn', targets: [{ kind: 'task', id: group }] });
    await settled(group);
    expect(answeredBy(2)).toEqual(['Minh']);
  });

  it('forwards a forward as the original, cuts a long message, and survives a backup', async () => {
    const [researcher, lan] = await orglets();
    const { id: _id, ...draft } = lan;
    const minh = await core.command('saveWorker', { ...draft, name: 'Minh' }) as Worker;
    const origin = await chat(researcher, 'x'.repeat(FORWARD_TEXT_CHARS + 50));
    const first = (await forward({ taskId: origin, messageId: turnMessageId(origin, 0), note: 'Look', targets: [{ kind: 'worker', id: lan.id }] })).sent[0].taskId;
    await settled(first);
    expect(task(first).currentInput!.forwarded!.text).toHaveLength(FORWARD_TEXT_CHARS + 1);
    expect(task(first).brief.length).toBeLessThanOrEqual(16_000);

    const second = (await forward({ taskId: first, messageId: turnMessageId(first, 0), targets: [{ kind: 'worker', id: minh.id }] })).sent[0].taskId;
    await settled(second);
    expect(task(second).currentInput!.forwarded).toMatchObject({ fromTaskId: origin, messageId: turnMessageId(origin, 0), from: researcher.name, authorKind: 'person' });
    expect(task(second).currentInput!.forwarded!.note).toBeUndefined();

    const text = new Backups(store, () => false, () => {}).export();
    const restored = new Store(join(directory, 'restored.sqlite'));
    try {
      const backups = new Backups(restored, () => false, () => {});
      backups.restore(backups.preview(text).token);
      expect(restored.get<Task>('tasks', second).currentInput?.forwarded?.from).toBe(researcher.name);
    } finally {
      restored.close();
    }
  });
});

describe('naming a chat that began with a forward (COD-285)', () => {
  const titleOf = (taskId: string) => store.workspace().tasks.find(item => item.id === taskId)?.title;

  it('goes by what was forwarded, never by the prompt text around it or the note', async () => {
    const [researcher, lan] = await orglets();
    const origin = await chat(researcher, 'Find the numbers');
    // Dogfood round 5: the chat was titled `Forwarded from the chat "Writer", written by…`, or after the note.
    const result = await forward({ taskId: origin, messageId: firstAnswer(origin).id, note: 'Please tighten this', targets: [{ kind: 'worker', id: lan.id }] });
    const target = result.sent[0].taskId;
    expect(chatHeadline(task(target))).toBe('The answer, with a detail worth passing on.');
    await settled(target);
    expect(titleOf(target)).toBe('The answer, with a detail worth passing on');
  });

  it('keeps that name with automatic titles off, also after the next message', async () => {
    const [researcher, lan] = await orglets();
    const origin = await chat(researcher, 'Find the numbers');
    await core.command('settings', { ...store.workspace(), autoTitles: false });
    const result = await forward({ taskId: origin, messageId: turnMessageId(origin, 0), targets: [{ kind: 'worker', id: lan.id }] });
    const target = result.sent[0].taskId;
    await settled(target);
    expect(titleOf(target)).toBeUndefined();
    expect(chatHeadline(task(target))).toBe('Find the numbers');
    await core.command('reviseTask', { taskId: target, brief: 'Thanks', ...scope });
    await settled(target);
    expect(titleOf(target)).toBe('Find the numbers');
    // An ordinary chat still goes by its first message.
    expect(chatHeadline(task(origin))).toBe('Find the numbers');
  });
});

describe('the forward picker’s places', () => {
  it('tells a schedule’s runs apart by the schedule they came from (COD-285)', async () => {
    const [researcher] = await orglets();
    const first = await chat(researcher, 'Write today’s standup note');
    const second = await chat(researcher, 'Write today’s standup note');
    const workspace = store.workspace();
    const routineId = id();
    const tasks = workspace.tasks.map(item => item.id === first || item.id === second ? { ...item, routineId } : item);
    const routines = [{ id: routineId, name: 'Daily note' } as Routine];
    const rows = sendToOptions({ ...workspace, tasks, routines }, 5).filter(option => option.group === 'recent' && [first, second].includes(option.target.id));
    expect(rows).toHaveLength(2);
    expect(rows.every(option => option.detail === t('lịch · {0}', ['Daily note']))).toBe(true);
  });

  it('leaves out the chat the message is in, joins an orglet with its main chat, and marks the ones that cannot take it', async () => {
    const [researcher, lan] = await orglets();
    const origin = await chat(researcher, 'Find the numbers');
    const lanChat = await chat(lan, 'Hello Lan');
    const workspace = store.workspace();
    const options = forwardOptions(workspace, origin, workers => workers.every(worker => worker.name !== 'Lan'));
    expect(options.some(option => option.chatKey === origin)).toBe(false);
    const lanRows = options.filter(option => option.chatKey === lanChat);
    expect(lanRows.map(option => option.group).sort()).toEqual(['orglets', 'recent']);
    expect(lanRows.every(option => option.unavailable === 'Chưa kết nối' || option.unavailable === 'Not connected')).toBe(true);
    const researcherRow = options.find(option => option.group === 'orglets' && option.forwardTarget.id === researcher.id);
    expect(researcherRow).toBeUndefined();
  });

  it('says where a forward did not go and why', () => {
    const text = forwardSummary(1, [{ name: 'Lan', error: 'Chat này đang làm. Chuyển tiếp sau khi xong.' }]);
    expect(text).toMatch(/Lan/);
    expect(forwardSummary(0, [{ name: 'Lan', error: 'x' }])).toMatch(/Lan: x/);
  });

  it('shows the message in the picker as plain text, the way the chat reads it', () => {
    // Dogfood, 2026-09-26: the head read "Dev: From `src/cart.js` and `test/cart.test.js`, these cases aren't covered: - …".
    const preview = forwardPreview({ author: 'Dev', text: '## Gaps\nFrom `src/cart.js`, these cases aren’t covered:\n\n- **Negative** coupons\n- [Rounding](https://example.com)' });
    expect(preview).toBe(t('{0}: {1}', ['Dev', 'Gaps From src/cart.js, these cases aren’t covered: Negative coupons Rounding']));
  });
});