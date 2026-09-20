import { createHash } from 'node:crypto';
import type { Activity, Run, Task } from '../../shared/contracts';
import { AcknowledgeTeamMessages, ResolveTeamMessages, SendTeamMessage, TeamMessage } from '../../shared/team-messages';
import { Store, id, now } from '../storage/database';
import { assignmentKey } from './assignments';

export type MessageEvent = Activity & { teamMessage: TeamMessage };

/** Messages share the existing event journal, so backup and task deletion retain their normal boundaries. */
export class TeamMailbox {
  constructor(private store: Store) {}

  private scope(run: Run) {
    const current = this.store.get<Run>('runs', run.id);
    const task = this.store.get<Task>('tasks', run.taskId);
    const team = current.snapshot.team;
    if (current.taskId !== task.id || !team || !['member', 'synthesis'].includes(current.stage ?? '') || current.status !== 'running'
      || task.teamId !== team.id || (task.inputRevision ?? 0) !== (current.snapshot.inputRevision ?? 0)) {
      throw new Error('Hộp thư chỉ dùng trong team và lượt đang chạy.');
    }
    const detail = this.store.detail(task.id);
    const revision = current.snapshot.inputRevision ?? 0;
    const plan = detail.runs.findLast(candidate => candidate.stage === 'plan' && candidate.status === 'completed'
      && (candidate.snapshot.inputRevision ?? 0) === revision && candidate.snapshot.team?.id === team.id)?.snapshot.plan;
    const participants = new Set([team.synthesizerId, ...(plan?.assignments.map(assignment => assignment.workerId) ?? [])]);
    for (const candidate of detail.runs) {
      const decision = candidate.snapshot.reassignment;
      if (candidate.stage === 'member' && decision && candidate.snapshot.team?.id === team.id
        && (candidate.snapshot.inputRevision ?? 0) === revision && team.memberIds.includes(candidate.snapshot.worker.id)
        && decision.newWorkerId === candidate.snapshot.worker.id
        && plan?.assignments.some(assignment => assignment.workerId === decision.assignmentWorkerId)) {
        participants.add(candidate.snapshot.worker.id);
      }
    }
    if (!plan || !participants.has(current.snapshot.worker.id)) throw new Error('Người nhận không thuộc phần việc trong lượt này.');
    const messages = detail.events.filter((event): event is MessageEvent => !!event.teamMessage
      && event.teamMessage.teamId === team.id && event.teamMessage.inputRevision === revision);
    return { current, team, revision, participants, messages, runs: detail.runs };
  }

  read(run: Run): MessageEvent[] {
    const { current, messages } = this.scope(run);
    return messages.filter(event => event.teamMessage.state === 'pending'
      && (event.teamMessage.recipientId === current.snapshot.worker.id || current.stage === 'synthesis'));
  }

  send(run: Run, callId: string, raw: unknown): MessageEvent {
    const input = SendTeamMessage.parse(raw);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.store.transaction(() => {
      const { current, team, revision, participants, messages, runs } = this.scope(run);
      const previous = messages.find(event => event.runId === run.id && event.teamMessage.callId === callId);
      if (previous) {
        if (previous.teamMessage.requestHash !== requestHash) throw new Error('Tool call đã lưu có nội dung khác.');
        return previous;
      }
      if (!participants.has(input.recipientId) || input.recipientId === current.snapshot.worker.id) {
        throw new Error('Người nhận không thuộc phần việc trong lượt này.');
      }
      if (messages.length >= 80) throw new Error('Đã chạm giới hạn trao đổi; cần trưởng nhóm xử lý blocker.');
      let kind = input.kind;
      let recipientId = input.recipientId;
      let body = input.body;
      const assignmentWorkerId = assignmentKey(current);
      const questions = messages.filter(event => {
        if (event.teamMessage.kind !== 'question') return false;
        const senderRun = runs.find(candidate => candidate.id === event.runId);
        const senderAssignment = event.teamMessage.assignmentWorkerId
          ?? (senderRun ? assignmentKey(senderRun) : event.teamMessage.senderId);
        return senderAssignment === assignmentWorkerId;
      });
      if (kind === 'question' && questions.length >= 2) {
        kind = 'blocker';
        recipientId = team.synthesizerId;
        body = `Đã hết hai vòng hỏi–đáp. Cần trưởng nhóm xử lý: ${body}`;
      }
      const parent = input.replyTo ? messages.find(event => event.id === input.replyTo) : undefined;
      if (kind === 'response') {
        if (!parent || parent.teamMessage.kind !== 'question' || parent.teamMessage.state !== 'pending'
          || parent.teamMessage.senderId !== recipientId || parent.teamMessage.recipientId !== current.snapshot.worker.id) {
          throw new Error('Phản hồi không khớp câu hỏi trong lượt này.');
        }
      } else if (input.replyTo !== null) {
        throw new Error('Chỉ phản hồi được liên kết với câu hỏi.');
      }
      const event: MessageEvent = {
        id: id(), runId: run.id, sequence: this.store.nextEventSequence(run.id), createdAt: now(),
        message: `Trao đổi team: ${current.snapshot.worker.name} → ${recipientId}`,
        teamMessage: TeamMessage.parse({ ...input, kind, recipientId, body, teamId: team.id, inputRevision: revision,
          senderId: current.snapshot.worker.id, assignmentWorkerId, callId, requestHash, state: 'pending' }),
      };
      this.store.put('events', event, { column: 'run_id', value: run.id });
      if (parent) this.store.update('events', { ...parent, teamMessage: { ...parent.teamMessage, state: 'answered' } });
      return event;
    });
  }

  resolve(run: Run, raw: unknown): { resolved: string[] } {
    const input = ResolveTeamMessages.parse(raw);
    return this.store.transaction(() => {
      const { current, team, messages } = this.scope(run);
      if (current.stage !== 'synthesis' || current.snapshot.worker.id !== team.synthesizerId) {
        throw new Error('Chỉ trưởng nhóm được xử lý câu hỏi và blocker.');
      }
      const selected = input.messageIds.map(messageId => {
        const event = messages.find(candidate => candidate.id === messageId);
        if (!event || !['question', 'blocker'].includes(event.teamMessage.kind)) {
          throw new Error('Không tìm thấy câu hỏi hoặc blocker trong lượt này.');
        }
        const message = event.teamMessage;
        const replay = message.state === 'resolved' && message.resolution?.runId === current.id
          && message.resolution.body === input.resolution;
        if (message.state !== 'pending' && !replay) {
          throw new Error('Thông điệp đã được xử lý bằng quyết định khác.');
        }
        return event;
      });
      for (const event of selected) {
        if (event.teamMessage.state === 'resolved') continue;
        this.store.update('events', { ...event, teamMessage: { ...event.teamMessage, state: 'resolved',
          resolution: { runId: current.id, body: input.resolution, createdAt: now() } } });
      }
      return { resolved: input.messageIds };
    });
  }

  acknowledge(run: Run, raw: unknown): { acknowledged: string[] } {
    const { messageIds } = AcknowledgeTeamMessages.parse(raw);
    return this.store.transaction(() => {
      const { current, messages } = this.scope(run);
      const selected = messageIds.map(messageId => {
        const event = messages.find(candidate => candidate.id === messageId);
        if (!event || event.teamMessage.recipientId !== current.snapshot.worker.id) {
          throw new Error('Không được xác nhận thông điệp của người khác hoặc lượt khác.');
        }
        if (['question', 'blocker'].includes(event.teamMessage.kind)) {
          throw new Error('Câu hỏi và blocker cần được xử lý, không chỉ xác nhận đã đọc.');
        }
        return event;
      });
      for (const event of selected) {
        if (event.teamMessage.state === 'pending') {
          this.store.update('events', { ...event, teamMessage: { ...event.teamMessage, state: 'acknowledged' } });
        }
      }
      return { acknowledged: messageIds };
    });
  }
}
