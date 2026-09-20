import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { TeamMailbox } from '../../apps/desktop/src/core/orchestration/mailbox';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, memberIdsFromPlanPrompt } from './team-plan';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { store.close(); });

function fixture() {
  const first = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const second = { ...first, id: id(), name: 'Second' };
  const lead = { ...first, id: id(), name: 'Lead' };
  const skill = store.all<Skill>('skills')[0];
  const team: Team = { id: id(), revision: 1, name: 'Team', instructions: 'Coordinate work', memberIds: [first.id, second.id], synthesizerId: lead.id, workflow: 'parallel', monthlyBudgetMicros: 1_000_000 };
  const task: Task = { id: id(), teamId: team.id, workerId: lead.id, brief: 'Team work', sourceIds: [], budgetMicros: 1_000_000,
    consent: true, status: 'running', accepted: false, createdAt: now(), inputRevision: 1 };
  store.put('tasks', task);
  const runs = [first, second, lead].map((worker, index): Run => ({ id: id(), taskId: task.id, stage: index === 2 ? 'synthesis' : 'member',
    status: 'running', snapshot: { team, worker, skill, inputRevision: 1 }, startedAt: now(), error: null }));
  const plan: Run = { ...runs[2], id: id(), stage: 'plan', status: 'completed', snapshot: { ...runs[2].snapshot,
    plan: { assignments: [first, second].map(worker => ({ workerId: worker.id, brief: 'Assignment' })) } } };
  for (const run of [...runs, plan]) store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, runs, mailbox: new TeamMailbox(store) };
}

it('isolates the mailbox by task, turn, membership and recipient', () => {
  const { task, runs, mailbox } = fixture();
  const sent = mailbox.send(runs[0], 'call-one', { recipientId: runs[1].snapshot.worker.id, kind: 'handoff', body: 'Result', replyTo: null });
  expect(mailbox.read(runs[0])).toEqual([]);
  expect(mailbox.read(runs[1]).map(event => event.id)).toEqual([sent.id]);
  expect(() => mailbox.acknowledge(runs[0], { messageIds: [sent.id] })).toThrow('người khác');
  expect(() => mailbox.send(runs[0], 'outside', { recipientId: id(), kind: 'question', body: 'Outside?', replyTo: null })).toThrow('không thuộc');
  store.update('tasks', { ...task, inputRevision: 2 });
  expect(() => mailbox.read(runs[1])).toThrow('lượt đang chạy');
});

it('replays a persisted send once and retains acknowledged handoffs on resume', () => {
  const { runs, mailbox } = fixture();
  const input = { recipientId: runs[1].snapshot.worker.id, kind: 'handoff', body: 'Committed result', replyTo: null };
  const sent = mailbox.send(runs[0], 'persisted-call', input);
  const resumed = new TeamMailbox(store);
  expect(resumed.send(runs[0], 'persisted-call', input).id).toBe(sent.id);
  expect(() => resumed.send(runs[0], 'persisted-call', { ...input, body: 'Changed' })).toThrow('nội dung khác');
  resumed.acknowledge(runs[1], { messageIds: [sent.id] });
  resumed.acknowledge(runs[1], { messageIds: [sent.id] });
  expect(new TeamMailbox(store).read(runs[1])).toEqual([]);
  expect(store.detail(runs[0].taskId).events).toHaveLength(1);
});

it('orders mailbox messages with other saved run events', () => {
  const { runs, mailbox } = fixture();
  store.event(runs[0].id, 'Before handoff');
  const sent = mailbox.send(runs[0], 'ordered', { recipientId: runs[1].snapshot.worker.id, kind: 'handoff', body: 'Result', replyTo: null });
  store.event(runs[0].id, 'After handoff');
  expect(sent.sequence).toBe(2);
  expect(store.detail(runs[0].taskId).events.filter(event => event.runId === runs[0].id).map(event => event.sequence)).toEqual([1, 2, 3]);
});

it('permits two questions and escalates the third to the lead without dispatching agents', () => {
  const { runs, mailbox } = fixture();
  const count = store.all('runs').length;
  for (let round = 0; round < 2; round++) {
    const question = mailbox.send(runs[0], `question-${round}`, { recipientId: runs[1].snapshot.worker.id, kind: 'question', body: 'Which result?', replyTo: null });
    mailbox.send(runs[1], `response-${round}`, { recipientId: runs[0].snapshot.worker.id, kind: 'response', body: 'This result', replyTo: question.id });
    expect(mailbox.read(runs[1])).toEqual([]);
  }
  const blocker = mailbox.send(runs[0], 'third', { recipientId: runs[1].snapshot.worker.id, kind: 'question', body: 'Still unclear', replyTo: null });
  expect(blocker.teamMessage.kind).toBe('blocker');
  expect(blocker.teamMessage.recipientId).toBe(runs[2].snapshot.worker.id);
  expect(mailbox.send(runs[0], 'third', { recipientId: runs[1].snapshot.worker.id, kind: 'question', body: 'Still unclear', replyTo: null }).id).toBe(blocker.id);
  expect(store.all('runs')).toHaveLength(count);
});

it('retains the question limit when an assignment changes worker', () => {
  const { runs, mailbox } = fixture();
  for (let round = 0; round < 2; round++) {
    mailbox.send(runs[0], `question-${round}`, { recipientId: runs[1].snapshot.worker.id, kind: 'question', body: 'Need context', replyTo: null });
  }
  const reassigned: Run = { ...runs[1], id: id(), snapshot: { ...runs[1].snapshot,
    assignment: { workerId: runs[0].snapshot.worker.id, brief: 'Continue original work' } } };
  store.put('runs', reassigned, { column: 'task_id', value: reassigned.taskId });
  const message = mailbox.send(reassigned, 'next-question', { recipientId: runs[0].snapshot.worker.id, kind: 'question', body: 'Still blocked', replyTo: null });
  expect(message.teamMessage.kind).toBe('blocker');
  expect(message.teamMessage.recipientId).toBe(runs[2].snapshot.worker.id);
  expect(message.teamMessage.assignmentWorkerId).toBe(runs[0].snapshot.worker.id);
});

it('rejects a response to a different task or an already answered question', () => {
  const first = fixture();
  const second = fixture();
  const question = first.mailbox.send(first.runs[0], 'question', { recipientId: first.runs[1].snapshot.worker.id, kind: 'question', body: 'Help?', replyTo: null });
  expect(() => second.mailbox.send(second.runs[1], 'foreign-response', { recipientId: second.runs[0].snapshot.worker.id, kind: 'response', body: 'Answer', replyTo: question.id })).toThrow('không khớp');
  const input = { recipientId: first.runs[0].snapshot.worker.id, kind: 'response', body: 'Answer', replyTo: question.id };
  first.mailbox.send(first.runs[1], 'response', input);
  expect(() => first.mailbox.send(first.runs[1], 'duplicate-response', input)).toThrow('không khớp');
});

it('lets only the lead resolve pending blockers atomically and replays the same decision', () => {
  const { task, runs, mailbox } = fixture();
  const hasResolutionTool = (run: Run) => toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === 'resolve_team_messages');
  expect(hasResolutionTool(runs[0])).toBe(false);
  expect(hasResolutionTool(runs[2])).toBe(true);
  const question = mailbox.send(runs[0], 'question', { recipientId: runs[1].snapshot.worker.id, kind: 'question', body: 'Help?', replyTo: null });
  const input = { messageIds: [question.id], resolution: 'Use the attached evidence.' };
  expect(() => mailbox.resolve(runs[0], input)).toThrow('trưởng nhóm');
  expect(() => mailbox.resolve(runs[2], { ...input, messageIds: [question.id, id()] })).toThrow('Không tìm thấy');
  expect(mailbox.read(runs[1])).toHaveLength(1);
  expect(mailbox.resolve(runs[2], input)).toEqual({ resolved: [question.id] });
  expect(new TeamMailbox(store).resolve(runs[2], input)).toEqual({ resolved: [question.id] });
  expect(mailbox.read(runs[1])).toEqual([]);
  expect(() => mailbox.resolve(runs[2], { ...input, resolution: 'Different decision' })).toThrow('quyết định khác');
  expect(() => mailbox.send(runs[1], 'late-response', { recipientId: runs[0].snapshot.worker.id, kind: 'response', body: 'Late answer', replyTo: question.id })).toThrow('không khớp');
  expect(store.get<Run>('runs', runs[0].id).status).toBe('running');
});

it.each(['claude-code', 'codex', 'cursor'] as const)('advertises mailbox tools to assigned %s members but not lead decisions', provider => {
  const { task, runs } = fixture();
  runs[0].snapshot.worker.provider = provider;
  expect(toolsFor(runs[0], task).some(tool => tool.type === 'function' && tool.function.name === 'send_team_message')).toBe(true);
  expect(toolsFor(runs[0], task).some(tool => tool.type === 'function' && tool.function.name === 'resolve_team_messages')).toBe(false);
});

it.each(['handoff', 'pending', 'resolved'] as const)('passes durable messages through the team and preserves resolutions (mode=%s)', async mode => {
  const unresolved = mode !== 'handoff';
  let recipientId = '';
  let senderId = '';
  let sent = false;
  let acknowledged = false;
  let resolved = false;
  const core = new CoreService(store, () => {}, async () => ({ request: async (messages, tools) => {
    let call;
    if (isPlanRequest(tools)) {
      [senderId, recipientId] = memberIdsFromPlanPrompt(messages);
      call = { name: 'submit_plan', arguments: JSON.stringify({ assignments: [
        { workerId: senderId, brief: 'send-handoff' },
        { workerId: recipientId, brief: 'receive-handoff', dependsOn: [senderId] },
      ] }) };
    } else {
      const context = messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
      if (context.includes('"assignment":"send-handoff') && !sent) {
        sent = true;
        call = { name: 'send_team_message', arguments: JSON.stringify({ recipientId, kind: unresolved ? 'question' : 'handoff', body: 'durable-result-42', replyTo: null }) };
      } else if (context.includes('"assignment":"receive-handoff') && !acknowledged) {
        expect(context).toContain('durable-result-42');
        const message = store.all<{ id: string; teamMessage?: unknown }>('events').find(event => event.teamMessage)!;
        acknowledged = true;
        call = unresolved ? { name: 'submit_report', arguments: JSON.stringify({ title: 'Incomplete', summary: 'Needs lead input', findings: [], limitations: ['Unanswered question'] }) }
          : { name: 'acknowledge_team_messages', arguments: JSON.stringify({ messageIds: [message.id] }) };
      } else if (mode === 'resolved' && !resolved && tools?.some(tool => tool.type === 'function' && tool.function.name === 'resolve_team_messages')) {
        const message = store.detail(store.all<Task>('tasks').find(task => task.status === 'running')!.id).events.find(event => event.teamMessage)!;
        resolved = true;
        call = { name: 'resolve_team_messages', arguments: JSON.stringify({ messageIds: [message.id], resolution: 'Use the recorded handoff as context; no further worker action is needed.' }) };
      } else {
        call = { name: 'submit_report', arguments: JSON.stringify({ title: 'Result', summary: 'Completed work', findings: [], limitations: [] }) };
      }
    }
    return { calls: [{ id: id(), ...call }], usage: { input: 10, output: 10 } };
  } }));
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Work together', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  for (let attempt = 0; attempt < 300 && core.teams.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
  expect(store.detail(taskId).task.status).toBe(mode === 'pending' ? 'partial' : 'completed');
  expect(sent && acknowledged).toBe(true);
  const detail = store.detail(taskId);
  const synthesis = detail.runs.find(run => run.stage === 'synthesis')!;
  const finalReport = detail.artifacts.find(artifact => artifact.runId === synthesis.id)!.report;
  if (mode === 'pending') expect(finalReport.limitations).toContain('durable-result-42');
  else expect(finalReport.limitations).not.toContain('durable-result-42');
  const backup = new Backups(store, () => false, () => {}).export();
  const restored = new Store(':memory:');
  try {
    const manager = new Backups(restored, () => false, () => {});
    manager.restore(manager.preview(backup).token);
    const restoredMessages = restored.detail(taskId).events.filter(event => event.teamMessage);
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0].teamMessage?.state).toBe(mode === 'handoff' ? 'acknowledged' : mode);
    if (mode === 'resolved') expect(restoredMessages[0].teamMessage?.resolution?.body).toContain('recorded handoff');
  } finally {
    restored.close();
  }
});

it('exchanges and consumes a question and response between parallel workers in one turn', async () => {
  let requesterId = '';
  let responderId = '';
  let requesterStep = 0;
  let responderStep = 0;
  let questionStored!: () => void;
  let responseStored!: () => void;
  const questionReady = new Promise<void>(resolve => { questionStored = resolve; });
  const responseReady = new Promise<void>(resolve => { responseStored = resolve; });
  const report = { title: 'Result', summary: 'Used the recorded answer', findings: [], limitations: [] };
  const core = new CoreService(store, () => {}, async () => ({ request: async (messages, tools) => {
    let name = 'submit_report';
    let argumentsValue: unknown = report;
    if (isPlanRequest(tools)) {
      [requesterId, responderId] = memberIdsFromPlanPrompt(messages);
      name = 'submit_plan';
      argumentsValue = { assignments: [
        { workerId: requesterId, brief: 'ask-peer', dependsOn: [] },
        { workerId: responderId, brief: 'answer-peer', dependsOn: [] },
      ] };
    } else {
      const context = messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
      if (context.includes('"assignment":"ask-peer')) {
        if (requesterStep++ === 0) {
          name = 'send_team_message';
          argumentsValue = { recipientId: responderId, kind: 'question', body: 'Which revision was checked?', replyTo: null };
        } else if (requesterStep === 2) {
          questionStored();
          await responseReady;
          name = 'read_team_messages';
          argumentsValue = {};
        } else if (requesterStep === 3) {
          expect(context).toContain('Checked revision 42');
          const response = store.all<{ id: string; teamMessage?: { kind: string } }>('events').find(event => event.teamMessage?.kind === 'response')!;
          name = 'acknowledge_team_messages';
          argumentsValue = { messageIds: [response.id] };
        }
      } else if (context.includes('"assignment":"answer-peer')) {
        if (responderStep++ === 0) {
          await questionReady;
          const question = store.all<{ id: string; teamMessage?: { kind: string } }>('events').find(event => event.teamMessage?.kind === 'question')!;
          name = 'send_team_message';
          argumentsValue = { recipientId: requesterId, kind: 'response', body: 'Checked revision 42', replyTo: question.id };
        } else responseStored();
      }
    }
    return { calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 10, output: 10 } };
  } }));
  const created = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = { ...created, workflow: 'parallel' as const };
  store.update('teams', team);
  const task: Task = { id: id(), teamId: team.id, workerId: team.synthesizerId, brief: 'Resolve the revision together', sourceIds: [],
    consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000, accepted: false, status: 'queued', createdAt: now() };
  store.put('tasks', task);
  const workersBefore = store.all('workers').length;
  await core.teams.run(task, team);
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('completed');
  expect(detail.runs).toHaveLength(4);
  expect(detail.artifacts).toHaveLength(3);
  expect(store.all('workers')).toHaveLength(workersBefore);
  expect(detail.events.flatMap(event => event.teamMessage ? [[event.teamMessage.kind, event.teamMessage.state]] : []))
    .toEqual([['question', 'answered'], ['response', 'acknowledged']]);
  expect(requesterStep).toBe(4);
});
