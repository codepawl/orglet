import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { MessageInteractions } from '../../apps/desktop/src/core/orchestration/message-interactions';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { MessageActions, messageMenuItems } from '../../apps/desktop/src/renderer/components/MessageActions';
import { Reply } from 'lucide-react';
import { ReactionPicker } from '../../apps/desktop/src/renderer/components/ReactionBar';
import { pickReaction, reactionEmoji, reactionMeanings, reactionOrder, userReactionOn } from '../../apps/desktop/src/renderer/components/messageMarks';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * COD-219: reactions sit with their message, one per person, and the react button always opens the picker. Since COD-365
 * they are a row under the message, and the buttons are the message's floating toolbar.
 */

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => store.close());

function savedChat() {
  const researcher: Worker = { ...store.all<Worker>('workers')[0], id: id(), name: 'Researcher', provider: 'openai' };
  const skill = store.get<Skill>('skills', researcher.skillId);
  const task: Task = { id: id(), workerId: researcher.id, brief: 'Tôi vừa phát hành Orglet 0.2.4.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, status: 'completed', snapshot: { worker: researcher, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } }, startedAt: now(), error: null };
  const report = { format: 'chat' as const, title: 'Answer', summary: 'Chúc mừng bạn đã phát hành Orglet 0.2.4!', findings: [], limitations: [] };
  const artifact: Artifact = { id: id(), runId: run.id, report, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now(), replyTo: turnMessageId(task.id, 0) };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  store.put('artifacts', artifact, { column: 'run_id', value: run.id });
  return { task, run, artifact, researcher, skill };
}

function renderThread(taskId: string, workers: Worker[], skills: Skill[]) {
  const detail = store.detail(taskId);
  return renderToStaticMarkup(createElement(TaskThread, {
    detail, workspace: { workers, skills, tasks: [detail.task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

/** The markup of one message: its text with the given id up to its toolbar, and the toolbar up to the end of the message. */
function bubbleMarkup(html: string, elementId: string) {
  const start = html.indexOf(`id="${elementId}"`);
  expect(start).toBeGreaterThan(-1);
  const actions = html.indexOf('class="message-actions"', start);
  expect(actions).toBeGreaterThan(start);
  const ends = [html.indexOf('class="assistant-message"', actions), html.indexOf('</section>', actions)].filter(index => index > -1);
  return { bubble: html.slice(start, actions), actions: html.slice(actions, Math.min(...ends)) };
}

describe('the badges under the message', () => {
  it('puts the marks under the person\'s message and under the answer, and keeps them out of the toolbar', () => {
    const { task, run, artifact, researcher, skill } = savedChat();
    const userTurn = turnMessageId(task.id, 0);
    store.update('tasks', { ...task, messageReactions: [
      { messageId: userTurn, emoji: 'delighted', actor: 'worker', workerId: researcher.id, runId: run.id, callId: 'answer-reaction-1', createdAt: now() },
      { messageId: artifact.id, emoji: 'funny', actor: 'user', createdAt: now() },
      { messageId: artifact.id, emoji: 'funny', actor: 'worker', workerId: researcher.id, runId: run.id, callId: 'answer-reaction-2', createdAt: now() },
    ] });
    const html = renderThread(task.id, [researcher], [skill]);

    const userBubble = bubbleMarkup(html, `message-${userTurn}`);
    expect(userBubble.bubble).toContain('class="org-reaction-badges org-reaction-badges-inline"');
    expect(userBubble.bubble).toContain('🎉');
    expect(userBubble.bubble).toContain('1 reacted 🎉: Researcher');
    expect(userBubble.bubble).toContain('aria-pressed="false"');
    expect(userBubble.actions).not.toContain('reaction-badge');

    const answer = bubbleMarkup(html, `message-${artifact.id}`);
    expect(answer.bubble).toContain('class="org-reaction-badges org-reaction-badges-inline"');
    expect(answer.bubble).toContain('2 reacted 😂: You, Researcher');
    expect(answer.bubble).toContain('aria-pressed="true"');
    expect(answer.bubble).toContain('class="org-reaction-badge-count" aria-hidden="true">2<');
    expect(answer.actions).not.toContain('reaction-badge');
    expect(answer.actions).not.toContain('😂');
    // The answer's toolbar still carries the react trigger, which opens the picker rather than clearing the mark.
    expect(answer.actions).toContain('aria-haspopup="true"');
  });

  it('puts a report\'s marks under its card', () => {
    const { task, run, artifact, researcher, skill } = savedChat();
    const report = { ...artifact.report, format: 'report' as const };
    store.put('artifacts', { ...artifact, report, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex') }, { column: 'run_id', value: run.id });
    store.update('tasks', { ...task, messageReactions: [{ messageId: artifact.id, emoji: 'agree', actor: 'user', createdAt: now() }] });
    const html = renderThread(task.id, [researcher], [skill]);
    const card = html.indexOf('class="report-card"');
    const badges = html.indexOf('class="org-reaction-badges org-reaction-badges-inline"');
    expect(card).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(card);
    expect(html.indexOf('class="message-actions"', card)).toBeGreaterThan(badges);
  });
});

describe('the react button and the picker', () => {
  const options = reactionOrder.map(name => ({ name, emoji: reactionEmoji[name], meaning: reactionMeanings[name] }));

  it('keeps the trigger in the row when a reaction exists, with no chip to clear it', () => {
    const { task, artifact } = savedChat();
    const html = renderToStaticMarkup(createElement(MessageActions, {
      taskId: task.id, messageId: artifact.id, author: 'Researcher', text: artifact.report.summary, action: () => {},
      reactions: [{ messageId: artifact.id, emoji: 'agree', actor: 'user', createdAt: now() }],
    }));
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('reaction-chip');
    expect(html).not.toContain('reaction-badge');
    expect(html).not.toContain('👍');
  });

  it('lists the right-click menu in the toolbar order: selection, reply, reactions with the current one checked, copy and download, forward, save, extras', () => {
    const calls: string[] = [];
    const items = messageMenuItems({
      selected: 'a few words', current: 'funny', isSaved: false,
      artifact: { onCopy: format => calls.push(`copy ${format}`), onDownload: format => calls.push(`download ${format}`) },
      formatPreferences: { copy: 'ask', download: 'markdown' },
      extraItems: [{ label: 'Bring in', icon: Reply, onSelect: () => calls.push('bring') }],
      onCopySelection: () => calls.push('selection'), onCopyMessage: () => calls.push('whole'), onReply: () => calls.push('reply'), onForward: () => calls.push('forward'),
      onPick: name => calls.push(`pick ${name}`), onToggleSaved: () => calls.push('save'),
    });
    expect(items.map(item => item.label)).toEqual([
      'Copy selection', 'Reply to this', ...reactionOrder.map(name => reactionMeanings[name]),
      'Copy as plain text', 'Copy as Markdown', 'Download Markdown (.md)', 'Forward this message', 'Save for later', 'Bring in',
    ]);
    const reactionItems = items.filter(item => item.checked !== undefined);
    expect(reactionItems).toHaveLength(reactionOrder.length);
    expect(reactionItems.filter(item => item.checked).map(item => item.label)).toEqual([reactionMeanings.funny]);
    items.forEach(item => item.onSelect());
    expect(calls).toContain('pick funny');
    expect(calls).toHaveLength(items.length);
  });

  it('gives the person\'s own message a plain Copy, no download and no forward without a picker, and Remove from Saved once saved', () => {
    const items = messageMenuItems({
      selected: '', current: undefined, isSaved: true, formatPreferences: { copy: 'ask', download: 'ask' },
      onCopySelection: () => {}, onCopyMessage: () => {}, onReply: () => {}, onPick: () => {}, onToggleSaved: () => {},
    });
    expect(items[0].label).toBe('Reply to this');
    expect(items.map(item => item.label)).toContain('Copy');
    expect(items.map(item => item.label)).not.toContain('Forward this message');
    expect(items.at(-1)?.label).toBe('Remove from Saved');
    expect(items.every(item => item.checked !== true)).toBe(true);
  });

  it('shows the current reaction pressed in the picker', () => {
    const html = renderToStaticMarkup(createElement(ReactionPicker, { options, picked: 'delighted', label: 'React', onPick: () => {} }));
    const pressed = html.match(/aria-pressed="true"/g) ?? [];
    expect(pressed).toHaveLength(1);
    expect(html).toContain(`class="org-reaction-picked" aria-pressed="true" aria-label="${reactionMeanings.delighted}"`);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(reactionOrder.length - 1);
  });

  it('takes the same emoji off and switches to another', () => {
    expect(pickReaction('delighted', 'delighted')).toEqual({ emoji: 'delighted', active: false });
    expect(pickReaction('delighted', 'funny')).toEqual({ emoji: 'funny', active: true });
    expect(pickReaction(undefined, 'funny')).toEqual({ emoji: 'funny', active: true });
    const messageId = id();
    expect(userReactionOn([
      { messageId, emoji: 'agree', actor: 'worker', workerId: id(), createdAt: now() },
      { messageId, emoji: 'funny', actor: 'user', createdAt: now() },
    ], messageId)).toBe('funny');
    expect(userReactionOn([], messageId)).toBeUndefined();
  });
});

describe('one reaction per person in the core', () => {
  it('replaces the person\'s earlier emoji on the same message and leaves other messages alone', () => {
    const { task, artifact } = savedChat();
    const interactions = new MessageInteractions(store);
    const userTurn = turnMessageId(task.id, 0);
    interactions.userReaction({ taskId: task.id, messageId: artifact.id, emoji: 'agree', active: true });
    interactions.userReaction({ taskId: task.id, messageId: userTurn, emoji: 'watching', active: true });
    interactions.userReaction({ taskId: task.id, messageId: artifact.id, emoji: 'delighted', active: true });
    expect(store.get<Task>('tasks', task.id).messageReactions).toMatchObject([
      { messageId: userTurn, emoji: 'watching', actor: 'user' },
      { messageId: artifact.id, emoji: 'delighted', actor: 'user' },
    ]);
    // Taking off an emoji that is not the current one changes nothing; taking off the current one clears it.
    interactions.userReaction({ taskId: task.id, messageId: artifact.id, emoji: 'agree', active: false });
    expect(store.get<Task>('tasks', task.id).messageReactions).toHaveLength(2);
    interactions.userReaction({ taskId: task.id, messageId: artifact.id, emoji: 'delighted', active: false });
    expect(store.get<Task>('tasks', task.id).messageReactions).toMatchObject([{ messageId: userTurn, emoji: 'watching' }]);
  });

  it('keeps one per worker too, without touching another worker\'s or the person\'s mark', () => {
    const { task, researcher, skill } = savedChat();
    const interactions = new MessageInteractions(store);
    const userTurn = turnMessageId(task.id, 0);
    interactions.userReaction({ taskId: task.id, messageId: userTurn, emoji: 'agree', active: true });
    const running = (worker: Worker): Run => {
      const run: Run = { id: id(), taskId: task.id, status: 'running', snapshot: { worker, skill, inputRevision: 0 }, startedAt: now(), error: null };
      store.put('runs', run, { column: 'task_id', value: task.id });
      return run;
    };
    store.update('tasks', { ...store.get<Task>('tasks', task.id), status: 'running' });
    const researcherRun = running(researcher);
    const writerRun = running({ ...researcher, id: id(), name: 'Writer' });
    interactions.workerReaction(researcherRun, 'r-1', { messageId: userTurn, emoji: 'watching', active: true });
    interactions.workerReaction(writerRun, 'w-1', { messageId: userTurn, emoji: 'watching', active: true });
    interactions.workerReaction(researcherRun, 'r-2', { messageId: userTurn, emoji: 'delighted', active: true });
    expect(store.get<Task>('tasks', task.id).messageReactions).toMatchObject([
      { messageId: userTurn, emoji: 'agree', actor: 'user' },
      { messageId: userTurn, emoji: 'watching', actor: 'worker', workerId: writerRun.snapshot.worker.id },
      { messageId: userTurn, emoji: 'delighted', actor: 'worker', workerId: researcher.id, callId: 'r-2' },
    ]);
  });
});
