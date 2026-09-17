import type { Artifact, Run, Skill, Task, Team, Worker } from '../../shared/contracts';
import { Store, id, now } from '../storage/database';
import { Runner } from './runner';
import { Preflight, PreflightError } from './preflight';

export class TeamRunner {
  private active = new Map<string, { cancelled: boolean; paused: boolean; controller: AbortController }>();
  constructor(private store: Store, private runner: Runner, private notify: () => void, private preflight: Preflight, private canDispatch: (task: Task) => boolean = () => true) {}
  isActive(taskId: string) { return this.active.has(taskId); }
  cancel(taskId: string) { const control = this.active.get(taskId); if (control) { control.cancelled = true; control.controller.abort(); } this.runner.cancel(taskId); }
  pause(taskId: string) { const control = this.active.get(taskId); if (control) control.paused = true; this.runner.pause(taskId); }
  assertResumable(taskId: string) {
    const detail = this.store.detail(taskId);
    const latest = new Map(detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === (detail.task.inputRevision ?? 0)).map(run => [`${run.stage}:${run.snapshot.worker.id}`, run]));
    for (const run of latest.values()) if (run.status !== 'completed') this.runner.assertResumable(run);
  }
  async run(task: Task, team: Team, resume = false) {
    if (this.active.has(task.id)) throw new Error('Nhóm đang chạy task này.');
    const control = { cancelled: false, paused: false, controller: new AbortController() }; this.active.set(task.id, control);
    this.store.update('tasks', { ...task, status: 'running', accepted: false }); this.notify();
    task = { ...task, ...(task.currentInput ?? {}) };
    try {
      // Freeze every role before the first asynchronous step, including roles not dispatched yet.
      const prior = this.store.detail(task.id);
      prior.runs = prior.runs.filter(run => (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0));
      const planned = this.store.transaction(() => {
        const members = new Map(team.memberIds.map(workerId => {
          const saved = prior.runs.findLast(r => r.stage === 'member' && r.snapshot.worker.id === workerId && (resume || r.status === 'completed'));
          return [workerId, saved ?? this.createRun(task, team, workerId, 'member', [])];
        }));
        const synthesis = (resume && prior.runs.findLast(r => r.stage === 'synthesis')) || this.createRun(task, team, team.synthesizerId, 'synthesis', []);
        return { members, synthesis };
      });
      let preflightId: string | undefined;
      if (team.preflight) {
        this.store.event(planned.synthesis.id, 'Đang chạy preflight local trước khi bắt đầu các role.'); this.notify();
        const checked = await this.preflight.run(task, team.preflight, control.controller.signal, () => control.paused || !this.canDispatch(task));
        if (control.paused || checked.status === 'paused') { this.finish(task, 'paused'); return; }
        preflightId = checked.id;
        this.store.event(planned.synthesis.id, `Preflight: ${checked.status}. Xem phạm vi và giới hạn trong nguồn của công việc.`); this.notify();
      }
      const memberArtifacts: Artifact[] = [];
      const failures: string[] = [];
      const execute = async (workerId: string) => {
        if (!this.canDispatch(task)) control.paused = true;
        if (control.cancelled || control.paused) return;
        const existing = this.store.detail(task.id);
        const finished = existing.runs.findLast(r => (r.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0) && r.stage === 'member' && r.snapshot.worker.id === workerId && r.status === 'completed');
        const retained = finished && existing.artifacts.find(a => a.runId === finished.id);
        if (retained) { memberArtifacts.push(retained); return; }
        const run = this.join(planned.members.get(workerId)!, team.workflow === 'sequential' ? memberArtifacts : [], preflightId);
        await this.runner.run(task, run, { keepTaskOpen: true, upstream: team.workflow === 'sequential' ? [...memberArtifacts] : [] });
        const result = this.store.detail(task.id);
        if (result.runs.find(r => r.id === run.id)?.status === 'paused') control.paused = true;
        const artifact = result.artifacts.find(a => a.runId === run.id);
        if (artifact) memberArtifacts.push(artifact);
        else failures.push(`${run.snapshot.worker.name}: ${result.runs.find(r => r.id === run.id)?.error ?? 'chưa hoàn tất'}`);
      };
      if (team.workflow === 'parallel') {
        // At most two native executions at once. This is a fixed workflow, not a free-form swarm.
        for (let i = 0; i < team.memberIds.length && !control.cancelled && !control.paused; i += 2) await Promise.all(team.memberIds.slice(i, i + 2).map(execute));
      } else for (const workerId of team.memberIds) { if (control.cancelled || control.paused) break; await execute(workerId); }
      if (control.cancelled) { this.finish(task, 'cancelled'); return; }
      if (control.paused) { this.finish(task, 'paused'); return; }
      if (!memberArtifacts.length) { this.finish(task, 'failed'); return; }
      // Freeze a deterministic join input from committed member artifacts only.
      memberArtifacts.sort((a, b) => a.id.localeCompare(b.id));
      const synthesis = this.join(planned.synthesis, memberArtifacts, preflightId);
      await this.runner.run(task, synthesis, { keepTaskOpen: true, upstream: memberArtifacts, limitations: failures.map(failure => `Role chưa hoàn tất: ${failure}`) });
      const result = this.store.get<Run>('runs', synthesis.id);
      this.finish(task, control.cancelled ? 'cancelled' : result.status === 'paused' ? 'paused' : result.status === 'completed' ? failures.length ? 'partial' : 'completed' : 'partial');
    } catch (error) {
      const last = this.store.detail(task.id).runs.at(-1);
      if (last && last.status !== 'completed') this.store.update('runs', { ...last, error: error instanceof PreflightError ? error.message : 'Nhóm bị gián đoạn. Kiểm tra nguồn, checkpoint và chi phí trước khi tiếp tục.' });
      this.finish(task, control.cancelled ? 'cancelled' : error instanceof PreflightError ? 'failed' : 'interrupted');
    } finally { this.active.delete(task.id); this.notify(); }
  }
  /**
   * Group chat: every assigned worker answers the latest message in order, each seeing the replies before it. Workers
   * that already answered this message are skipped, so resume and retry only run the rest.
   */
  async chat(task: Task, workers: Worker[], resume = false) {
    if (this.active.has(task.id)) throw new Error('Nhóm đang chạy task này.');
    if (!workers.length) throw new Error('Chưa có nhân viên để giao việc.');
    const control = { cancelled: false, paused: false, controller: new AbortController() }; this.active.set(task.id, control);
    this.store.update('tasks', { ...task, status: 'running', accepted: false }); this.notify();
    task = { ...task, ...(task.currentInput ?? {}) };
    const revision = task.inputRevision ?? 0;
    let answered = 0, failed = 0;
    try {
      for (const worker of workers) {
        if (!this.canDispatch(task)) control.paused = true;
        if (control.cancelled || control.paused) break;
        const detail = this.store.detail(task.id);
        const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision && run.stage === 'group' && run.snapshot.worker.id === worker.id);
        if (runs.some(run => run.status === 'completed' && detail.artifacts.some(artifact => artifact.runId === run.id))) { answered++; continue; }
        let run = resume ? runs.findLast(item => ['paused', 'interrupted', 'waiting_budget', 'queued'].includes(item.status)) : undefined;
        if (!run) {
          run = { id: id(), taskId: task.id, stage: 'group', status: 'queued', snapshot: { worker, skill: this.store.get<Skill>('skills', worker.skillId), inputRevision: revision, input: { brief: task.brief, sourceIds: [...task.sourceIds], excludedSources: task.excludedSources } }, startedAt: now(), error: null };
          this.store.put('runs', run, { column: 'task_id', value: task.id });
        }
        await this.runner.run(task, run, { keepTaskOpen: true });
        const status = this.store.get<Run>('runs', run.id).status;
        if (status === 'paused' || status === 'waiting_budget') control.paused = true;
        else if (status === 'completed') answered++;
        else if (status !== 'cancelled') failed++;
      }
      this.finish(task, control.cancelled ? 'cancelled' : control.paused ? 'paused' : !answered ? 'failed' : failed ? 'partial' : 'completed');
    } catch {
      this.finish(task, control.cancelled ? 'cancelled' : 'interrupted');
    } finally { this.active.delete(task.id); this.notify(); }
  }
  private createRun(task: Task, team: Team, workerId: string, stage: 'member' | 'synthesis', upstream: Artifact[]) {
    const worker = this.store.get<Worker>('workers', workerId);
    const skill = this.store.get<Skill>('skills', worker.skillId);
    const run: Run = { id: id(), taskId: task.id, stage, status: 'queued', snapshot: { worker, skill, team, inputRevision: task.inputRevision ?? 0, input: { brief: task.brief, sourceIds: [...task.sourceIds], excludedSources: task.excludedSources }, upstreamArtifactIds: upstream.map(a => a.id) }, startedAt: now(), error: null };
    this.store.put('runs', run, { column: 'task_id', value: task.id });
    this.store.event(run.id, stage === 'synthesis' ? `Đang tổng hợp ${upstream.length} kết quả đã lưu.` : `Bắt đầu role ${worker.name}.`);
    return run;
  }
  private join(run: Run, upstream: Artifact[], preflightId?: string) {
    const ids = upstream.map(artifact => artifact.id);
    const dispatched = this.store.db.prepare('SELECT COUNT(*) AS count FROM reservations WHERE run_id=?').get(run.id)!.count;
    if (dispatched && (JSON.stringify(run.snapshot.upstreamArtifactIds ?? []) !== JSON.stringify(ids) || run.snapshot.preflightId !== preflightId)) throw new Error('Join input đã thay đổi; cần tạo lần chạy mới.');
    const prepared = { ...run, snapshot: { ...run.snapshot, upstreamArtifactIds: ids, ...(preflightId ? { preflightId } : {}) } };
    this.store.update('runs', prepared); return prepared;
  }
  private finish(task: Task, status: Task['status']) {
    this.store.transaction(() => {
      const detail = this.store.detail(task.id);
      const final = detail.artifacts.findLast(artifact => detail.runs.some(run => run.id === artifact.runId && run.stage === 'synthesis' && (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0)));
      if (['completed', 'partial'].includes(status) && final?.report.review?.checks.some(check => check.status === 'not_assessed')) status = 'waiting_input';
      for (const run of this.store.detail(task.id).runs) if (run.status === 'queued') this.store.update('runs', { ...run, status: status === 'paused' ? 'paused' : status === 'cancelled' ? 'cancelled' : 'interrupted' });
      this.store.update('tasks', { ...this.store.get<Task>('tasks', task.id), status });
    });
    this.notify();
  }
}
