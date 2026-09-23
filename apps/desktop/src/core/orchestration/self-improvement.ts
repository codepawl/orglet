import type { Artifact, Run, Task } from '../../shared/contracts';
import type { AppProposal } from '../../shared/app-proposals';
import {
  DECLINED_IMPROVEMENTS_SETTING, DeclinedImprovements, IMPROVEMENT_THRESHOLD, IMPROVEMENT_WINDOW_RUNS, improvementNote, improvementSignalKinds,
  type ImprovementCause, type ImprovementExample, type ImprovementSignal, type ImprovementSignalKind,
} from '../../shared/self-improvement';
import { detectUsageLimit } from '../usageLimits';
import type { Store } from '../storage/database';

/**
 * Finding the feedback a worker keeps getting (COD-162), as a pure function over stored rows so it can be tested
 * without a run. The rows are what the app already keeps: runs and their answers, a chat's reactions, a run's error.
 * Nothing here reads a model's words as a signal; only what the person did or what a core gate refused counts.
 */
export type ImprovementRows = {
  workerId: string;
  /** Every run in the store, any worker; the detector picks this worker's latest ones itself. */
  runs: readonly Run[];
  tasks: readonly Task[];
  artifacts: readonly Artifact[];
  /** Chat names the person or the first answer gave, keyed by task id (the `taskTitles` setting). */
  titles: Readonly<Record<string, string>>;
  /** Self-improvement proposals already made for this worker, whatever became of them. */
  earlier: readonly AppProposal[];
  declined: readonly ImprovementSignalKind[];
  windowRuns?: number;
  threshold?: number;
};

type Hit = { taskId: string; note: string };

const EXAMPLE_LIMIT = 5;
const TITLE_LIMIT = 48;

/** The chat's name as the sidebar shows it: the saved title, else the first line of its first message, shortened. */
export function chatTitle(task: Pick<Task, 'brief'>, saved: string | undefined): string {
  if (saved) return saved.slice(0, 120);
  const line = task.brief.trim().split('\n')[0].replace(/\s+/g, ' ');
  if (line.length <= TITLE_LIMIT) return line;
  return `${line.slice(0, TITLE_LIMIT).replace(/\s+\S*$/, '')}…`;
}

function isWorkerChatRun(run: Run, workerId: string): boolean {
  return run.snapshot.worker.id === workerId && run.stage !== 'plan';
}

/** A failure the worker could learn from is not one the machine, the plan or the person caused. */
function learnableFailure(run: Run): boolean {
  if (run.status !== 'failed' || !run.error) return false;
  if (run.errorCode === 'unresolved_attempt' || run.errorCode === 'report_rejected') return false;
  if (detectUsageLimit(run.error)) return false;
  return true;
}

function causesOf(hits: readonly Hit[], tasks: ReadonlyMap<string, Task>, titles: Readonly<Record<string, string>>): ImprovementCause[] {
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.taskId, (counts.get(hit.taskId) ?? 0) + 1);
  return [...counts.entries()].map(([taskId, count]) => ({ taskId, title: chatTitle(tasks.get(taskId)!, titles[taskId]), count }));
}

function examplesOf(hits: readonly Hit[]): ImprovementExample[] {
  return hits.slice(0, EXAMPLE_LIMIT).map(hit => ({ taskId: hit.taskId, note: improvementNote(hit.note) }));
}

/**
 * The signals that met the threshold for this worker, strongest first. Each kind is counted over the worker's last
 * `windowRuns` runs in chats that still exist, and only over runs started after the last self-improvement proposal
 * of that kind, so an applied change gets a fresh count. A declined kind is skipped, and nothing is offered while an
 * earlier self-improvement is still waiting for a click.
 */
export function detectImprovementSignals(rows: ImprovementRows): ImprovementSignal[] {
  const windowRuns = rows.windowRuns ?? IMPROVEMENT_WINDOW_RUNS;
  const threshold = rows.threshold ?? IMPROVEMENT_THRESHOLD;
  if (rows.earlier.some(proposal => proposal.status === 'pending')) return [];
  const tasks = new Map(rows.tasks.filter(task => !task.deletedAt).map(task => [task.id, task]));
  const window = rows.runs
    .filter(run => isWorkerChatRun(run, rows.workerId) && tasks.has(run.taskId))
    .sort((first, second) => second.startedAt.localeCompare(first.startedAt))
    .slice(0, windowRuns);
  const artifactsById = new Map(rows.artifacts.map(artifact => [artifact.id, artifact]));
  const runsById = new Map(rows.runs.map(run => [run.id, run]));
  const answeredByWorker = (artifactId: string | undefined) => {
    const artifact = artifactId ? artifactsById.get(artifactId) : undefined;
    const owner = artifact ? runsById.get(artifact.runId) : undefined;
    return artifact && owner && owner.snapshot.worker.id === rows.workerId ? artifact : undefined;
  };
  const since = (kind: ImprovementSignalKind) => rows.earlier
    .filter(proposal => proposal.improvement?.signal === kind)
    .reduce((latest, proposal) => proposal.createdAt > latest ? proposal.createdAt : latest, '');
  const recent = (kind: ImprovementSignalKind) => window.filter(run => run.startedAt > since(kind));

  const hitsFor: Record<ImprovementSignalKind, () => Hit[]> = {
    // The person replied to this worker's answer with a new request: a revision asked for on that answer.
    revision: () => recent('revision').flatMap(run => {
      const answered = answeredByWorker(run.snapshot.input?.replyTo);
      const brief = run.snapshot.input?.brief;
      return answered && brief ? [{ taskId: run.taskId, note: `Asked again: "${brief}"` }] : [];
    }),
    // A thumbs-down the person put on one of this worker's answers in the window.
    thumbs_down: () => {
      const runs = recent('thumbs_down');
      const recentIds = new Set(runs.map(run => run.id));
      return [...tasks.values()].flatMap(task => (task.messageReactions ?? [])
        .filter(reaction => reaction.actor === 'user' && reaction.emoji === 'against')
        .flatMap(reaction => {
          const artifact = answeredByWorker(reaction.messageId);
          return artifact && recentIds.has(artifact.runId) ? [{ taskId: task.id, note: `Thumbs-down on: "${artifact.report.summary}"` }] : [];
        }));
    },
    // A report the citation, checker, line-range or process gate refused.
    report_rejected: () => recent('report_rejected')
      .filter(run => run.status === 'failed' && run.errorCode === 'report_rejected')
      .map(run => ({ taskId: run.taskId, note: `Report refused: ${run.error ?? ''}` })),
    // The same failure again: identical error text on two runs, leaving out what the worker cannot change.
    run_failed: () => {
      const failed = recent('run_failed').filter(learnableFailure);
      const byError = new Map<string, Run[]>();
      for (const run of failed) {
        const key = run.error!.trim();
        byError.set(key, [...(byError.get(key) ?? []), run]);
      }
      return [...byError.values()].filter(group => group.length >= threshold)
        .flatMap(group => group.map(run => ({ taskId: run.taskId, note: `Failed: ${run.error}` })));
    },
  };

  const signals: ImprovementSignal[] = [];
  for (const kind of improvementSignalKinds) {
    if (rows.declined.includes(kind)) continue;
    const hits = hitsFor[kind]().filter(hit => tasks.has(hit.taskId));
    if (hits.length < threshold) continue;
    signals.push({ kind, count: hits.length, because: causesOf(hits, tasks, rows.titles), examples: examplesOf(hits) });
  }
  return signals.sort((first, second) => second.count - first.count);
}

/** The rows the detector needs, read from the store, and the declined kinds the person's Dismiss clicks left behind. */
export class SelfImprovement {
  constructor(private store: Store) {}

  signalsFor(workerId: string, currentRunId?: string): ImprovementSignal[] {
    const earlier = this.store.db.prepare('SELECT data FROM app_proposals ORDER BY rowid').all()
      .map(row => JSON.parse(String(row.data)) as AppProposal)
      .filter(proposal => proposal.improvement && (proposal.payload as { targetId?: string }).targetId === workerId);
    return detectImprovementSignals({
      workerId,
      runs: this.store.all<Run>('runs').filter(run => run.id !== currentRunId),
      tasks: this.store.all<Task>('tasks'),
      artifacts: this.store.all<Artifact>('artifacts'),
      titles: this.store.setting<Record<string, string>>('taskTitles', {}),
      earlier,
      declined: this.declined()[workerId] ?? [],
    });
  }

  declined(): DeclinedImprovements {
    return DeclinedImprovements.parse(this.store.setting<DeclinedImprovements>(DECLINED_IMPROVEMENTS_SETTING, {}));
  }

  /** Dismissing a self-improvement declines its kind for that worker: it is never asked again for that reason. */
  decline(workerId: string, kind: ImprovementSignalKind) {
    const current = this.declined();
    const kinds = new Set([...(current[workerId] ?? []), kind]);
    this.store.setSetting(DECLINED_IMPROVEMENTS_SETTING, { ...current, [workerId]: [...kinds] });
  }
}
