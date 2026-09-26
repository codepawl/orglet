import type { Task, Team } from '../shared/contracts';
import type { RunProgressUpdate } from '../shared/progress';
import { waitsForPerson, type RunningItem, type RunWaitReason } from '../shared/running';
import { runStepLine } from './components/LiveRun';
import { providerName } from './components/workerModel';
import { formatMoney } from './components/money';
import { t } from './i18n';
import { chatHeadline } from '../shared/forward';

/** The Running view's sections, in the order they are read: working now, waiting in line, waiting for the person. */
export type RunningGroupId = 'running' | 'queued' | 'paused';

export type RunningGroup = { id: RunningGroupId; items: RunningItem[] };

/** Which controls a row offers. Every control acts on the row's chat, since a turn is paused, resumed or stopped whole. */
export type RunningControls = { pause: boolean; resume: boolean; stop: boolean };

/**
 * What a screen reader hears for the footer's Running button: how many turns are under way and how many wait for
 * the person, each only when there are any (COD-287).
 */
export function runningButtonLabel(running: number, waiting: number): string {
  if (running > 0 && waiting > 0) return t('Đang chạy, {0} lượt, {1} chờ bạn', [running, waiting]);
  if (running > 0) return t('Đang chạy, {0} lượt', [running]);
  if (waiting > 0) return t('Đang chạy, {0} chờ bạn', [waiting]);
  return t('Đang chạy');
}

/** A footer count never grows wider than three characters. */
export function footerCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Groups the core's list (already in order) into its sections, leaving out the empty ones. */
export function runningGroups(items: readonly RunningItem[]): RunningGroup[] {
  const order: RunningGroupId[] = ['running', 'queued', 'paused'];
  return order
    .map(id => ({ id, items: items.filter(item => groupOf(item) === id) }))
    .filter(group => group.items.length > 0);
}

/** A chat stopped at its budget goes on only after the person raises the limit, so it waits for them, not in line. */
function groupOf(item: RunningItem): RunningGroupId {
  if (item.state === 'running' || item.state === 'pausing') return 'running';
  if (waitsForPerson(item)) return 'paused';
  return 'queued';
}

/**
 * What a row may do. Pausing takes effect after the current step, so only a run that is working offers it; a chat
 * stopped at a checkpoint or at its budget offers resume; anything working or waiting in line can be stopped,
 * which for a queued run means it never starts.
 */
export function runningControls(item: RunningItem): RunningControls {
  if (item.state === 'running') return { pause: true, resume: false, stop: true };
  if (item.state === 'pausing') return { pause: false, resume: false, stop: true };
  // A chat waiting for an answer goes on when the person answers in the chat, so the row only opens it.
  if (item.wait?.kind === 'approval' || item.wait?.kind === 'answer') return { pause: false, resume: false, stop: false };
  if (item.state === 'paused') return { pause: false, resume: true, stop: false };
  if (item.wait?.kind === 'budget') return { pause: false, resume: true, stop: false };
  return { pause: false, resume: false, stop: true };
}

/** The chat a row belongs to: the crew's name for a crew chat, otherwise the chat's title or its first line. */
export function runningChatName(item: RunningItem, tasks: readonly Pick<Task, 'id' | 'title' | 'brief' | 'teamId' | 'teamSnapshot'>[], teams: readonly Pick<Team, 'id' | 'name'>[]): string {
  const task = tasks.find(candidate => candidate.id === item.taskId);
  if (!task) return '';
  if (task.teamId) {
    const team = teams.find(candidate => candidate.id === task.teamId);
    return team?.name ?? task.teamSnapshot?.name ?? '';
  }
  return task.title || chatHeadline(task);
}

/** The second line of a row: what a working run is doing, why a queued one waits, or why a chat is stopped. */
export function runningStatusLine(item: RunningItem, progress: RunProgressUpdate | undefined): string {
  if (item.state === 'running' || item.state === 'pausing') {
    return runStepLine({ progress: progress?.progress, stage: item.stage, message: item.lastEvent, pausing: item.state === 'pausing' });
  }
  if (item.state === 'paused' && item.wait) return waitLine(item.wait);
  if (item.state === 'paused') return item.pauseReason === 'shift' ? t('Tạm dừng vì hết giờ làm việc của hội') : t('Đã tạm dừng');
  return waitLine(item.wait ?? { kind: 'starting' });
}

/** Why a run waits, and where it stands in line when the line has an order. */
export function waitLine(wait: RunWaitReason): string {
  switch (wait.kind) {
    case 'provider': return wait.ahead ? t('Chờ {0} · còn {1} lượt trước', [providerName(wait.provider), wait.ahead]) : t('Chờ {0} · đến lượt kế tiếp', [providerName(wait.provider)]);
    case 'crew_slot': return wait.ahead ? t('Chờ lượt trong hội · còn {0} lượt trước', [wait.ahead]) : t('Chờ lượt trong hội · đến lượt kế tiếp');
    case 'group_turn': return wait.ahead ? t('Chờ đến lượt trả lời · còn {0} Tí trước', [wait.ahead]) : t('Chờ đến lượt trả lời · kế tiếp');
    case 'teammates': return t('Chờ kết quả của {0}', [wait.names.join(', ')]);
    case 'plan': return t('Chờ trưởng phòng phân việc');
    case 'members': return t('Chờ các thành viên xong để tổng hợp');
    case 'previous_turn': return t('Tin mới, chờ lượt đang chạy dừng');
    case 'budget': return t('Chờ ngân sách · nâng giới hạn rồi tiếp tục');
    case 'approval': return t('Chờ bạn cho phép công cụ MCP: {0} · {1}', [wait.tool, wait.server]);
    case 'answer': return t('Chờ bạn trả lời câu hỏi của Tí');
    case 'starting': return t('Đang bắt đầu…');
  }
}

/**
 * The quiet facts on the right of a row: how long it has run or waited, what it has cost so far, and its provider.
 * A cost that is not known says so instead of reading as nothing spent; a floor says "at least".
 */
export function runningMeta(item: RunningItem, now: number): { elapsed?: string; cost?: string; provider: string } {
  const provider = item.provider === 'demo' ? 'Demo' : providerName(item.provider);
  const elapsed = item.since !== undefined ? elapsedShort(now - item.since) : undefined;
  if (item.state !== 'running' && item.state !== 'pausing') return { elapsed, provider };
  return { elapsed, cost: costLabel(item.cost), provider };
}

function costLabel(cost: RunningItem['cost']): string | undefined {
  if (cost === undefined) return undefined;
  if (cost === null) return t('Chi phí chưa rõ');
  if (cost.atLeast) return t('Ít nhất {0}', [formatMoney(cost.micros)]);
  return formatMoney(cost.micros);
}

/** "42s", "3m 05s", "1h 12m": a clock that fits a narrow column and does not jump width every second. */
export function elapsedShort(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
