import { useEffect, useState } from 'react';
import { ArrowUpRight, Pause, Play, Square } from 'lucide-react';
import type { Task, Team } from '../../shared/contracts';
import type { RunningItem } from '../../shared/running';
import { Avatar } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { Button, Drawer } from './ui';
import { toast } from './toast';
import { orglet } from '../api';
import { t } from '../i18n';
import { useAllRunProgress } from '../runProgress';
import { runningChatName, runningControls, runningGroups, runningMeta, runningStatusLine, type RunningGroupId } from '../runningList';

const groupTitles: Record<RunningGroupId, () => string> = {
  running: () => t('Đang chạy'),
  queued: () => t('Đang chờ'),
  paused: () => t('Chờ bạn'),
};

/** The current time, refreshed every second while the view is open, so elapsed times tick. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Everything running across all chats, and the line waiting behind it (COD-244). Opened from the sidebar footer
 * beside Notifications and Schedules. The core sends the list with every workspace refresh, so it follows the
 * same `changed` events as the sidebar's status marks; the step each run is on comes from live progress.
 */
export function RunningCentre({ open, items, tasks, teams, onClose, onOpenChat }: {
  open: boolean;
  items: readonly RunningItem[];
  tasks: readonly Task[];
  teams: readonly Team[];
  onClose: () => void;
  onOpenChat: (taskId: string) => void;
}) {
  if (!open) return null;
  return <Drawer open onClose={onClose} title={t('Đang chạy')} description={t('Mọi lượt đang chạy hoặc đang chờ, ở mọi chat.')}>
    <RunningGroups items={items} tasks={tasks} teams={teams} onOpenChat={onOpenChat} />
  </Drawer>;
}

/** The sections, with one clock and one progress subscription shared by every row. */
function RunningGroups({ items, tasks, teams, onOpenChat }: { items: readonly RunningItem[]; tasks: readonly Task[]; teams: readonly Team[]; onOpenChat: (taskId: string) => void }) {
  const progressByRun = useAllRunProgress();
  const now = useNow();
  const groups = runningGroups(items);
  if (groups.length === 0) return <p className="muted running-empty">{t('Không có gì đang chạy.')}</p>;
  return <div className="running-groups">
    {groups.map(group => <section key={group.id} className="running-group" aria-labelledby={`running-group-${group.id}`}>
      <h3 id={`running-group-${group.id}`} className="running-group-title">{groupTitles[group.id]()}<span>{group.items.length}</span></h3>
      <ul className="running-list">
        {group.items.map(item => {
          const progress = item.runId ? progressByRun[item.runId] : undefined;
          return <RunningRow key={item.key} item={item} status={runningStatusLine(item, progress)} now={now} chatName={runningChatName(item, tasks, teams)} onOpenChat={onOpenChat} />;
        })}
      </ul>
    </section>)}
  </div>;
}

/**
 * One run: the orglet's face with its provider's mark and its name, the chat it works in, what it is doing now or
 * why it waits, how long, what it has cost so far, and the controls for its chat.
 */
function RunningRow({ item, status, now, chatName, onOpenChat }: { item: RunningItem; status: string; now: number; chatName: string; onOpenChat: (taskId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const controls = runningControls(item);
  const meta = runningMeta(item, now);
  const worker = item.worker;
  const act = async (send: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await send();
    } catch (error) {
      toast((error as Error).message, 'error', chatName);
    } finally {
      setBusy(false);
    }
  };
  return <li className={`running-row running-${item.state}`}>
    <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm"
      badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />
    <div className="running-text">
      <p className="running-title"><span className="running-name">{worker.name}</span>{chatName && <span className="running-chat">{chatName}</span>}</p>
      <p className="running-status">{status}</p>
    </div>
    <div className="running-meta">
      <span className="running-elapsed">{meta.elapsed ?? ''}</span>
      <span className="running-facts">{[meta.provider, meta.cost].filter(Boolean).join(' · ')}</span>
    </div>
    <div className="running-actions">
      {controls.pause && <Button size="icon" className="running-action" disabled={busy} aria-label={t('Tạm dừng {0} sau bước này', [chatName || worker.name])} title={t('Tạm dừng sau bước này')} onClick={() => void act(() => orglet.call('pause', { id: item.taskId }))}><Pause size={15} /></Button>}
      {controls.resume && <Button size="icon" className="running-action" disabled={busy} aria-label={t('Tiếp tục {0}', [chatName || worker.name])} title={t('Tiếp tục từ checkpoint')} onClick={() => void act(() => orglet.call('resume', { id: item.taskId }))}><Play size={15} /></Button>}
      {controls.stop && <Button size="icon" className="running-action" disabled={busy} aria-label={item.state === 'queued' ? t('Hủy {0} trước khi chạy', [chatName || worker.name]) : t('Dừng {0}', [chatName || worker.name])} title={item.state === 'queued' ? t('Hủy trước khi chạy') : t('Dừng')} onClick={() => void act(() => orglet.call('cancel', { id: item.taskId }))}><Square size={14} /></Button>}
      <Button size="icon" className="running-action" aria-label={t('Mở chat {0}', [chatName || worker.name])} title={t('Mở chat')} onClick={() => onOpenChat(item.taskId)}><ArrowUpRight size={16} /></Button>
    </div>
  </li>;
}
