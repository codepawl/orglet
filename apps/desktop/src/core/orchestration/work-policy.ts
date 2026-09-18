import type { Task, Team } from '../../shared/contracts';
import { inWorkHours } from '../../shared/schedule';
import { Store } from '../storage/database';

export class WorkPolicy {
  constructor(private store: Store, private clock: () => Date) {}
  allowed(task: Task) {
    if (!task.teamId) return true;
    const team = this.store.get<Team>('teams', task.teamId);
    if (inWorkHours(team.workHours, this.clock())) return true;
    const current = this.store.get<Task>('tasks', task.id);
    if (current.pauseReason !== 'shift') this.store.update('tasks', { ...current, pauseReason: 'shift', handoff: undefined });
    return false;
  }
  assertStart(teamId?: string, taskId?: string) {
    if (!teamId) return;
    const team = this.store.get<Team>('teams', teamId);
    if (!inWorkHours(team.workHours, this.clock())) throw new Error('Nhóm đang ngoài khung giờ làm việc. Tiếp tục trong ca hoặc sửa khung giờ của nhóm.');
    const active = this.store.all<Task>('tasks').filter(task => task.teamId === teamId && task.id !== taskId && ['queued', 'running', 'pausing'].includes(task.status));
    if (active.length >= (team.maxConcurrentTasks ?? 4)) throw new Error('Nhóm đã chạm giới hạn công việc chạy đồng thời.');
  }
  captureHandoffs() {
    for (const task of this.store.all<Task>('tasks')) {
      if (task.pauseReason !== 'shift' || task.handoff || ['queued', 'running', 'pausing'].includes(task.status)) continue;
      const detail = this.store.detail(task.id); const complete = task.status === 'completed';
      const latest = new Map(detail.runs.map(run => [`${run.stage ?? 'worker'}:${run.snapshot.worker.id}`, run]));
      const blockers = [...latest.values()].filter(run => run.status !== 'completed' && run.error)
        .map(run => `${run.snapshot.worker.name}${run.stage === 'plan' ? ' (phân việc)' : run.stage === 'synthesis' ? ' (tổng hợp)' : ''}: ${run.error}`);
      this.store.update('tasks', {
        ...task,
        handoff: {
          createdAt: this.clock().toISOString(),
          artifactIds: detail.artifacts.map(artifact => artifact.id),
          blockers: complete ? [] : ['Đã hết khung giờ làm việc.', ...blockers],
          nextSteps: complete ? ['Đối chiếu báo cáo với nguồn trước khi sử dụng.'] : [
            'Mở task trong ca tiếp theo, kiểm tra nguồn và ngân sách rồi tiếp tục từ checkpoint.',
            'Nếu request chưa rõ kết quả, kiểm tra reservation trước khi tạo lần thử mới.',
          ],
          chargedMicros: detail.usage.chargedMicros,
          reservedMicros: detail.usage.reservedMicros,
          uncertainCount: detail.usage.uncertainCount,
        },
      });
    }
  }
}
