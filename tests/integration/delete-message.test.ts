import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { DeletedMessages } from '../../apps/desktop/src/core/storage/deleted-messages';
import { collectTurns } from '../../apps/desktop/src/core/context/thread';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ChatSearchResult } from '../../apps/desktop/src/shared/chat-search';

/*
 * Deleting one message of a chat on this computer: the person's own message or an orglet's answer. The text is blanked
 * where it lives and the message is marked in a local table; runs, usage and the rest of the chat stay as they were.
 * No network: the adapter is a fixture whose answers are chosen per message.
 */

let directory: string; let store: Store; let core: CoreService;
let answers: Record<string, string>;
const reply = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } });
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-delete-message-'));
  answers = {};
  store = new Store(join(directory, 'state.sqlite'));
  const adapter: ModelAdapter = { async request(messages) {
    const contents = messages.map(message => typeof message.content === 'string' ? message.content : '');
    const latest = contents.findLast(content => content.includes('"brief"'));
    const brief = latest ? (JSON.parse(latest) as { brief?: string }).brief ?? '' : '';
    const key = Object.keys(answers).find(item => brief.includes(item));
    return reply(key ? answers[key] : 'Noted.');
  } };
  core = new CoreService(store, () => {}, async () => adapter);
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
}

/** A chat with one answered turn per brief, in order. */
async function chat(briefs: string[]): Promise<string> {
  const worker = store.all<Worker>('workers')[0];
  const dev = await core.command('saveWorker', { ...worker, name: 'Dev', provider: 'openai' }) as Worker;
  const taskId = await core.command('createTask', { workerId: dev.id, brief: briefs[0], ...scope }) as string;
  await settled(taskId);
  for (const brief of briefs.slice(1)) {
    await core.command('reviseTask', { taskId, brief, ...scope });
    await settled(taskId);
  }
  return taskId;
}

const search = async (query: string) => await core.command('searchChats', { query }) as ChatSearchResult;
const turnId = (taskId: string, revision: number) => store.detail(taskId).savedTurns!.find(turn => turn.localRevision === revision)!.id;
const answerId = (taskId: string, contains: string) => store.detail(taskId).artifacts.find(artifact => artifact.report.summary.includes(contains))!.id;
const deleteMessage = (taskId: string, messageId: string) => core.command('deleteMessage', { taskId, messageId });
/** Everything that costs or records a run: the runs without the copy of the input, and the chat's usage. */
const runRecords = (taskId: string) => {
  const detail = store.detail(taskId);
  return JSON.stringify({ usage: detail.usage, runs: detail.runs.map(run => ({ ...run, snapshot: { ...run.snapshot, input: undefined } })) });
};

describe('deleting the person\'s message', () => {
  it('removes that message only: the answer stays, and the text, search hit and records behave', async () => {
    answers = { ZEBRA: 'The giraffe answer stays.' };
    const taskId = await chat(['Tell me about the ZEBRA crossing', 'A second question']);
    const before = runRecords(taskId);
    expect((await search('zebra')).chats).toHaveLength(1);

    await deleteMessage(taskId, turnId(taskId, 0));

    const detail = store.detail(taskId);
    expect(detail.deletedMessageIds).toEqual([turnId(taskId, 0)]);
    expect(JSON.stringify(detail)).not.toContain('ZEBRA');
    expect(detail.savedTurns!.find(turn => turn.localRevision === 0)!.input).toEqual({ brief: '(đã xóa)', sourceIds: [] });
    expect(detail.task.brief).toBe('(đã xóa)');
    expect(detail.artifacts.some(artifact => artifact.report.summary.includes('giraffe'))).toBe(true);
    expect((await search('zebra')).chats).toHaveLength(0);
    expect(runRecords(taskId)).toBe(before);
    expect(store.detail(taskId).savedTurns!.find(turn => turn.localRevision === 1)!.input.brief).toBe('A second question');
  });

  it('draws no message for it and no frame when nothing of the turn is left', async () => {
    answers = { ZEBRA: 'The giraffe answer stays.' };
    const taskId = await chat(['Tell me about the ZEBRA crossing', 'A second question']);
    const html = () => {
      const detail = store.detail(taskId);
      return renderToStaticMarkup(createElement(TaskThread, {
        detail, workspace: { workers: store.all<Worker>('workers'), skills: store.all<Skill>('skills'), tasks: [detail.task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
        proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
        proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
      }));
    };
    expect(html()).toContain('ZEBRA');
    expect(html().match(/class="chat-turn"/g)).toHaveLength(2);

    await deleteMessage(taskId, turnId(taskId, 0));
    expect(html()).not.toContain('ZEBRA');
    expect(html()).not.toContain('(đã xóa)');
    expect(html()).toContain('giraffe');
    expect(html().match(/class="person-message"/g)).toHaveLength(1);

    await deleteMessage(taskId, answerId(taskId, 'giraffe'));
    expect(html()).not.toContain('giraffe');
    expect(html().match(/class="chat-turn"/g)).toHaveLength(1);
  });
});

describe('deleting an answer', () => {
  it('blanks its text, takes it out of search and leaves the run and its usage alone', async () => {
    answers = { second: 'The MARMOT result is ready.' };
    const taskId = await chat(['First question', 'second question']);
    const before = runRecords(taskId);
    expect((await search('marmot')).chats).toHaveLength(1);

    await deleteMessage(taskId, answerId(taskId, 'MARMOT'));

    expect(JSON.stringify(store.detail(taskId))).not.toContain('MARMOT');
    expect((await search('marmot')).chats).toHaveLength(0);
    expect(runRecords(taskId)).toBe(before);
    expect(store.detail(taskId).savedTurns!.map(turn => turn.input.brief)).toEqual(['First question', 'second question']);
  });
});

describe('what later turns read', () => {
  it('leaves a deleted message and a deleted answer out of the compiled history', async () => {
    answers = { ZEBRA: 'The MARMOT answer to it.' };
    const taskId = await chat(['Tell me about the ZEBRA crossing', 'A second question', 'A third question']);
    const compiled = () => {
      const detail = store.detail(taskId);
      const last = detail.runs.at(-1)!;
      return JSON.stringify(collectTurns(detail, last).past);
    };
    expect(compiled()).toContain('ZEBRA');
    expect(compiled()).toContain('MARMOT');

    await deleteMessage(taskId, turnId(taskId, 0));
    expect(compiled()).not.toContain('ZEBRA');
    expect(compiled()).toContain('MARMOT');
    await deleteMessage(taskId, answerId(taskId, 'MARMOT'));
    expect(compiled()).not.toContain('MARMOT');
    expect(compiled()).toContain('A second question');
  });
});

describe('a reply that quoted the deleted message', () => {
  it('keeps its own words and shows the quote as deleted', async () => {
    const taskId = await chat(['Question about the ZEBRA crossing']);
    const quoted = answerId(taskId, 'Noted');
    await core.command('reviseTask', { taskId, brief: 'Following up on that', replyTo: quoted, ...scope });
    await settled(taskId);
    const render = () => {
      const detail = store.detail(taskId);
      return renderToStaticMarkup(createElement(TaskThread, {
        detail, workspace: { workers: store.all<Worker>('workers'), skills: store.all<Skill>('skills'), tasks: [detail.task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
        proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
        proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
      }));
    };
    expect(render()).toContain('Open original message: Dev: Noted');

    await deleteMessage(taskId, quoted);
    const html = render();
    expect(html).toContain('Following up on that');
    expect(html).toContain('Open original message: Deleted message');
    expect(html).not.toContain('Dev: Noted');
  });
});

describe('what is refused', () => {
  it('refuses while the chat is working, and the message stays', async () => {
    const taskId = await chat(['Question about the ZEBRA crossing']);
    const messageId = turnId(taskId, 0);
    store.update('tasks', { ...store.get<Task>('tasks', taskId), status: 'running' });
    await expect(deleteMessage(taskId, messageId)).rejects.toThrow('Cuộc trò chuyện đang chạy');
    expect(new DeletedMessages(store).has(messageId)).toBe(false);
    expect(store.detail(taskId).savedTurns![0].input.brief).toContain('ZEBRA');
  });

  it('refuses a message that is not in the chat, and a second delete of the same one changes nothing', async () => {
    const taskId = await chat(['Question about the ZEBRA crossing']);
    await expect(deleteMessage(taskId, id())).rejects.toThrow('Không tìm thấy tin nhắn');
    const messageId = turnId(taskId, 0);
    await deleteMessage(taskId, messageId);
    const once = JSON.stringify(store.detail(taskId));
    await expect(deleteMessage(taskId, messageId)).resolves.toBeUndefined();
    expect(JSON.stringify(store.detail(taskId))).toBe(once);
    expect(store.detail(taskId).deletedMessageIds).toEqual([messageId]);
  });

  it('takes the reactions on the message with it', async () => {
    const taskId = await chat(['Question about the ZEBRA crossing']);
    const messageId = answerId(taskId, 'Noted');
    await core.command('setMessageReaction', { taskId, messageId, emoji: 'agree', active: true });
    expect(store.get<Task>('tasks', taskId).messageReactions).toHaveLength(1);
    await deleteMessage(taskId, messageId);
    expect(store.get<Task>('tasks', taskId).messageReactions ?? []).toHaveLength(0);
    await expect(core.command('setMessageReaction', { taskId, messageId, emoji: 'agree', active: true })).rejects.toThrow('đã bị xóa');
  });
});
