import type { DecisionAnswer, DecisionQuestions, DecisionState } from '../../shared/decisions';
import { decideWithin, type Decider } from './budget';

/**
 * Which approved notes fit a message whose words do not match them (COD-306). Tacet is asked the way it routes a
 * ticket to a team: the message is the text, and each note is an option named by its title, described by its tags,
 * beside "other". The same options go in twice, in opposite orders, within one request, and each note's two
 * probabilities are averaged: on the measured cases where a note sat in the list moved its probability a lot, and
 * the two orders together steadied it. The numbers below were measured on `scripts/tacet/knowledge_cases.json` with the
 * on-device model Tacet used before it moved to an API; they have not been re-measured against a hosted model.
 */

/** A note Tacet may fit to a message. */
export type NoteCandidate = { id: string; title: string; tags: string[] };

/** Notes offered in one request. Each shows twice, so this keeps the request well under a thousand tokens. */
export const NOTES_PER_REQUEST = 30;
/** The message and two copies of thirty short options fit within this. */
export const KNOWLEDGE_MAX_LENGTH = 1024;
const MESSAGE_CHARS = 1_000;
const TITLE_CHARS = 120;
const OTHER = 'other';
const INSTRUCTIONS = 'What is this message about?';

/**
 * A note loads when its averaged probability reaches this many times an even share (one over the number of options,
 * "other" included) and beats "other". With twenty notes that is 0.20, the lowest value that loaded no wrong note on
 * the tune half of the cases; it held on the held-out half. Fewer options each draw a larger share, so the bar rises
 * with them, and never above `MOST_A_NOTE_NEEDS` (docs/memory.md).
 */
export const KNOWLEDGE_FIT_LIFT = 4.2;
const MOST_A_NOTE_NEEDS = 0.75;
/**
 * How long a run waits for Tacet before its context is frozen without it. An API answers twenty notes in about a
 * second; a slower answer is dropped and the run starts with the notes the keywords found.
 */
export const KNOWLEDGE_FIT_BUDGET_MS = 3_000;

/** The bar for one request with `noteCount` notes offered. */
export function fitThreshold(noteCount: number): number {
  return Math.min(MOST_A_NOTE_NEEDS, KNOWLEDGE_FIT_LIFT / (noteCount + 1));
}

export function routingState(message: string): DecisionState {
  return message.slice(0, MESSAGE_CHARS);
}

/** The two questions (the notes in both orders) and, for each option name, the note it stands for. */
export function noteRouting(notes: readonly NoteCandidate[]): { questions: DecisionQuestions; noteOf: Map<string, string> } {
  const noteOf = new Map<string, string>();
  const criteria: [string, string | null][] = [];
  for (const note of notes.slice(0, NOTES_PER_REQUEST)) {
    const base = note.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_CHARS) || 'note';
    let name = base;
    for (let copy = 2; noteOf.has(name) || name.toLowerCase() === OTHER; copy++) name = `${base} (${copy})`;
    noteOf.set(name, note.id);
    criteria.push([name, note.tags.length ? note.tags.join(', ') : null]);
  }
  const forward = Object.fromEntries([...criteria, [OTHER, 'something else']]);
  const backward = Object.fromEntries([...[...criteria].reverse(), [OTHER, 'something else']]);
  return {
    questions: {
      topic: { type: 'choice', instructions: INSTRUCTIONS, criteria: forward },
      reversed: { type: 'choice', instructions: INSTRUCTIONS, criteria: backward },
    },
    noteOf,
  };
}

/** Each note's probability, by id, averaged over the two orders; `other` is the share left to "something else". */
export function noteShares(answers: Record<string, DecisionAnswer>, noteOf: ReadonlyMap<string, string>): { shares: Map<string, number>; other: number } {
  const shares = new Map<string, number>();
  const choices = Object.values(answers).filter(answer => answer.type === 'choice');
  if (!choices.length) return { shares, other: 1 };
  const average = (name: string) => choices.reduce((sum, answer) => sum + (answer.probabilities[name] ?? 0), 0) / choices.length;
  for (const [name, noteId] of noteOf) shares.set(noteId, average(name));
  return { shares, other: average(OTHER) };
}

/** The notes that fit, by id, with their probability: at the bar for this many notes or above, and ahead of "other". */
export function fittingNotes(answers: Record<string, DecisionAnswer>, noteOf: ReadonlyMap<string, string>): Map<string, number> {
  const { shares, other } = noteShares(answers, noteOf);
  const threshold = fitThreshold(noteOf.size);
  const fitting = new Map<string, number>();
  for (const [noteId, share] of shares) {
    if (share >= threshold && share > other) fitting.set(noteId, share);
  }
  return fitting;
}

/**
 * Asks Tacet which of `notes` fit `message`, within the budget. Undefined when Tacet is off, fails or
 * is late: the run then loads what the keywords matched, as it did before COD-306.
 */
export async function askKnowledgeFit(decider: Decider, message: string, notes: readonly NoteCandidate[], budgetMs = KNOWLEDGE_FIT_BUDGET_MS): Promise<Map<string, number> | undefined> {
  if (!notes.length || !message.trim()) return undefined;
  const { questions, noteOf } = noteRouting(notes);
  const response = await decideWithin(decider, budgetMs, routingState(message), questions, KNOWLEDGE_MAX_LENGTH);
  if (!response) return undefined;
  return fittingNotes(response.answers, noteOf);
}
