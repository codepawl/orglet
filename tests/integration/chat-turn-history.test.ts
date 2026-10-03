import { afterEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { ChatSearch } from '../../apps/desktop/src/core/storage/chat-search';
import { Forwards } from '../../apps/desktop/src/core/orchestration/forwards';
import { collectTurns } from '../../apps/desktop/src/core/context/thread';
import { chatTurns, resolveMessage, savedTurnInput } from '../../apps/desktop/src/main/cli-chat-history';
import { CliChatActions } from '../../apps/desktop/src/main/cli-chat-actions';
import { chatTurnInput, chatTurnMessageId, chatTurnRevisions } from '../../apps/desktop/src/shared/chat-turns';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

function legacyMissingInput() {
  const store = new Store(':memory:');
  stores.push(store);
  const worker = store.all<Worker>('workers')[0];
  const skill = store.all<Skill>('skills')[0];
  const task: Task = {
    id: id(), workerId: worker.id, brief: 'ORIGINALBASELINE first message', sourceIds: [],
    consent: false, accepted: false, budgetMicros: 1000, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z',
    inputRevision: 4, currentTurnCreatedAt: '2026-01-01T00:04:00.000Z',
    currentInput: { brief: 'KNOWNFOLLOWUP current question', sourceIds: [] },
  };
  store.put('tasks', task);
  const run: Run = {
    id: id(), taskId: task.id, status: 'partial', error: 'Saved partial answer', startedAt: '2026-01-01T00:02:00.000Z',
    snapshot: { worker, skill, inputRevision: 2 },
  };
  const artifact: Artifact = {
    id: id(), runId: run.id, report: { format: 'chat', title: 'Saved answer', summary: 'RECOVERABLEANSWER evidence survives', findings: [], limitations: ['Partial result'] },
    hash: 'a'.repeat(64), createdAt: '2026-01-01T00:03:00.000Z',
  };
  // This represents an existing legacy row whose original input was never saved. Going through new turn writes
  // would test a new capture instead of the migration/history case.
  const original: Run = { ...run, id: id(), status: 'completed', error: null, startedAt: task.createdAt,
    snapshot: { worker, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } } };
  store.db.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(original.id, task.id, JSON.stringify(original));
  store.db.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(run.id, task.id, JSON.stringify(run));
  store.db.prepare('INSERT INTO artifacts(id,run_id,data) VALUES(?,?,?)').run(artifact.id, run.id, JSON.stringify(artifact));
  return { store, task, run, artifact, detail: store.detail(task.id) };
}

it('retains frozen run aliases and answers while omitting gaps without saved messages or runs', () => {
  const { detail, artifact } = legacyMissingInput();
  expect(chatTurnRevisions(detail)).toEqual([0, 2, 4]);
  expect(chatTurnInput(detail, 2)).toBeUndefined();
  const history = chatTurns(detail, 20);
  expect(history.turns.map(turn => turn.number)).toEqual([1, 2, 3]);
  expect(history.turns.find(turn => turn.number === 2)?.text).toBe('');
  expect(history.turns.find(turn => turn.number === 2)?.answers[0].text).toContain('RECOVERABLEANSWER');
  expect(resolveMessage(detail, '2.1').messageId).toBe(artifact.id);
  expect(resolveMessage(detail, '2').messageId).toBe(chatTurnMessageId(detail, 2));
  expect(() => resolveMessage(detail, '4')).toThrow('Không có tin nhắn');
});

it('refuses to reconstruct a missing edit or forward body and still supplies the saved answer as context', () => {
  const { store, task, run, detail } = legacyMissingInput();
  expect(savedTurnInput(detail, 2)).toBeUndefined();
  expect(() => new Forwards(store).message(task, chatTurnMessageId(detail, 2))).toThrow('Không tìm thấy tin nhắn');
  const current: Run = { ...run, id: id(), status: 'queued', error: null, snapshot: { ...run.snapshot, inputRevision: 4, input: task.currentInput } };
  const { past } = collectTurns(detail, current);
  expect(past.some(turn => turn.revision === 2 && turn.from === 'user')).toBe(false);
  expect(past.some(turn => turn.revision === 2 && turn.text.includes('RECOVERABLEANSWER'))).toBe(true);
});

it('rebuilds answer search even when the original message text is unavailable', () => {
  const { store, task, artifact } = legacyMissingInput();
  const search = new ChatSearch(store);
  search.rebuild();
  const rows = store.db.prepare('SELECT message_id,kind,text FROM chat_messages WHERE task_id=?').all(task.id);
  expect(rows.filter(row => row.kind === 'message')).toHaveLength(2);
  expect(rows.some(row => row.message_id === artifact.id && String(row.text).includes('RECOVERABLEANSWER'))).toBe(true);
  const result = search.search('RECOVERABLEANSWER');
  expect(result.chats).toHaveLength(1);
  expect(result.chats[0].taskId).toBe(task.id);
});

it('keeps the CLI missing-input edit refusal before any write', async () => {
  const { store, task, detail } = legacyMissingInput();
  const writes: string[] = [];
  const actions = new CliChatActions({
    request: async command => {
      if (command === 'workspace') return store.workspace();
      if (command === 'task') return detail;
      writes.push(command);
      throw new Error('Unexpected write');
    },
    version: () => 'test', open: () => undefined, translate: message => message,
  });
  await expect(actions.revise({ op: 'revise', token: 'a'.repeat(64), chat: task.id, message: '2', text: 'Corrected text', wait: false, timeoutSeconds: 5 }, new AbortController().signal))
    .rejects.toThrow('thiếu bản lưu đầu vào');
  expect(writes).toEqual([]);
});
