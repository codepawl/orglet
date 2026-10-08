import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { foldForSearch } from '../../apps/desktop/src/shared/chat-search';
import type { Artifact, Routine, Run, Skill, Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/**
 * A synthetic Orglet profile for scale tests. Every name, message, note and id is made by a seeded generator, so one
 * configuration always writes the same profile and no real data is involved. Rows go through the app's own storage
 * layer (`Store`, `CoreService` commands, `Sources`); the per-turn rows (runs, answers, events, search rows, usage)
 * are inserted with the same SQL the core uses, because the real write path re-reads a chat's saved turns on every
 * write and would make seeding a 2,000-turn chat quadratic.
 */
export type StressConfig = {
  name: string;
  seed: number;
  orglets: number;
  chats: number;
  /** Turns (a message and its answer) in every ordinary chat. */
  turnsPerChat: number;
  longChats: number;
  longChatTurns: number;
  channels: number;
  channelMembers: number;
  /** Turns in each channel; every member answers every turn. */
  channelTurns: number;
  sources: number;
  /** How many of the sources are big CSV files, and how large each is. */
  bigSources: number;
  bigSourceMegabytes: number;
  schedules: number;
  notes: number;
};

export const STRESS_TIERS: Record<string, StressConfig> = {
  x1: { name: 'x1', seed: 1, orglets: 20, chats: 50, turnsPerChat: 30, longChats: 0, longChatTurns: 0, channels: 2, channelMembers: 4, channelTurns: 20, sources: 20, bigSources: 0, bigSourceMegabytes: 0, schedules: 5, notes: 100 },
  x10: { name: 'x10', seed: 10, orglets: 200, chats: 1000, turnsPerChat: 30, longChats: 20, longChatTurns: 2000, channels: 20, channelMembers: 8, channelTurns: 50, sources: 300, bigSources: 6, bigSourceMegabytes: 12, schedules: 50, notes: 2000 },
  // 200 schedules were asked for; the app allows 100, so x100 holds the most it can.
  x100: { name: 'x100', seed: 100, orglets: 500, chats: 5000, turnsPerChat: 32, longChats: 20, longChatTurns: 2000, channels: 50, channelMembers: 8, channelTurns: 50, sources: 1000, bigSources: 20, bigSourceMegabytes: 12, schedules: 100, notes: 10000 },
  // For tests: seconds, not minutes.
  tiny: { name: 'tiny', seed: 7, orglets: 3, chats: 4, turnsPerChat: 3, longChats: 1, longChatTurns: 12, channels: 1, channelMembers: 2, channelTurns: 3, sources: 3, bigSources: 1, bigSourceMegabytes: 1, schedules: 2, notes: 10 },
};

export type SeedSummary = {
  config: StressConfig;
  databasePath: string;
  workerIds: string[];
  /** The ids of the longest chats, newest first in the sidebar order, and the first one is the heavy chat to open. */
  longChatIds: string[];
  chatIds: string[];
  channelTaskIds: string[];
  sourceIds: string[];
  bigSourceIds: string[];
  turns: number;
  seconds: number;
};

/** mulberry32: small, fast and the same on every machine. */
export function randomSource(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (below: number) => Math.floor(next() * below),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    uuid: () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[Math.floor(next() * 4)]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    },
  };
}
type RandomSource = ReturnType<typeof randomSource>;

const VOCABULARY = ('report budget schedule customer invoice summary research notes meeting draft review launch metric forecast pipeline ' +
  'quarter roadmap feedback survey vendor contract deadline backlog incident release migration dashboard archive policy ' +
  'segment campaign pricing revenue churn onboarding support ticket latency memory profile sample dataset column finding ' +
  'estimate priority owner handoff checklist outline proposal template workflow reminder calendar budget expense travel ' +
  'document source evidence claim quote citation figure table chart trend baseline target risk mitigation decision').split(' ');

/** A sentence of `words` words, with a capital and a full stop. */
function sentence(random: RandomSource, words: number): string {
  const parts = Array.from({ length: words }, () => random.pick(VOCABULARY));
  return `${parts[0][0].toUpperCase()}${parts[0].slice(1)} ${parts.slice(1).join(' ')}.`;
}

function paragraph(random: RandomSource, sentences: number): string {
  return Array.from({ length: sentences }, () => sentence(random, 6 + random.int(10))).join(' ');
}

/** A user message of a few words up to a short paragraph. */
const userMessage = (random: RandomSource) => paragraph(random, 1 + random.int(3));

/** An answer with a heading, a paragraph and a list, the way a chat answer reads. */
function answerMessage(random: RandomSource): string {
  const items = Array.from({ length: 2 + random.int(4) }, () => `- ${sentence(random, 5 + random.int(6))}`).join('\n');
  return `## ${sentence(random, 3).replace('.', '')}\n\n${paragraph(random, 2 + random.int(4))}\n\n${items}`;
}

/** The most schedules one workspace may hold (core/orchestration/routines.ts). */
const MAX_SCHEDULES = 100;
const BASE_TIME = Date.parse('2026-01-01T08:00:00.000Z');
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

type Insertions = ReturnType<typeof prepareInsertions>;

function prepareInsertions(store: Store) {
  const db = store.db;
  return {
    run: db.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)'),
    artifact: db.prepare('INSERT INTO artifacts(id,run_id,data) VALUES(?,?,?)'),
    event: db.prepare('INSERT INTO events(id,run_id,data) VALUES(?,?,?)'),
    reservation: db.prepare("INSERT INTO reservations(id,run_id,task_id,provider,month,amount,state) VALUES(?,?,?,?,?,?,'settled')"),
    ledger: db.prepare("INSERT INTO ledger(id,reservation_id,amount,input_tokens,output_tokens,pricing_version) VALUES(?,?,?,?,?,'stress')"),
    message: db.prepare('INSERT INTO chat_messages(message_id,task_id,kind,author,at,text,body) VALUES(?,?,?,?,?,?,?)'),
  };
}

type TurnWriter = { turns: number };

/**
 * One turn: the person's saved message, the runs that answered it (one per answering orglet), each run's two events,
 * answer, search rows and usage. `answerers` is one orglet for a chat and every member for a channel.
 */
function writeTurn(store: Store, insert: Insertions, random: RandomSource, task: Task, revision: number, turnId: string,
  at: number, answerers: Worker[], skill: Skill, result: TurnWriter) {
  // A run made on this computer names this computer; one that names another is a copy from elsewhere and is not replicated.
  const deviceId = store.sync.revisions.clock.read().deviceId;
  const brief = userMessage(random);
  store.sync.turns.save({ id: turnId, taskId: task.id, createdAt: iso(at), input: { brief, sourceIds: [] } }, revision);
  insert.message.run(turnId, task.id, 'message', null, iso(at), brief, foldForSearch(brief));
  answerers.forEach((worker, position) => {
    const runId = random.uuid();
    const startedAt = at + 1000 + position * 500;
    const run: Run = { id: runId, taskId: task.id, status: 'completed', startedAt: iso(startedAt), error: null, originDeviceId: deviceId,
      snapshot: { turnId, worker, skill, input: { brief, sourceIds: [] }, inputRevision: revision } };
    insert.run.run(run.id, task.id, JSON.stringify(run));
    const messages = ['Lượt chạy bắt đầu.', 'Lượt chạy hoàn tất.'];
    messages.forEach((message, order) => {
      const eventId = random.uuid();
      insert.event.run(eventId, runId, JSON.stringify({ id: eventId, runId, sequence: order + 1, message, createdAt: iso(startedAt + order * 400) }));
    });
    const summary = answerMessage(random);
    const report: Artifact['report'] = { format: 'chat', title: 'Chat', summary, findings: [], limitations: [] };
    const artifact: Artifact = { id: random.uuid(), runId, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: iso(startedAt + 400), replyTo: turnId, report };
    insert.artifact.run(artifact.id, runId, JSON.stringify(artifact));
    insert.message.run(artifact.id, task.id, 'answer', worker.name, artifact.createdAt, summary.replace(/[#*\-]/g, ' ').replace(/\s+/g, ' ').trim(), foldForSearch(summary));
    const reservationId = random.uuid();
    insert.reservation.run(reservationId, runId, task.id, 'openai', '2026-10', 1200 + random.int(800));
    insert.ledger.run(random.uuid(), reservationId, 1200 + random.int(800), 400 + random.int(900), 150 + random.int(500));
  });
  result.turns += 1;
}

/** Writes one chat (or channel row) with `turns` turns; the task row goes in last, once, so the saved turns are read twice, not per turn. */
function writeChat(store: Store, insert: Insertions, random: RandomSource, options: {
  index: number; turns: number; answerers: Worker[]; skill: Skill; sourceIds: string[]; channel?: NonNullable<Task['channel']>;
  assignees?: string[]; taskId?: string; archivedAt?: string;
}, result: TurnWriter): Task {
  const taskId = options.taskId ?? random.uuid();
  const start = BASE_TIME + options.index * 37 * 60_000;
  const firstBrief = userMessage(random);
  let currentTurnId = taskId;
  let lastArtifactId: string | undefined;
  store.transaction(() => {
    const task: Task = { id: taskId, brief: firstBrief, workerId: options.answerers[0].id, status: 'completed', createdAt: iso(start), budgetMicros: 500_000,
      sourceIds: options.sourceIds, consent: true, providerScopes: [], accepted: false, ...(options.archivedAt ? { archivedAt: options.archivedAt } : {}), ...(options.assignees ? { assignees: options.assignees } : {}),
      ...(options.channel ? { channel: options.channel } : {}) };
    // The runs refer to the task row, so a bare one goes in first; the final write below replaces it.
    store.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(taskId, JSON.stringify(task));
    // Turn zero belongs to the task's own id, the way the core names a chat's first message.
    for (let revision = 0; revision < options.turns; revision += 1) {
      const turnId = revision === 0 ? taskId : random.uuid();
      writeTurn(store, insert, random, task, revision, turnId, start + revision * 3 * 60_000, options.answerers, options.skill, result);
      currentTurnId = turnId;
    }
    const last = store.db.prepare('SELECT a.id FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE r.task_id=? ORDER BY a.rowid DESC LIMIT 1').get(taskId);
    lastArtifactId = last ? String(last.id) : undefined;
    const lastBrief = String(store.db.prepare('SELECT text FROM chat_messages WHERE task_id=? AND kind=? ORDER BY id DESC LIMIT 1').get(taskId, 'message')!.text);
    // `update` fills `turnIds` and `currentTurnId` from the saved turns, exactly as a real write of a long chat does.
    store.update('tasks', { ...task, inputRevision: options.turns - 1, currentTurnId, currentTurnCreatedAt: iso(start + (options.turns - 1) * 3 * 60_000),
      currentInput: { brief: lastBrief, sourceIds: [] }, ...(lastArtifactId ? { lastArtifactId } : {}) });
  });
  return store.get<Task>('tasks', taskId);
}

/** A readable CSV of about `megabytes`, made of repeated deterministic rows. */
function writeBigCsv(path: string, megabytes: number, random: RandomSource) {
  const header = 'id,customer,segment,amount,note\n';
  const rows: string[] = [];
  let size = header.length;
  let index = 0;
  while (size < megabytes * 1024 * 1024) {
    const row = `${index},${random.pick(VOCABULARY)}-${random.int(5000)},${random.pick(['a', 'b', 'c', 'd'])},${(random.int(1_000_000) / 100).toFixed(2)},${sentence(random, 6)}\n`;
    rows.push(row);
    size += row.length;
    index += 1;
  }
  writeFileSync(path, header + rows.join(''));
}

export async function seedProfile(config: StressConfig, dataDirectory: string, sourceDirectory = join(dataDirectory, '..', `${config.name}-source-files`),
  progress: (message: string) => void = () => undefined): Promise<SeedSummary> {
  const started = Date.now();
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  const random = randomSource(config.seed);
  const databasePath = join(dataDirectory, 'orglet.sqlite');
  const store = new Store(databasePath);
  const core = new CoreService(store, () => undefined, async () => { throw new Error('The stress profile never calls a model.'); });
  const skill = store.all<Skill>('skills')[0];

  // Orglets, as versions, so each has a revision row like a saved one.
  const workers: Worker[] = [];
  store.transaction(() => {
    for (let index = 0; index < config.orglets; index += 1) {
      const worker: Worker = { id: random.uuid(), name: `Orglet ${index + 1}`, revision: 1, provider: 'demo', skillId: skill.id, description: sentence(random, 5).slice(0, 150),
        instructions: `${paragraph(random, 2)} Keep replies clear and to the point.` };
      store.version('workers', worker);
      workers.push(worker);
    }
  });
  progress(`${workers.length} orglets`);

  // Sources: small text files and, for the first few, big CSV files. They are imported the way a person adds files.
  const sourcePaths: string[] = [];
  for (let index = 0; index < config.sources; index += 1) {
    const big = index < config.bigSources;
    const path = join(sourceDirectory, big ? `big-${index}.csv` : `note-${index}.txt`);
    if (big) writeBigCsv(path, config.bigSourceMegabytes, random);
    else writeFileSync(path, `${paragraph(random, 4 + random.int(30))}\n`);
    sourcePaths.push(path);
  }
  const sources: Source[] = [];
  for (let index = 0; index < sourcePaths.length; index += 20) sources.push(...await core.sources.import(sourcePaths.slice(index, index + 20)));
  const bigSourceIds = sources.slice(0, config.bigSources).map(source => source.id);
  progress(`${sources.length} sources`);

  // Chats: the long ones first, then the ordinary ones. Every fifth chat carries a file.
  const insert = prepareInsertions(store);
  const result: TurnWriter = { turns: 0 };
  const chatIds: string[] = [];
  const longChatIds: string[] = [];
  const titles: Record<string, string> = {};
  const smallSources = sources.slice(config.bigSources);
  // An orglet has one live main chat (its newest); its older chats are archived, which is where a long history ends up.
  // A long chat is the live chat of the orglet it belongs to, so opening that orglet opens the heavy thread.
  const workersWithLongChat = new Set(Array.from({ length: config.longChats }, (_, index) => index % workers.length));
  const lastChatOfWorker = new Map<number, number>();
  for (let index = config.longChats; index < config.chats; index += 1) lastChatOfWorker.set(index % workers.length, index);
  const archivedAt = new Date().toISOString();
  store.setSetting('archiveRetentionDays', 0);
  for (let index = 0; index < config.chats; index += 1) {
    const long = index < config.longChats;
    const worker = workers[index % workers.length];
    const live = long || (!workersWithLongChat.has(index % workers.length) && lastChatOfWorker.get(index % workers.length) === index);
    const carried = !long && index % 5 === 0 && smallSources.length ? [smallSources[index % smallSources.length].id] : [];
    const task = writeChat(store, insert, random, { index, turns: long ? config.longChatTurns : config.turnsPerChat, answerers: [worker], skill, sourceIds: carried, ...(live ? {} : { archivedAt }) }, result);
    chatIds.push(task.id);
    if (long) longChatIds.push(task.id);
    titles[task.id] = `${sentence(random, 3).replace('.', '')} ${index + 1}`;
    if ((index + 1) % 250 === 0) progress(`${index + 1} chats, ${result.turns} turns`);
  }
  store.setSetting('taskTitles', titles);

  // Channels: members take turns, so each turn has one answer per member.
  const channelTaskIds: string[] = [];
  for (let index = 0; index < config.channels; index += 1) {
    const members = Array.from({ length: Math.min(config.channelMembers, workers.length) }, (_, position) => workers[(index * 3 + position) % workers.length]);
    const channelId = core.channels.create({ name: `channel-${index + 1}`, topic: sentence(random, 4), members: members.map(member => ({ kind: 'orglet' as const, id: member.id })) } as never);
    const waiting = core.channels.waiting(channelId);
    const answerers = waiting.orgletIds.map(workerId => workers.find(worker => worker.id === workerId)!);
    const task = writeChat(store, insert, random, { index: config.chats + index, turns: config.channelTurns, answerers, skill, sourceIds: [],
      channel: waiting.channel, assignees: waiting.orgletIds }, result);
    core.channels.takeWaiting(channelId);
    channelTaskIds.push(task.id);
  }
  progress(`${chatIds.length} chats, ${channelTaskIds.length} channels, ${result.turns} turns`);

  // Schedules, through the command a person's Save uses. The app refuses a hundred and first, so that is the most a profile can hold.
  const schedules = Math.min(config.schedules, MAX_SCHEDULES);
  for (let index = 0; index < schedules; index += 1) {
    const frequency = (['daily', 'weekdays', 'weekly', 'hours'] as const)[index % 4];
    await core.command('saveRoutine', {
      name: `Schedule ${index + 1}`, enabled: true,
      schedule: { timeZone: 'UTC', time: `${String(index % 24).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`, frequency, weekday: index % 7, ...(frequency === 'hours' ? { everyHours: 6 } : {}) },
      task: { workerId: workers[index % workers.length].id, sourceIds: [], brief: `Run schedule ${index + 1}: ${sentence(random, 6)}`, consent: true, providerScopes: [], budgetMicros: 100_000 },
    }) as Routine;
  }
  progress(`${schedules} schedules${schedules < config.schedules ? ` (the app allows ${MAX_SCHEDULES})` : ''}`);

  // Notes and memories: a quarter are memories; four in ten belong to one orglet and the rest to the workspace.
  for (let index = 0; index < config.notes; index += 1) {
    const memory = index % 4 === 0;
    await core.command('saveKnowledge', {
      title: `${sentence(random, 3).replace('.', '')} ${index + 1}`, content: paragraph(random, 2 + random.int(3)), tags: [random.pick(VOCABULARY), random.pick(VOCABULARY)],
      pinned: index % 50 === 0, scope: index % 10 < 4 ? { type: 'worker', id: workers[index % workers.length].id } : { type: 'workspace' }, ...(memory ? { kind: 'memory' } : {}),
    });
    if ((index + 1) % 2000 === 0) progress(`${index + 1} notes`);
  }

  // The rows above went in with the SQL the core uses but not through its capture, so the replica that a real
  // profile holds (one sync record for each turn, run, event and answer, written as they were) is made here, once, the
  // way a restore makes it. Without it a measurement would time the first start of an old profile, not a normal one.
  progress('capturing the sync replica');
  store.sync.refreshFromCanonical();
  store.close();
  return { config, databasePath, workerIds: workers.map(worker => worker.id), longChatIds, chatIds, channelTaskIds, sourceIds: sources.map(source => source.id), bigSourceIds,
    turns: result.turns, seconds: (Date.now() - started) / 1000 };
}
