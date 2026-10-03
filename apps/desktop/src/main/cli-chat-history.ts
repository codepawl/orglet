import { chatTurnRevisions, chatTurnInput, chatTurnMessageId, chatTurnCreatedAt } from '../shared/chat-turns';
import type { Artifact, Run, RunInput, Task, TaskDetail, TaskStatus } from '../shared/contracts';
import type { DecisionRequest } from '../shared/work-decisions';
import { type Reaction } from '../shared/message-interactions';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliAnswer, CliQuestion, CliTurn } from '../cli/protocol';
import { CliFailure } from './cli-chats';

/**
 * Reading a chat's saved turns for the terminal (COD-234, COD-354): the answers of one message, the numbered history
 * `read --turns` prints, and the message a reply, reaction or forward points at. Pure functions over `TaskDetail`.
 */

/** Statuses of a turn that is still going; anything else means the turn has stopped. */
const RUNNING_STATUSES: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
/** How much of a message the line saying what a reply answers keeps. */
const REPLY_LABEL_CHARACTERS = 80;

export function isTurnRunning(task: Pick<Task, 'status' | 'pendingStart'>): boolean {
  return RUNNING_STATUSES.includes(task.status) || Boolean(task.pendingStart);
}

/** The text of one saved answer: a chat reply as written, a report as its title over its summary. */
export function answerText(report: TaskDetail['artifacts'][number]['report']): string {
  if (report.format === 'chat') return report.summary;
  return `${report.title}\n\n${report.summary}`;
}

type TurnArtifact = { artifact: Artifact; run: Run };

/** Every saved answer of runs started for one message, oldest first, with the run that wrote it. */
export function turnArtifacts(detail: Pick<TaskDetail, 'runs' | 'artifacts'>, revision: number): TurnArtifact[] {
  const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
  const found = detail.artifacts.flatMap(artifact => {
    const run = runs.find(candidate => candidate.id === artifact.runId);
    return run ? [{ artifact, run }] : [];
  });
  return found.sort((first, second) => first.artifact.createdAt.localeCompare(second.artifact.createdAt));
}

function answerOf(item: TurnArtifact): CliAnswer {
  const author = item.run.snapshot.worker;
  return { name: author.name, stage: item.run.stage, text: answerText(item.artifact.report), createdAt: item.artifact.createdAt, color: defaultAvatarColor(author) };
}

/**
 * The answers one message produced: every saved answer of a run started for that message, oldest first, named after
 * the orglet that wrote it. A crew turn gives each member's result and then the lead's combined answer.
 */
export function turnAnswers(detail: Pick<TaskDetail, 'runs' | 'artifacts'>, revision: number): CliAnswer[] {
  return turnArtifacts(detail, revision).map(answerOf);
}

/** Why runs of this message stopped short, for a turn that failed. */
export function turnErrors(detail: Pick<TaskDetail, 'runs'>, revision: number): string[] {
  const failed = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision && run.error);
  return [...new Set(failed.map(run => run.error as string))];
}

/** The newest message in the chat that has at least one answer, or the current one when none has. */
export function latestAnsweredRevision(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>): number {
  const answered = detail.artifacts.flatMap(artifact => {
    const run = detail.runs.find(candidate => candidate.id === artifact.runId);
    return run ? [run.snapshot.inputRevision ?? 0] : [];
  });
  if (answered.length === 0) return detail.task.inputRevision ?? 0;
  const withAnswers = new Set(answered);
  return turnRevisions(detail).findLast(revision => withAnswers.has(revision)) ?? detail.task.inputRevision ?? 0;
}

/** Every message of a chat by revision, oldest first: the first, the current one and every one a run was started for. */
export function turnRevisions(detail: Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>): number[] {
  return chatTurnRevisions(detail);
}

/** A displayed one-based message number maps to an immutable local alias only at the IPC boundary. */
export function turnRevisionAt(detail: Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>, number: number): number | undefined {
  if (!Number.isInteger(number) || number < 1) return undefined;
  return turnRevisions(detail)[number - 1];
}

type TurnInput = Pick<RunInput, 'brief' | 'replyTo' | 'forwarded'>;

/** Exact saved input for an edit; missing historical snapshots cannot reconstruct original attachments. */
export function savedTurnInput(detail: Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>, revision: number): RunInput | undefined {
  const durable = detail.savedTurns?.find(turn => turn.localRevision === revision);
  if (durable) {
    // Local-only execution flags belong to the exact current authored turn, never to an imported alias collision.
    const localInput = revision === (detail.task.inputRevision ?? 0) && detail.task.currentTurnId === durable.id
      ? detail.task.currentInput : undefined;
    return { ...localInput, ...durable.input };
  }
  if (revision === (detail.task.inputRevision ?? 0)) {
    if (detail.task.currentInput) return detail.task.currentInput;
  }
  const frozen = detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)?.snapshot.input;
  if (frozen) return frozen;
  if (revision === 0 && (detail.task.inputRevision ?? 0) === 0) return detail.task;
  return chatTurnInput(detail, revision);
}

/** What the person sent for one revision, the way the desktop thread reads it. */
function turnInput(detail: Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>, revision: number): TurnInput {
  return chatTurnInput(detail, revision) ?? { brief: '' };
}

function personReaction(task: Pick<Task, 'messageReactions'>, messageId: string): Reaction | undefined {
  return task.messageReactions?.findLast(item => item.messageId === messageId && item.actor === 'user')?.emoji;
}

function shortened(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(flat);
  if (characters.length <= REPLY_LABEL_CHARACTERS) return flat;
  return `${characters.slice(0, REPLY_LABEL_CHARACTERS).join('')}…`;
}

/** The message a reply points at, shortened: the person's own message or an orglet's answer. */
function replyLabel(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>, messageId: string): string {
  for (const [position, revision] of turnRevisions(detail).entries()) {
    if (chatTurnMessageId(detail, revision) === messageId) return `#${position + 1} ${shortened(turnInput(detail, revision).brief)}`;
  }
  const artifact = detail.artifacts.find(item => item.id === messageId);
  if (!artifact) return '…';
  const author = detail.runs.find(run => run.id === artifact.runId)?.snapshot.worker.name ?? 'Orglet';
  return `${author}: ${shortened(artifact.report.summary)}`;
}

/** One numbered turn: what the person sent, with its reply and forward lines, and every answer with its number. */
function chatTurn(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>, revision: number, number: number): CliTurn {
  const input = turnInput(detail, revision);
  const answers = turnArtifacts(detail, revision).map((item, index) => {
    const reaction = personReaction(detail.task, item.artifact.id);
    return { ...answerOf(item), ref: `${number}.${index + 1}`, ...(reaction ? { reaction } : {}) };
  });
  const reaction = personReaction(detail.task, chatTurnMessageId(detail, revision));
  return {
    number,
    text: input.forwarded ? input.forwarded.note ?? input.forwarded.text : input.brief,
    sentAt: chatTurnCreatedAt(detail, revision),
    ...(input.replyTo ? { replyTo: replyLabel(detail, input.replyTo) } : {}),
    ...(input.forwarded ? { forwardedFrom: input.forwarded.from } : {}),
    ...(reaction ? { reaction } : {}),
    answers,
  };
}

/**
 * The newest `count` turns before turn number `before` (all of them without it), oldest first, and how many turns
 * come before the first one returned, so the terminal knows whether there is more to load.
 */
export function chatTurns(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>, count: number, before?: number): { turns: CliTurn[]; earlier: number } {
  const ordered = turnRevisions(detail).map((revision, position) => ({ revision, number: position + 1 }));
  const earlierThanCursor = ordered.filter(turn => before === undefined || turn.number < before);
  const shown = earlierThanCursor.slice(-count);
  return { turns: shown.map(turn => chatTurn(detail, turn.revision, turn.number)), earlier: earlierThanCursor.length - shown.length };
}

/** A message a reply, a reaction or a forward points at, by the id the core knows it by. */
export type ResolvedMessage = { messageId: string; ref: string };

/**
 * Turns a message number from `read --turns` into the message id: `3` is the person's third message, `3.2` the second
 * answer to it, `last` (or nothing) the newest answer in the chat.
 */
export function resolveMessage(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>, ref: string | undefined): ResolvedMessage {
  const wanted = (ref ?? 'last').trim().replace(/^#/, '').toLowerCase();
  if (wanted === 'last') return newestAnswer(detail);
  const [turnPart, answerPart] = wanted.split('.');
  const revision = turnRevisionAt(detail, Number(turnPart));
  if (revision === undefined) throw new CliFailure('not_found', `Không có tin nhắn #${turnPart} trong chat này.`);
  if (answerPart === undefined) return { messageId: chatTurnMessageId(detail, revision), ref: turnPart };
  const answer = turnArtifacts(detail, revision)[Number(answerPart) - 1];
  if (!answer) throw new CliFailure('not_found', `Không có câu trả lời #${wanted} trong chat này.`);
  return { messageId: answer.artifact.id, ref: wanted };
}

function newestAnswer(detail: Pick<TaskDetail, 'task' | 'runs' | 'artifacts' | 'savedTurns'>): ResolvedMessage {
  const revisions = turnRevisions(detail);
  for (const [position, revision] of [...revisions.entries()].reverse()) {
    const answers = turnArtifacts(detail, revision);
    if (answers.length === 0) continue;
    return { messageId: answers.at(-1)!.artifact.id, ref: `${position + 1}.${answers.length}` };
  }
  throw new CliFailure('not_found', 'Chat này chưa có câu trả lời nào.');
}

/** The question the latest turn waits on, if any: asked, not answered and not cut off. */
export function pendingDecision(task: Pick<Task, 'inputRevision' | 'decisionRequests'>): DecisionRequest | undefined {
  const current = task.inputRevision ?? 0;
  return task.decisionRequests?.findLast(request => request.inputRevision === current && !request.answer && !request.interruptedAt);
}

/** An orglet's own question the terminal can answer; an MCP approval only the desktop answers, so it is left out. */
export function pendingQuestion(task: Pick<Task, 'status' | 'inputRevision' | 'decisionRequests'>): CliQuestion | undefined {
  if (task.status !== 'waiting_input') return undefined;
  const decision = pendingDecision(task);
  if (!decision || decision.approval) return undefined;
  return { question: decision.question, options: decision.options };
}

/** Whether the chat waits on a card only the desktop may answer: an MCP, browser or desktop approval. */
export function waitsForDesktop(detail: Pick<TaskDetail, 'task' | 'browser' | 'desktop'>): boolean {
  if (detail.browser?.approval || detail.desktop?.approval) return true;
  if (detail.task.status !== 'waiting_input') return false;
  return Boolean(pendingDecision(detail.task)?.approval);
}
