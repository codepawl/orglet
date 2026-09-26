import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now, SCHEMA_VERSION } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { CHAT_SEARCH_BACKFILL } from '../../apps/desktop/src/core/storage/chat-search';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Artifact, Routine, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import { markMatches, matchesEveryWord, plainSearchText, searchTerms, snippetOf, type ChatSearchResult, type SnippetPart } from '../../apps/desktop/src/shared/chat-search';

/*
 * COD-267: Ctrl+K search covers every message the person sent, every answer, side threads, scheduled chats, chat
 * titles and orglet and crew names, from an FTS5 index the core writes with each message and answer and fills for
 * older chats after an upgrade. No network: the adapter is a fixture whose answers are chosen per message.
 */

let directory: string; let store: Store; let core: CoreService;
/** What the fixture orglet answers to a message containing the key; anything else gets a plain acknowledgement. */
let answers: Record<string, string>;

const reply = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } });
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

function openStore() {
  store = new Store(join(directory, 'state.sqlite'));
  const adapter: ModelAdapter = { async request(messages) {
    const contents = messages.map(message => typeof message.content === 'string' ? message.content : '');
    const latest = contents.findLast(content => content.includes('"brief"'));
    const brief = latest ? (JSON.parse(latest) as { brief?: string }).brief ?? '' : '';
    const key = Object.keys(answers).find(item => brief.includes(item));
    return reply(key ? answers[key] : 'Noted.');
  } };
  core = new CoreService(store, () => {}, async () => adapter);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-chat-search-'));
  answers = {};
  openStore();
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId) || core.runner.isActive(taskId)).toBe(false);
}

async function orglet(name = 'Dev'): Promise<Worker> {
  const worker = store.all<Worker>('workers')[0];
  return await core.command('saveWorker', { ...worker, name, provider: 'openai' }) as Worker;
}

/** A chat with one answered turn per brief, in order. */
async function chat(worker: Worker, briefs: string[]): Promise<string> {
  const taskId = await core.command('createTask', { workerId: worker.id, brief: briefs[0], ...scope }) as string;
  await settled(taskId);
  for (const brief of briefs.slice(1)) {
    await core.command('reviseTask', { taskId, brief, ...scope });
    await settled(taskId);
  }
  return taskId;
}

const search = async (query: string) => await core.command('searchChats', { query }) as ChatSearchResult;
const text = (parts: readonly SnippetPart[]) => parts.map(part => part.text).join('');
const marked = (parts: readonly SnippetPart[]) => parts.filter(part => part.match).map(part => part.text);
const answerOf = (taskId: string, contains: string) => store.detail(taskId).artifacts.find(artifact => artifact.report.summary.includes(contains)) as Artifact;

describe('what is indexed', () => {
  it('finds a later message and an answer, and opens each at its own message', async () => {
    const dev = await orglet();
    answers = { investor: 'Here is the investor update for Linh: revenue grew 12% this quarter.' };
    const taskId = await chat(dev, ['npm test fails in invoice-lib', 'It still fails after the fix', 'Please read the README first', 'Draft the investor update']);

    const later = await search('readme');
    expect(later.chats).toHaveLength(1);
    expect(later.chats[0]).toMatchObject({ taskId, messageId: turnMessageId(taskId, 2), sender: { kind: 'you' } });
    expect(text(later.chats[0].snippet)).toBe('Please read the README first');
    expect(marked(later.chats[0].snippet)).toEqual(['README']);

    const answered = await search('revenue');
    expect(answered.chats).toHaveLength(1);
    expect(answered.chats[0]).toMatchObject({ taskId, messageId: answerOf(taskId, 'revenue').id, sender: { kind: 'orglet', name: 'Dev' } });
    expect(marked(answered.chats[0].snippet)).toEqual(['revenue']);
  });

  it('indexes a side thread and a scheduled chat as chats of their own', async () => {
    const dev = await orglet();
    const mainTaskId = await chat(dev, ['Main chat about invoices']);
    const sideTaskId = await core.command('startSideThread', { taskId: mainTaskId, brief: 'A side question about pagination', ...scope }) as string;
    await settled(sideTaskId);
    expect((await search('pagination')).chats.map(hit => hit.taskId)).toEqual([sideTaskId]);

    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'demo' });
    const routine = await core.command('saveRoutine', { name: 'Morning review', enabled: true, schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 },
      task: { workerId: worker.id, sourceIds: [], brief: 'Scheduled overnight metrics review', consent: false, budgetMicros: 1000 } }) as Routine;
    const scheduledTaskId = await core.runRoutine({ id: routine.id, sourceIds: [] });
    await settled(scheduledTaskId);
    expect((await search('overnight metrics')).chats.map(hit => hit.taskId)).toEqual([scheduledTaskId]);
  });

  it('reads a forwarded answer as the chat shows it: plain text with the note, never the words written for the model', async () => {
    // Dogfood, 2026-09-26: a forwarded answer's result read "You: …the subtotal. - Negative or missing coupon values…".
    const dev = await orglet();
    answers = { coupons: 'Cases not covered in `src/cart.js`:\n\n- **Negative** coupon values\n- Discounts above the subtotal' };
    const origin = await chat(dev, ['Which coupons break the cart?']);
    const { id: _id, ...draft } = dev;
    const reviewer = await core.command('saveWorker', { ...draft, name: 'Reviewer' }) as Worker;
    const forwarded = await core.command('forwardMessage', { taskId: origin, messageId: answerOf(origin, 'coupon').id, note: 'Which one first?', targets: [{ kind: 'worker', id: reviewer.id }] }) as { sent: { taskId: string }[] };
    const target = forwarded.sent[0].taskId;
    await settled(target);

    const found = (await search('cases not covered')).chats.find(hit => hit.taskId === target)!;
    expect(found.messageId).toBe(turnMessageId(target, 0));
    expect(text(found.snippet)).toBe('Which one first? Cases not covered in src/cart.js: Negative coupon values Discounts above the subtotal');
    expect((await search('forwarded from the chat')).chats).toEqual([]);
  });

  it('shows a crew chat once, at its combined answer, and never a member report', async () => {
    const [lead] = store.all<Worker>('workers');
    const helper = await core.command('saveWorker', { name: 'Helper', instructions: 'Help.', skillId: lead.skillId, provider: 'demo' }) as Worker;
    const team = await core.command('saveTeam', { name: 'Weekly X', instructions: 'Work together.', memberIds: [helper.id], synthesizerId: lead.id, workflow: 'sequential', monthlyBudgetMicros: 1_000_000 }) as Team;
    const taskId = await core.command('createTask', { workerId: lead.id, teamId: team.id, brief: 'Weekly numbers for the board', sourceIds: [], consent: false, budgetMicros: 1_000_000 }) as string;
    await settled(taskId);
    const detail = store.detail(taskId);
    const shown = detail.artifacts.filter(artifact => detail.runs.find(run => run.id === artifact.runId)?.stage === 'synthesis');
    expect(shown).toHaveLength(1);
    expect(detail.artifacts.length).toBeGreaterThan(shown.length);
    const rows = store.db.prepare("SELECT message_id FROM chat_messages WHERE task_id=? AND kind='answer'").all(taskId).map(row => row.message_id);
    expect(rows).toEqual([shown[0].id]);

    // The crew's name finds the crew, which opens its chat; the chat itself is found by what was said in it.
    const byName = await search('weekly x');
    expect(byName.crewIds).toEqual([team.id]);
    const byMessage = await search('board');
    expect(byMessage.chats).toEqual([expect.objectContaining({ taskId, messageId: taskId, sender: { kind: 'you' } })]);
  });
});

describe('names and renames', () => {
  it('finds chats by title and orglets and crews by name, following renames', async () => {
    const dev = await orglet('Dev');
    const taskId = await chat(dev, ['npm test fails in invoice-lib']);
    await core.command('renameTask', { id: taskId, title: 'Fix invoice calculations' });

    const titled = await search('invoice calc');
    expect(titled.chats).toEqual([expect.objectContaining({ taskId })]);
    const byTitle = await search('calculations');
    expect(byTitle.chats).toEqual([{ taskId, at: expect.any(String), snippet: [] }]);

    await core.command('renameTask', { id: taskId, title: 'Billing fixes' });
    expect((await search('calculations')).chats).toEqual([]);
    expect((await search('billing')).chats.map(hit => hit.taskId)).toEqual([taskId]);

    expect((await search('dev')).orgletIds).toEqual([dev.id]);
    await core.command('saveWorker', { ...dev, name: 'Builder' });
    expect((await search('dev')).orgletIds).toEqual([]);
    expect((await search('build')).orgletIds).toEqual([dev.id]);
    // The last active orglet cannot be archived, so another one stays.
    await core.command('saveWorker', { name: 'Helper', instructions: 'Help.', provider: 'demo', skillId: dev.skillId });
    await core.command('archiveEntity', { kind: 'worker', id: dev.id, archived: true });
    expect((await search('builder')).orgletIds).toEqual([]);
  });
});

describe('deleting and archiving', () => {
  it('drops a deleted chat from search, and keeps an archived one', async () => {
    const dev = await orglet();
    const kept = await chat(dev, ['Quarterly roadmap for the kept chat']);
    await core.command('archiveTask', { id: kept, archived: true });
    const doomed = await core.command('createTask', { workerId: dev.id, brief: 'Quarterly roadmap for the doomed chat', ...scope }) as string;
    await settled(doomed);
    expect((await search('quarterly roadmap')).chats.map(hit => hit.taskId).sort()).toEqual([kept, doomed].sort());

    // This chat was charged, so deleting it keeps an empty record of its runs; search still forgets it.
    await core.command('deleteTask', { id: doomed });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM reservations WHERE task_id=?').get(doomed)!.count).toBeGreaterThan(0);
    expect((await search('quarterly roadmap')).chats.map(hit => hit.taskId)).toEqual([kept]);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE task_id=?').get(doomed)!.count).toBe(0);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM chat_search WHERE chat_search MATCH 'doomed'").get()!.count).toBe(0);
  });
});

describe('ranking', () => {
  it('puts the words typed together before the words apart, then the newest first', async () => {
    const dev = await orglet();
    const apart = await chat(dev, ['The report is late and the budget is fine']);
    const together = await chat(dev, ['Please check the budget report']);
    const newest = await chat(dev, ['A report on last month and its budget']);
    const newestTogether = await chat(dev, ['Another budget report, shorter this time']);

    const ranked = await search('budget report');
    expect(ranked.chats.map(hit => hit.taskId)).toEqual([newestTogether, together, newest, apart]);
  });

  it('shows the best message of a chat once, the newest holding the phrase', async () => {
    const dev = await orglet();
    const taskId = await chat(dev, ['The deploy checklist is in the wiki', 'Checklist done, deploy tomorrow', 'Where is the deploy checklist again?']);
    const found = await search('deploy checklist');
    expect(found.chats).toHaveLength(1);
    expect(found.chats[0].messageId).toBe(turnMessageId(taskId, 2));
  });
});

describe('upgrade', () => {
  it('indexes chats that existed before the index after the store opens, a step at a time', async () => {
    const dev = await orglet();
    answers = { status: 'Status: the migration finished overnight.' };
    const answeredTaskId = await chat(dev, ['Give me the status', 'And the README link?']);
    // More chats than one backfill step holds, written straight to the table as an older version would have.
    const older: string[] = [];
    for (let index = 0; index < 30; index++) {
      const task: Task = { id: id(), brief: `Archive note ${index} about harbour logistics`, workerId: dev.id, status: 'completed', createdAt: now(), budgetMicros: 1000, sourceIds: [], consent: false, accepted: false };
      store.put('tasks', task);
      older.push(task.id);
    }
    // Back to the schema before this version: no chat index, the old first-message table, version 17.
    store.db.exec(`DROP TRIGGER chat_messages_insert; DROP TRIGGER chat_messages_delete; DROP TRIGGER chat_messages_update;
      DROP TABLE chat_search; DROP TABLE chat_messages;
      CREATE VIRTUAL TABLE task_search USING fts5(id UNINDEXED, brief);
      DELETE FROM migrations WHERE version=18;`);
    await core.runner.shutdown();
    store.close();

    openStore();
    expect(Number(store.db.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version)).toBe(SCHEMA_VERSION);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name='task_search'").get()).toBeUndefined();
    const before = await search('harbour');
    expect(before).toMatchObject({ indexing: true, chats: [] });

    await core.chatSearch.backfill();
    const after = await search('harbour logistics');
    expect(after.indexing).toBe(false);
    expect(after.chats.map(hit => hit.taskId).sort()).toEqual([...older].sort());
    expect(store.setting(CHAT_SEARCH_BACKFILL, null)).toBeNull();
    const link = await search('readme');
    expect(link.chats[0]).toMatchObject({ taskId: answeredTaskId, messageId: turnMessageId(answeredTaskId, 1) });
    const overnight = await search('overnight');
    expect(overnight.chats[0]).toMatchObject({ taskId: answeredTaskId, messageId: answerOf(answeredTaskId, 'overnight').id });
  });

  it('starts a new workspace with nothing to backfill', async () => {
    expect(store.setting(CHAT_SEARCH_BACKFILL, null)).toBeNull();
    expect((await search('anything')).indexing).toBe(false);
  });
});

describe('snippets and matching', () => {
  it('ignores case and accents, đ included, and marks the words as written', () => {
    const terms = searchTerms('hop DONG');
    expect(terms).toEqual(['hop', 'dong']);
    expect(matchesEveryWord('Hợp đồng thuê nhà', terms)).toBe(true);
    expect(marked(markMatches('Xem lại hợp đồng của Linh', terms))).toEqual(['hợp', 'đồng']);
    // A decomposed accent stays with its letter.
    expect(marked(markMatches('Đánh giá', searchTerms('danh')))).toEqual(['Đánh']);
    expect(matchesEveryWord('Weekly X', searchTerms('week'))).toBe(true);
    expect(matchesEveryWord('Weekly X', searchTerms('eekly'))).toBe(false);
  });

  it('cuts a long message around the match, at spaces, with an ellipsis where text was left out', () => {
    const long = `${'Earlier context sentence. '.repeat(10)}The invoice total is wrong in March. ${'Later detail follows here. '.repeat(10)}`.trim();
    const snippet = snippetOf(long, searchTerms('invoice total'));
    const shown = text(snippet);
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown).toContain('The invoice total is wrong in March.');
    expect(shown.length).toBeLessThan(200);
    expect(marked(snippet)).toEqual(['invoice', 'total']);
    expect(text(snippetOf('Short and sweet', searchTerms('sweet')))).toBe('Short and sweet');
  });

  it('finds the phrase deep in a long answer, and reads a decomposed one whole', () => {
    const filler = 'Nothing to see in this line at all. ';
    const long = `${filler.repeat(40)}A budget line on its own. ${filler.repeat(40)}The budget report for Linh is ready. ${filler.repeat(40)}`;
    const snippet = snippetOf(long, searchTerms('budget report'));
    expect(text(snippet)).toContain('The budget report for Linh is ready.');
    expect(marked(snippet)).toEqual(['budget', 'report']);
    // Decomposed accents fold to fewer characters, so the text is read whole instead of around a guessed place.
    const decomposed = `${filler.repeat(40)}Hợp đồng đã ký. ${filler.repeat(20)}`;
    expect(marked(snippetOf(decomposed, searchTerms('hop dong')))).toEqual(['Hợp', 'đồng']);
  });

  it('drops markers that stack at the start of a line, such as a list inside a quote', () => {
    expect(plainSearchText('> - **Quoted** item\n> 1. `first`')).toBe('Quoted item first');
  });

  it('reads Markdown answers as plain text, code included, and treats search syntax as words', () => {
    expect(plainSearchText('## Plan\n\n- **Ship** the [docs](https://example.com) with `snake_case_name`\n```\ncode block\n```\n| a | b |')).toBe('Plan Ship the docs with snake_case_name code block a b');
    expect(searchTerms('NEAR( " OR * budget')).toEqual(['near', 'or', 'budget']);
  });

  it('searches with operators typed as text without failing', async () => {
    const dev = await orglet();
    await chat(dev, ['Near or far, the budget holds']);
    expect((await search('NEAR( " OR * budget')).chats).toHaveLength(1);
    expect(await search('   ')).toMatchObject({ chats: [], orgletIds: [], crewIds: [] });
  });
});
