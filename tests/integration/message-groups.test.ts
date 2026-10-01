import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { GROUP_WINDOW_MS, continuesGroup, messageGrouping, personAuthorKey, workerAuthorKey } from '../../apps/desktop/src/renderer/messageGroups';
import type { Artifact, Run, Skill, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ChatQuote } from '../../apps/desktop/src/shared/side-threads';

/*
 * COD-365: messages are a flat list, and a run of messages from one author shares one head (face, name, time), the
 * way Slack groups them. The later ones keep only their text, with the time in the gutter under the pointer.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 9, minutes)).toISOString();

describe('which messages join the group before them', () => {
  it('joins the same author within the window and nothing else', () => {
    const person = { key: personAuthorKey, at: at(0) };
    expect(continuesGroup(undefined, person)).toBe(false);
    expect(continuesGroup(person, { key: personAuthorKey, at: at(4) })).toBe(true);
    expect(continuesGroup(person, { key: personAuthorKey, at: new Date(Date.parse(at(0)) + GROUP_WINDOW_MS + 1).toISOString() })).toBe(false);
    expect(continuesGroup(person, { key: workerAuthorKey('scout'), at: at(1) })).toBe(false);
    // A time that is not known, or that runs backwards, starts a new head rather than guessing.
    expect(continuesGroup(person, { key: personAuthorKey })).toBe(false);
    expect(continuesGroup({ key: personAuthorKey, at: at(5) }, { key: personAuthorKey, at: at(1) })).toBe(false);
  });

  it('starts a fresh group after a break such as a time mark', () => {
    const grouping = messageGrouping();
    expect(grouping.place({ key: personAuthorKey, at: at(0) })).toBe(false);
    expect(grouping.place({ key: personAuthorKey, at: at(1) })).toBe(true);
    grouping.breakHere();
    expect(grouping.place({ key: personAuthorKey, at: at(2) })).toBe(false);
  });
});

describe('the flat list in a rendered chat', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222221';
  const artifactId = '33333333-3333-4333-8333-333333333331';
  const skill: Skill = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, name: 'Skill', content: 'Help.' };
  const worker: Worker = { id: '44444444-4444-4444-8444-444444444441', revision: 1, name: 'Scout', instructions: 'Work.', provider: 'anthropic', skillId: skill.id };
  const quoteOf = (id: string, minutes: number): ChatQuote => ({ id, fromTaskId: '55555555-5555-4555-8555-555555555551', artifactId: '55555555-5555-4555-8555-555555555552',
    author: 'Scout', authorId: worker.id, text: `Quote ${minutes}`, afterRevision: 0, createdAt: at(minutes) });
  const task: Task = { id: taskId, workerId: worker.id, brief: 'Tóm tắt hóa đơn.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: at(0),
    quotes: [quoteOf('66666666-6666-4666-8666-666666666661', 3), quoteOf('66666666-6666-4666-8666-666666666662', 4)] };
  const run: Run = { id: runId, taskId, status: 'completed', startedAt: at(0), error: null, snapshot: { worker, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } } };
  const answer: Artifact = { id: artifactId, runId, createdAt: at(1), hash: 'b'.repeat(64), report: { format: 'chat', title: 'Tóm tắt', summary: 'Hóa đơn tháng 9 là 1.200.000đ.', findings: [], limitations: [] } };
  const detail: TaskDetail = { task, runs: [run], events: [], artifacts: [answer], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [],
    usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const html = renderToStaticMarkup(createElement(TaskThread, {
    detail, workspace: { workers: [worker], skills: [skill], tasks: [task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
  /** Each message's opening tag and what follows it up to the next message. */
  const messages = html.split(/(?=<section class="(?:person-message|assistant-message)[^"]*")/).slice(1);

  it('starts every message at the left with a head, the person\'s included', () => {
    expect(messages).toHaveLength(4);
    const [ask, reply] = messages;
    expect(ask).toMatch(/^<section class="person-message" aria-label="Your message">/);
    expect(ask).toContain('class="avatar md person-face"');
    expect(ask).toContain('<strong>You</strong>');
    expect(ask).toContain(`<time class="message-time" dateTime="${at(0)}"`);
    expect(reply).toMatch(/^<section class="assistant-message" aria-label="Reply from Scout">/);
    // The face sits in its gutter slot, which the mascot's states (thinking, landed) read.
    expect(reply).toContain('<div class="message-gutter"><span class="message-byline">');
    expect(reply).toContain('<strong>Scout</strong>');
    // No bubble paint is left on either side: the answer is plain text in the message's column.
    expect(html).not.toContain('chat-bubble-row');
  });

  it('groups the second of two messages from the person under the first one\'s head', () => {
    const [, , firstQuote, secondQuote] = messages;
    expect(firstQuote).not.toContain('data-continued');
    expect(firstQuote).toContain('<strong>You</strong>');
    expect(secondQuote).toContain('data-continued="true"');
    expect(secondQuote).not.toContain('<strong>You</strong>');
    expect(secondQuote).not.toContain('person-face');
    // Its time waits in the gutter for the pointer.
    expect(secondQuote).toContain(`<time class="message-hover-time" dateTime="${at(4)}"`);
  });

  it('keeps the anchors search, reply quotes and notifications jump to', () => {
    expect(html).toContain(`id="message-${artifactId}"`);
    expect(html).toContain('id="message-66666666-6666-4666-8666-666666666661"');
  });
});
