import type { Artifact, Report, Run, Source, Task, Team, Worker } from '../../shared/contracts';
import { turnMessageId } from '../../shared/message-interactions';
import { withoutSourceIds } from '../../shared/source-mentions';
import {
  everyWordQuery, foldForSearch, matchesEveryWord, matchesPhrase, phraseQuery, plainSearchText, searchTerms, snippetOf,
  type ChatSearchHit, type ChatSearchResult,
} from '../../shared/chat-search';
import type { Store } from './database';

/**
 * The settings row saying how far the upgrade backfill has got through `tasks` (by rowid). It is written by the
 * migration that adds the index and removed once every chat that existed before it is indexed.
 */
export const CHAT_SEARCH_BACKFILL = 'chatSearchBackfill';
/** Chats indexed per step of the backfill before it yields to whatever else the core has to do. */
const BACKFILL_CHATS_PER_STEP = 25;
const MAX_CHAT_HITS = 50;
/** Newest matching messages read per query; older ones only matter for chats with nothing newer that matches. */
const PHRASE_ROWS = 300;
const WORD_ROWS = 600;

type MessageRow = { task_id: string; message_id: string; kind: string; author: string | null; at: string; text: string };
type IndexedMessage = { taskId: string; messageId: string; kind: 'message' | 'answer'; author: string | null; at: string; text: string };
type ChatMatch = { phrase?: MessageRow; words?: MessageRow; titleMatched?: true; titlePhrase?: true };

/** A person's message on one line, as it reads in the chat; it is plain text there, not Markdown. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * What an answer says, as the chat shows it: a chat answer's message, or a report's title, summary and findings (the
 * document it opens), with any source id the model copied in read as the file's name.
 */
function answerText(report: Report, sources: readonly Source[]): string {
  const pieces = report.format === 'chat'
    ? [report.summary]
    : [report.title, report.summary, ...report.findings.flatMap(finding => [finding.title, finding.detail, finding.recommendation ?? ''])];
  return plainSearchText(withoutSourceIds(pieces.filter(Boolean).join('\n'), sources));
}

/**
 * Every turn of a chat the way the thread lists them (`TaskThread`): the first message, then one per revision the
 * chat reached, each with the words sent then and when its first run started.
 */
function turnsOf(task: Task, runs: readonly Run[]) {
  const current = task.inputRevision ?? 0;
  const revisions = [...new Set([0, current, ...runs.map(run => run.snapshot.inputRevision ?? 0)])].sort((first, second) => first - second);
  return revisions.map(revision => {
    const runsOfTurn = runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
    const input = revision === current ? task.currentInput ?? task : runsOfTurn.find(run => run.snapshot.input)?.snapshot.input ?? task;
    return { revision, brief: input.brief, at: runsOfTurn[0]?.startedAt ?? task.createdAt };
  });
}

/**
 * The search index over every chat (COD-267). One row per message the person sent and per answer the chat shows,
 * written in the same transaction as the message or answer itself; chat titles and orglet and crew names are matched
 * when a search runs, so a rename needs no index work. A crew member's own report is not indexed, because the chat
 * shows the crew's combined answer instead. Quotes brought in from a side thread are not either: the side thread's
 * answer already is.
 */
export class ChatSearch {
  private backfilling?: Promise<void>;
  constructor(private readonly store: Store) {}

  /** What the person wrote on one turn, the first message included. Call inside the transaction that saves the turn. */
  indexTurn(taskId: string, revision: number, brief: string, at: string) {
    this.write({ taskId, messageId: turnMessageId(taskId, revision), kind: 'message', author: null, at, text: oneLine(brief) });
  }

  /** An answer or report as it lands. Call inside the transaction that saves the artifact. */
  indexAnswer(artifact: Artifact, run: Run, sources: readonly Source[] = this.sourcesOf(run.taskId)) {
    if (run.stage === 'member' || run.stage === 'plan') return;
    this.write({
      taskId: run.taskId, messageId: artifact.id, kind: 'answer', author: run.snapshot.worker.name,
      at: artifact.createdAt, text: answerText(artifact.report, sources),
    });
  }

  /** Takes a chat out of search, for a chat being deleted. */
  removeChat(taskId: string) {
    this.store.db.prepare('DELETE FROM chat_messages WHERE task_id=?').run(taskId);
  }

  /** Indexes every chat again from what is saved, for a restored backup. Call inside a transaction. */
  rebuild() {
    this.store.db.exec('DELETE FROM chat_messages');
    this.indexChats(this.store.db.prepare('SELECT data FROM tasks ORDER BY rowid').all());
    this.store.clearSetting(CHAT_SEARCH_BACKFILL);
  }

  /**
   * Indexes the chats that existed before the index did, a few at a time, yielding between steps so the app answers
   * while it runs. Where it got to is saved, so a restart carries on; indexing a chat twice gives the same rows.
   */
  backfill(): Promise<void> {
    this.backfilling ??= this.backfillSteps().finally(() => { this.backfilling = undefined; });
    return this.backfilling;
  }

  private async backfillSteps() {
    while (this.store.db.isOpen) {
      const progress = this.store.setting<{ afterRowid: number } | null>(CHAT_SEARCH_BACKFILL, null);
      if (!progress) return;
      const rows = this.store.db.prepare('SELECT rowid, data FROM tasks WHERE rowid>? ORDER BY rowid LIMIT ?')
        .all(progress.afterRowid, BACKFILL_CHATS_PER_STEP);
      this.store.transaction(() => {
        this.indexChats(rows);
        if (rows.length < BACKFILL_CHATS_PER_STEP) this.store.clearSetting(CHAT_SEARCH_BACKFILL);
        else this.store.setSetting(CHAT_SEARCH_BACKFILL, { afterRowid: Number(rows.at(-1)!.rowid) });
      });
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  /**
   * Orglets and crews whose name matches, then one result per chat. A chat's result is its best message: one holding
   * the words together and in order (the exact phrase) before one holding them apart, and the newest of those. Chats
   * are ranked the same way: phrase matches first, then the newest message first. A chat whose title matches counts
   * as a phrase match when the title holds the phrase; with no message matching, it shows no snippet and sorts by
   * when it started. Archived chats are found like any other; deleted ones are not in the index.
   */
  search(query: string): ChatSearchResult {
    const terms = searchTerms(query);
    const indexing = this.store.setting<unknown>(CHAT_SEARCH_BACKFILL, null) !== null;
    if (!terms.length) return { terms, orgletIds: [], crewIds: [], chats: [], indexing };
    const state = this.store.entityState();
    const workers = this.store.all<Worker>('workers').filter(worker => !state.workers[worker.id]?.deletedAt && !state.workers[worker.id]?.archivedAt);
    const teams = this.store.all<Team>('teams').filter(team => !state.teams[team.id]?.deletedAt && !state.teams[team.id]?.archivedAt);
    return { terms, orgletIds: namesMatching(workers, terms), crewIds: namesMatching(teams, terms), chats: this.chatHits(terms), indexing };
  }

  private chatHits(terms: readonly string[]): ChatSearchHit[] {
    const wordRows = this.matchingRows(everyWordQuery(terms), WORD_ROWS);
    // One word is its own phrase; asking the index twice would only return the same rows.
    const phraseRows = terms.length > 1 ? this.matchingRows(phraseQuery(terms), PHRASE_ROWS) : wordRows;
    const matches = new Map<string, ChatMatch>();
    const matchOf = (taskId: string) => {
      const known = matches.get(taskId);
      if (known) return known;
      const created: ChatMatch = {};
      matches.set(taskId, created);
      return created;
    };
    // Rows arrive newest first, so the first one kept for a chat is its newest.
    for (const row of phraseRows) matchOf(row.task_id).phrase ??= row;
    for (const row of wordRows) matchOf(row.task_id).words ??= row;
    const titles = this.store.setting<Record<string, string>>('taskTitles', {});
    for (const [taskId, title] of Object.entries(titles)) {
      if (!matchesEveryWord(title, terms)) continue;
      const match = matchOf(taskId);
      match.titleMatched = true;
      if (terms.length === 1 || matchesPhrase(title, terms)) match.titlePhrase = true;
    }
    const tasks = this.liveTasks([...matches.keys()]);
    const ranked = [...matches].flatMap(([taskId, match]) => {
      const task = tasks.get(taskId);
      if (!task) return [];
      const row = match.phrase ?? match.words;
      return [{ taskId, row, phrase: Boolean(match.phrase || match.titlePhrase), at: row?.at ?? task.createdAt }];
    });
    ranked.sort((first, second) => Number(second.phrase) - Number(first.phrase) || second.at.localeCompare(first.at));
    return ranked.slice(0, MAX_CHAT_HITS).map(({ taskId, row, at }): ChatSearchHit => row
      ? {
        taskId, messageId: row.message_id, at, snippet: snippetOf(row.text, terms),
        sender: row.kind === 'answer' ? { kind: 'orglet', name: row.author ?? '' } : { kind: 'you' },
      }
      : { taskId, at, snippet: [] });
  }

  private matchingRows(match: string, limit: number): MessageRow[] {
    return this.store.db.prepare(`SELECT m.task_id, m.message_id, m.kind, m.author, m.at, m.text
      FROM chat_search JOIN chat_messages m ON m.id=chat_search.rowid
      WHERE chat_search MATCH ? ORDER BY m.at DESC LIMIT ?`).all(match, limit) as MessageRow[];
  }

  /** The chats among these ids that still exist and are not deleted, by id. */
  private liveTasks(taskIds: readonly string[]): Map<string, Task> {
    const rows = this.store.db.prepare('SELECT data FROM tasks WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(taskIds));
    const tasks = rows.map(row => JSON.parse(String(row.data)) as Task).filter(task => !task.deletedAt);
    return new Map(tasks.map(task => [task.id, task]));
  }

  private indexChats(rows: readonly Record<string, unknown>[]) {
    for (const row of rows) {
      try {
        this.indexChat(JSON.parse(String(row.data)) as Task);
      } catch {
        // A chat that cannot be read stays out of search rather than stopping every chat after it.
      }
    }
  }

  /** One chat's rows rebuilt from what is saved: every turn, then every answer the chat shows. */
  private indexChat(task: Task) {
    this.removeChat(task.id);
    if (task.deletedAt) return;
    const runs = this.store.db.prepare('SELECT data FROM runs WHERE task_id=? ORDER BY rowid').all(task.id)
      .map(row => JSON.parse(String(row.data)) as Run);
    for (const turn of turnsOf(task, runs)) this.indexTurn(task.id, turn.revision, turn.brief, turn.at);
    const runsById = new Map(runs.map(run => [run.id, run]));
    const sources = this.sourcesOf(task.id);
    const artifacts = this.store.db.prepare('SELECT a.data FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE r.task_id=? ORDER BY a.rowid').all(task.id)
      .map(row => JSON.parse(String(row.data)) as Artifact);
    for (const artifact of artifacts) {
      const run = runsById.get(artifact.runId);
      if (run) this.indexAnswer(artifact, run, sources);
    }
  }

  /** The chat's files, so an answer that names one by its id is indexed with the file's name, as the chat shows it. */
  private sourcesOf(taskId: string): Source[] {
    const row = this.store.db.prepare('SELECT data FROM tasks WHERE id=?').get(taskId);
    if (!row) return [];
    const sourceIds = (JSON.parse(String(row.data)) as Task).sourceIds;
    return this.store.db.prepare('SELECT data FROM sources WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(sourceIds))
      .map(source => JSON.parse(String(source.data)) as Source);
  }

  private write(message: IndexedMessage) {
    this.store.db.prepare(`INSERT INTO chat_messages (message_id,task_id,kind,author,at,text,body) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET task_id=excluded.task_id, kind=excluded.kind, author=excluded.author,
      at=excluded.at, text=excluded.text, body=excluded.body`)
      .run(message.messageId, message.taskId, message.kind, message.author, message.at, message.text, foldForSearch(message.text));
  }
}

/** Ids of the orglets or crews whose name matches, names holding the phrase first, otherwise in their saved order. */
function namesMatching(entities: readonly (Worker | Team)[], terms: readonly string[]): string[] {
  const matching = entities.filter(entity => matchesEveryWord(entity.name, terms));
  const phrase = matching.filter(entity => matchesPhrase(entity.name, terms));
  const apart = matching.filter(entity => !matchesPhrase(entity.name, terms));
  return [...phrase, ...apart].map(entity => entity.id);
}
