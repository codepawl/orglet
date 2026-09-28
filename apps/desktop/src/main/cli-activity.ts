import { CliActivity, type CliProgressFrame } from '../cli/protocol';
import type { TaskDetail } from '../shared/contracts';
import type { RunProgressUpdate } from '../shared/progress';
import { RunActivity } from '../shared/run-activity';
import { defaultAvatarColor } from '../shared/mascot-suggest';

export type CliObservation = { activity: RunActivity } | { progress: RunProgressUpdate };
export type CliObserver = (observation: CliObservation) => void;
type NativeTiming = { startedAt: string; updatedAt: string; finished: boolean };
type RetainedNative = { observation: CliObservation; observedAt: string; timings: Map<string, NativeTiming> };

/** One authenticated wait owns this bounded, transient projection. It never reads checkpoints or tool output. */
export class CliActivityFeed {
  private readonly steps = new Map<string, CliActivity>();
  private readonly pending: CliObservation[] = [];
  private readonly pendingNative = new Map<string, RetainedNative>();
  private readonly retired = new Set<string>();
  private detail?: TaskDetail;
  private revision = 0;
  private omitted = 0;
  private lastFrame = '';
  private taskId?: string;

  constructor(private readonly emit: (frame: CliProgressFrame) => void, private readonly translate: (message: string) => string = message => message) {}

  bind(taskId: string): void {
    this.taskId = taskId;
  }

  observe(observation: CliObservation, observedAt = new Date().toISOString(), nativeTimings?: ReadonlyMap<string, NativeTiming>): void {
    const taskId = 'activity' in observation ? observation.activity.taskId : observation.progress.taskId;
    if (this.taskId && taskId !== this.taskId) return;
    if (!this.detail) {
      // Before createTask returns an ID, retain only bounded lifecycle metadata, never another chat's text.
      if ('activity' in observation && this.pending.length < 1000) this.pending.push(observation);
      else this.retainNative(observation, observedAt, nativeTimings);
      return;
    }
    const runId = 'activity' in observation ? observation.activity.runId : observation.progress.runId;
    const run = this.detail.runs.find(candidate => candidate.id === runId);
    if (!run) {
      if ('activity' in observation && this.pending.length < 1000) this.pending.push(observation);
      else this.retainNative(observation, observedAt, nativeTimings);
      return;
    }
    if ((run.snapshot.inputRevision ?? 0) !== this.revision) return;
    if ('activity' in observation) {
      const parsed = RunActivity.safeParse(observation.activity);
      if (!parsed.success) return;
      this.put({ ...parsed.data, name: run.snapshot.worker.name, color: defaultAvatarColor(run.snapshot.worker) });
    } else {
      const update = observation.progress.progress;
      if (!update) return;
      const model = [...this.steps.values()].find(step => step.runId === runId && step.kind === 'model' && step.state === 'running');
      if (model) {
        // Only Codex's explicit reasoning summaries are public; tool-loop notes and Claude thinking are excluded.
        const summary = run.snapshot.worker.provider === 'codex' ? update.thinking.slice(-4000) : undefined;
        this.put({ ...model, label: update.writing ? 'writing' : summary ? 'thinking' : model.label,
          ...(summary ? { detail: summary } : {}), updatedAt: observedAt });
      }
      for (const activity of update.activity) {
        const key = `${runId}:native:${observation.progress.startedAt}:${activity.id}`;
        const previous = this.steps.get(key);
        const timing = nativeTimings?.get(activity.id);
        this.put({ id: `native:${observation.progress.startedAt}:${activity.id}`, runId, taskId, kind: 'tool', state: activity.failed ? 'failed' : activity.done ? 'completed' : 'running',
          label: activity.kind, detail: activity.target.slice(0, 4000), name: run.snapshot.worker.name,
          color: defaultAvatarColor(run.snapshot.worker), startedAt: previous?.startedAt ?? timing?.startedAt ?? observedAt,
          updatedAt: previous && previous.state !== 'running' ? previous.updatedAt : timing?.updatedAt ?? observedAt });
      }
    }
    this.flush();
  }

  update(detail: TaskDetail, revision: number): void {
    this.bind(detail.task.id);
    this.detail = detail;
    this.revision = revision;
    const pending = this.pending.splice(0);
    for (const observation of pending) this.observe(observation);
    const native = [...this.pendingNative.values()];
    this.pendingNative.clear();
    for (const retained of native) this.observe(retained.observation, retained.observedAt, retained.timings);
    for (const event of detail.events ?? []) {
      const run = detail.runs.find(candidate => candidate.id === event.runId && (candidate.snapshot.inputRevision ?? 0) === revision);
      if (!run || !/^Đã đọc /u.test(event.message)) continue;
      const observedRead = [...this.steps.values()].some(step => step.runId === run.id && ['workspace_read', 'read'].includes(step.label));
      if (observedRead) continue;
      this.put({ id: `event:${event.id}`, runId: run.id, taskId: detail.task.id, kind: 'note', state: 'completed', label: this.translate(event.message).slice(0, 300),
        startedAt: event.createdAt, updatedAt: event.createdAt, name: run.snapshot.worker.name, color: defaultAvatarColor(run.snapshot.worker) });
    }
    for (const step of this.steps.values()) {
      if (step.state !== 'running') continue;
      const run = detail.runs.find(candidate => candidate.id === step.runId);
      if (!run || ['queued', 'running', 'pausing'].includes(run.status)) continue;
      const state = run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'stopped'
        : ['waiting_input', 'waiting_budget', 'paused'].includes(run.status) ? 'waiting' : 'unknown';
      this.put({ ...step, state, updatedAt: new Date().toISOString() });
    }
    this.flush();
  }

  private retainNative(observation: CliObservation, observedAt: string, nativeTimings?: ReadonlyMap<string, NativeTiming>): void {
    if ('activity' in observation || !observation.progress.progress || observation.progress.taskId !== this.taskId) return;
    const update = observation.progress;
    const key = `${update.runId}:${update.startedAt}`;
    if (!this.pendingNative.has(key) && this.pendingNative.size >= 16) return;
    const previous = this.pendingNative.get(key);
    const timings = new Map<string, NativeTiming>();
    const activity = update.progress!.activity.slice(-500).map(step => {
      const timing = previous?.timings.get(step.id) ?? nativeTimings?.get(step.id);
      timings.set(step.id, { startedAt: timing?.startedAt ?? observedAt,
        updatedAt: timing?.finished ? timing.updatedAt : observedAt, finished: Boolean(timing?.finished || step.done || step.failed) });
      return { ...step, target: step.target.slice(0, 256) };
    });
    // Native steps are cumulative. Keep one bounded snapshot until its run metadata arrives, with no text fields.
    this.pendingNative.set(key, { observedAt, timings, observation: { progress: { ...update, progress: {
      thinking: '', preamble: '', answer: '', writing: update.progress!.writing,
      activity,
    } } } });
  }

  private put(step: CliActivity): void {
    const parsed = CliActivity.safeParse(step);
    if (!parsed.success) return;
    const key = `${step.runId}:${step.id}`;
    if (this.retired.has(key)) return;
    const previous = this.steps.get(key);
    if (previous && previous.state !== 'running' && step.state === 'running') return;
    if (!previous && this.steps.size >= 500) {
      const oldest = [...this.steps.entries()].find(([, candidate]) => candidate.state !== 'running');
      if (!oldest) return;
      this.steps.delete(oldest[0]);
      this.retired.add(oldest[0]);
      this.omitted += 1;
    }
    this.steps.set(key, previous ? { ...parsed.data, startedAt: previous.startedAt,
      ...(previous.detail && !parsed.data.detail ? { detail: previous.detail } : {}) } : parsed.data);
  }

  private flush(): void {
    if (!this.detail) return;
    let detailBudget = 100_000;
    const marker = '… details truncated';
    const steps = [...this.steps.values()].sort((first, second) => first.startedAt.localeCompare(second.startedAt)).map(step => {
      const retainedDetail = step.detail?.slice(0, Math.max(0, detailBudget));
      if (!step.detail || retainedDetail === step.detail) {
        detailBudget -= retainedDetail?.length ?? 0;
        return step;
      }
      const available = Math.max(0, Math.min(4000, detailBudget) - marker.length);
      const truncated = `${step.detail.slice(0, available)}${marker}`;
      detailBudget = Math.max(0, detailBudget - truncated.length);
      return { ...step, detail: truncated };
    });
    const frame: CliProgressFrame = { type: 'progress', taskId: this.detail.task.id, steps, omitted: this.omitted };
    const serialized = JSON.stringify(frame);
    if (serialized === this.lastFrame) return;
    this.lastFrame = serialized;
    this.emit(frame);
  }
}
