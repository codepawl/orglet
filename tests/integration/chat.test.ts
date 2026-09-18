import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { taskTitle } from '../../apps/desktop/src/core/orchestration/runner';
import { markdownToPlain } from '../../apps/desktop/src/shared/plainText';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string; let store: Store; let core: CoreService;
let replies: ModelReply[]; let sent: { messages: unknown[]; tools: string[] }[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-chat-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; sent = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, tools) {
      sent.push({ messages: structuredClone(messages), tools: tools.map(tool => tool.type === 'function' ? tool.function.name : '') });
      const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply;
    },
  }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 200, output: 50 } });
const until = async (check: () => boolean) => { for (let tries = 0; tries < 200 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
const chatWorker = async (provider: Worker['provider']) => { const worker = store.all<Worker>('workers')[0]; await core.command('saveWorker', { ...worker, provider }); return worker.id; };
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };

it('answers as a normal chat message and keeps earlier turns for the next message', async () => {
  const workerId = await chatWorker('openai');
  replies.push(answer('Chào bạn, mình đây.'));
  const taskId = await core.command('createTask', { workerId, brief: 'Chào bạn', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  const first = store.detail(taskId).artifacts[0].report;
  expect(first).toMatchObject({ format: 'chat', summary: 'Chào bạn, mình đây.', findings: [], limitations: [] });
  expect(sent[0].tools).toContain('reply');

  replies.push(answer('Bạn vừa chào mình.'));
  await core.command('reviseTask', { taskId, brief: 'Mình vừa nói gì?', ...scope });
  await until(() => store.detail(taskId).artifacts.length === 2 && store.detail(taskId).task.status === 'completed');
  const history = (sent[1].messages as { role: string; content: string }[]).map(message => message.content).find(content => content.includes('earlierConversation'));
  expect(JSON.parse(history!).earlierConversation).toEqual([{ from: 'user', text: 'Chào bạn' }, { from: 'you', text: 'Chào bạn, mình đây.' }]);
  expect(JSON.parse((sent[1].messages as { content: string }[]).at(-1)!.content).brief).toBe('Mình vừa nói gì?');
});

it('lets the demo worker reply in chat instead of producing a sample report', async () => {
  const workerId = await chatWorker('demo');
  const taskId = await core.command('createTask', { workerId, brief: 'Làm được gì?', ...scope, consent: false, providerScopes: [] }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  expect(store.detail(taskId).artifacts[0].report.format).toBe('chat');
});

const named = (message: string, title: string | null): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, title, knowledgeProposals: [] }) }], usage: { input: 200, output: 50 } });

it('names a task from its first reply, keeps names the user set, and can be turned off', async () => {
  const workerId = await chatWorker('openai');
  replies.push(named('Đây là kế hoạch.', 'Kế hoạch ra mắt quý 4'));
  const first = await core.command('createTask', { workerId, brief: 'Lên kế hoạch ra mắt sản phẩm cho quý 4 giúp mình nhé', ...scope }) as string;
  await until(() => store.detail(first).task.status === 'completed');
  expect(JSON.parse((sent[0].messages as { content: string }[]).at(-1)!.content).nameChat).toBe(true);
  expect((await core.command('workspace', {}) as { tasks: { id: string; title?: string }[] }).tasks.find(task => task.id === first)?.title).toBe('Kế hoạch ra mắt quý 4');

  // A later reply does not rename the chat.
  replies.push(named('Thêm chi tiết.', 'Tên khác'));
  await core.command('reviseTask', { taskId: first, brief: 'Chi tiết hơn', ...scope });
  await until(() => store.detail(first).artifacts.length === 2 && store.detail(first).task.status === 'completed');
  expect(JSON.parse((sent[1].messages as { content: string }[]).at(-1)!.content).nameChat).toBe(false);
  expect(store.setting<Record<string, string>>('taskTitles', {})[first]).toBe('Kế hoạch ra mắt quý 4');

  await core.command('settings', { autoTitles: false, theme: 'system', connectionLimitMicros: 5_000_000 });
  replies.push(named('Ok.', 'Không dùng'));
  const second = await core.command('createTask', { workerId, brief: 'Một câu hỏi nhanh', ...scope }) as string;
  await until(() => store.detail(second).task.status === 'completed');
  expect(store.setting<Record<string, string>>('taskTitles', {})[second]).toBeUndefined();
});

it('falls back to a shortened first line when the model gives no title', () => {
  const chat = { format: 'chat' as const, title: 'x', summary: 'x', findings: [], limitations: [] };
  expect(taskTitle(null, chat, 'Hãy đọc giúp mình toàn bộ log huấn luyện hôm qua và tìm các bước bị lỗi rồi tóm tắt lại')).toBe('Hãy đọc giúp mình toàn bộ log huấn luyện hôm…');
  expect(taskTitle(null, chat, 'Chào bạn')).toBeUndefined();
  expect(taskTitle(null, { ...chat, format: 'report', title: 'Review dataset' }, 'Chào bạn')).toBe('Review dataset');
  expect(taskTitle('"Kế hoạch."', chat, 'Chào bạn')).toBe('Kế hoạch');
});

it('changes who a task is assigned to, its name and limit, but not while it runs', async () => {
  const workerId = await chatWorker('openai');
  const other = await core.command('saveWorker', { name: 'Kế toán', instructions: 'Help with accounting.', provider: 'openai', skillId: store.all<Worker>('workers')[0].skillId, taskBudgetMicros: 100_000 }) as Worker;
  replies.push(answer('Chào.'));
  const taskId = await core.command('createTask', { workerId, brief: 'Chào', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  await core.command('updateTask', { id: taskId, title: 'Sổ sách', assignee: { kind: 'workers', workerIds: [other.id] }, budgetMicros: 200_000 });
  const task = store.detail(taskId).task;
  expect(task).toMatchObject({ workerId: other.id, budgetMicros: 200_000 });
  expect(store.setting<Record<string, string>>('taskTitles', {})[taskId]).toBe('Sổ sách');

  // The new assignee answers the next message and sees the earlier chat.
  replies.push(answer('Mình tiếp nhận.'));
  await core.command('reviseTask', { taskId, brief: 'Tiếp nhé', ...scope });
  await until(() => store.detail(taskId).artifacts.length === 2 && store.detail(taskId).task.status === 'completed');
  expect(store.detail(taskId).runs.at(-1)!.snapshot.worker.id).toBe(other.id);
  expect(JSON.stringify(sent[1].messages)).toContain('Chào.');

  store.update('tasks', { ...store.detail(taskId).task, status: 'running' });
  await expect(core.command('updateTask', { id: taskId, title: '', assignee: { kind: 'workers', workerIds: [workerId] }, budgetMicros: 200_000 })).rejects.toThrow('đang chạy');
});

it('lets several workers, or all of them, answer each message in turn, each seeing the earlier replies', async () => {
  const workerId = await chatWorker('openai');
  const skillId = store.all<Worker>('workers')[0].skillId;
  const second = await core.command('saveWorker', { name: 'Kế toán', instructions: 'Help with accounting.', provider: 'openai', skillId, taskBudgetMicros: 100_000 }) as Worker;
  replies.push(answer('Chào từ Researcher.'));
  const taskId = await core.command('createTask', { workerId, brief: 'Chào cả nhóm', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');

  await core.command('updateTask', { id: taskId, title: '', assignee: { kind: 'workers', workerIds: [workerId, second.id] }, budgetMicros: 100_000 });
  replies.push(answer('Researcher đây.'), answer('Kế toán đây.'));
  await core.command('reviseTask', { taskId, brief: 'Mọi người điểm danh', ...scope });
  await until(() => store.detail(taskId).task.status === 'completed' && store.detail(taskId).runs.filter(run => run.stage === 'group').length === 2);
  const group = store.detail(taskId).runs.filter(run => run.stage === 'group');
  expect(group.map(run => run.snapshot.worker.id)).toEqual([workerId, second.id]);
  const earlier = (index: number) => JSON.parse((sent[index].messages as { content: string }[]).map(message => message.content).find(content => content.includes('earlierConversation'))!).earlierConversation;
  // The second worker sees the first worker's reply to the same message by name.
  expect(earlier(2)).toContainEqual({ from: 'Researcher', text: 'Researcher đây.' });
  expect(earlier(2)).toContainEqual({ from: 'Researcher', text: 'Chào từ Researcher.' });

  await core.command('updateTask', { id: taskId, title: '', assignee: { kind: 'all' }, budgetMicros: 100_000 });
  expect(store.detail(taskId).task.assignees).toBe('all');
  const third = await core.command('saveWorker', { name: 'Người mới', instructions: 'Help.', provider: 'openai', skillId, taskBudgetMicros: 100_000 }) as Worker;
  replies.push(answer('1'), answer('2'), answer('3'));
  await core.command('reviseTask', { taskId, brief: 'Tất cả nhé', ...scope });
  await until(() => store.detail(taskId).task.status === 'completed' && store.detail(taskId).runs.filter(run => run.stage === 'group' && run.snapshot.inputRevision === 2).length === 3);
  expect(store.detail(taskId).runs.filter(run => run.snapshot.inputRevision === 2).map(run => run.snapshot.worker.id)).toContain(third.id);
  // Group runs survive a backup round trip check.
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});

it('lets @tags in a group chat limit who answers that turn', async () => {
  const workerId = await chatWorker('openai');
  const skillId = store.all<Worker>('workers')[0].skillId;
  const second = await core.command('saveWorker', { name: 'Kế toán', instructions: 'Help with accounting.', provider: 'openai', skillId, taskBudgetMicros: 100_000 }) as Worker;
  replies.push(answer('Chào từ Researcher.'));
  const taskId = await core.command('createTask', { workerId, brief: 'Chào cả nhóm', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  await core.command('updateTask', { id: taskId, title: '', assignee: { kind: 'workers', workerIds: [workerId, second.id] }, budgetMicros: 100_000 });
  replies.push(answer('Kế toán đây.'));
  await core.command('reviseTask', { taskId, brief: '@Kế toán điểm danh giúp', ...scope });
  await until(() => store.detail(taskId).task.status === 'completed' && store.detail(taskId).runs.some(run => run.stage === 'group' && run.snapshot.inputRevision === 1));
  const tagged = store.detail(taskId).runs.filter(run => run.stage === 'group' && run.snapshot.inputRevision === 1);
  expect(tagged.map(run => run.snapshot.worker.id)).toEqual([second.id]);
  expect(tagged).toHaveLength(1);
});

it('turns Markdown into readable plain text for copying', () => {
  expect(markdownToPlain('# Kế hoạch\n\n**Mục tiêu:** ra mắt *quý 4*\n\n- Việc `một`\n- Xem [tài liệu](https://example.com)\n\n```js\nlet x = 1;\n```')).toBe('Kế hoạch\n\nMục tiêu: ra mắt quý 4\n\n• Việc một\n• Xem tài liệu (https://example.com)\n\nlet x = 1;');
});
