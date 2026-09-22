import type { Run, Task } from '../../shared/contracts';
import { ReassignTeamWork, TeamReassignment } from '../../shared/team-messages';
import { snapshotCapabilities } from '../../shared/tool-policy';
import { Store, id, now } from '../storage/database';
import { assignmentKey } from './assignments';
import { WorkspaceGrants } from '../storage/workspace-grants';

/** Lead decisions create bounded member attempts, never new workers or broader grants. */
export class TeamRecovery {
  constructor(private store: Store) {}

  prepare(lead: Run, callId: string, raw: unknown): Run {
    const input = ReassignTeamWork.parse(raw);
    return this.store.transaction(() => {
      const current = this.store.get<Run>('runs', lead.id);
      const task = this.store.get<Task>('tasks', current.taskId);
      const team = current.snapshot.team;
      const revision = current.snapshot.inputRevision ?? 0;
      if (lead.taskId !== task.id || current.stage !== 'synthesis' || current.status !== 'running'
        || !team || team.synthesizerId !== current.snapshot.worker.id || task.teamId !== team.id
        || (task.inputRevision ?? 0) !== revision || task.status !== 'running') {
        throw new Error('Chỉ trưởng nhóm đang điều phối lượt này được giao lại việc.');
      }
      const detail = this.store.detail(task.id);
      const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.team?.id === team.id);
      const previous = runs.find(run => run.snapshot.reassignment?.decisionRunId === current.id && run.snapshot.reassignment.callId === callId);
      if (previous) {
        const saved = previous.snapshot.reassignment!;
        if (saved.assignmentWorkerId !== input.assignmentWorkerId || saved.newWorkerId !== input.newWorkerId || saved.reason !== input.reason) {
          throw new Error('Tool call đã lưu có nội dung khác.');
        }
        return previous;
      }
      const plan = runs.findLast(run => run.stage === 'plan' && run.status === 'completed')?.snapshot.plan;
      const assignment = plan?.assignments.find(item => item.workerId === input.assignmentWorkerId);
      const source = runs.findLast(run => run.stage === 'member' && assignmentKey(run) === input.assignmentWorkerId);
      // A retried turn keeps its input revision, so its first, cancelled attempt is still in this list; the latest
      // attempt is the one that carries what the chat allows now (COD-188).
      const recipient = runs.findLast(run => run.stage === 'member' && !run.snapshot.reassignment && run.snapshot.worker.id === input.newWorkerId);
      if (!assignment || !source || !recipient || !team.memberIds.includes(input.newWorkerId)
        || !['failed', 'interrupted', 'cancelled'].includes(source.status)
        || runs.some(run => run.stage === 'member' && assignmentKey(run) === input.assignmentWorkerId && run.status === 'completed')) {
        throw new Error('Chỉ giao lại phần việc chưa hoàn tất cho thành viên đã có trong lượt.');
      }
      if (runs.filter(run => run.snapshot.reassignment?.assignmentWorkerId === input.assignmentWorkerId).length >= 2) {
        throw new Error('Đã hết hai lần giao lại phần việc. Cần người dùng xử lý blocker.');
      }
      const originalCapabilities = source.snapshot.toolCapabilities ?? snapshotCapabilities(source.snapshot.worker.provider);
      const recipientCapabilities = recipient.snapshot.toolCapabilities ?? snapshotCapabilities(recipient.snapshot.worker.provider);
      const originalGrant = source.snapshot.workspaceGrant;
      // A run fixes its grant when it first starts (COD-178); one that has not started yet goes by the chat's current grant.
      const recipientGrant = recipient.snapshot.context ? recipient.snapshot.workspaceGrant : new WorkspaceGrants(this.store).snapshot(task.id);
      const workspaceGrant = originalGrant && recipientGrant && originalGrant.id === recipientGrant.id
        && originalGrant.revision === recipientGrant.revision && originalGrant.taskId === recipientGrant.taskId
        ? { ...originalGrant, permissions: originalGrant.permissions.filter(permission => recipientGrant.permissions.includes(permission)) } : undefined;
      const run: Run = {
        id: id(), taskId: task.id, stage: 'member', status: 'queued', startedAt: now(), error: null,
        snapshot: {
          ...recipient.snapshot, team, input: source.snapshot.input, inputRevision: revision, upstreamArtifactIds: [],
          workspaceGrant, assignment, toolCapabilities: originalCapabilities.filter(capability => recipientCapabilities.includes(capability)),
          reassignment: TeamReassignment.parse({ ...input, sourceRunId: source.id, decisionRunId: current.id, callId }),
        },
      };
      this.store.put('runs', run, { column: 'task_id', value: task.id });
      this.store.event(current.id, `Đã giao lại phần việc cho ${run.snapshot.worker.name}: ${input.reason}`);
      return run;
    });
  }
}
