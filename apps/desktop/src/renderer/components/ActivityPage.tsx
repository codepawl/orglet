import { BookOpen, CalendarClock, Bookmark, BookmarkX, Sparkles } from 'lucide-react';
import type { Task, Team } from '../../shared/contracts';
import { waitsForPerson, type RunningItem } from '../../shared/running';
import { t } from '../i18n';
import type { ActivityTab } from '../areas';
import { unsaveMessage, type SavedMessage } from '../saved';
import { Button } from './ui';
import { PanelPage } from './PanelPage';
import { NoticeList } from './NoticeCentre';
import { RunningGroups } from './RunningCentre';
import { clockLabel, dayLabel } from './TimeMark';

/** What Activity counts under each of its views, so the tabs and the sidebar read the same numbers. */
export function activityCounts(running: readonly RunningItem[], saved: readonly SavedMessage[], waitingElsewhere: number): Record<ActivityTab, number> {
  const needs = running.filter(waitsForPerson).length + waitingElsewhere;
  return { needs, running: running.length - running.filter(waitsForPerson).length, done: 0, saved: saved.length };
}

export function activityTabLabel(tab: ActivityTab): string {
  if (tab === 'needs') return t('Cần bạn');
  if (tab === 'running') return t('Đang chạy');
  if (tab === 'done') return t('Xong');
  return t('Đã lưu');
}

/**
 * The Activity area's main page (COD-366): everything that wants the person, in the four views Slack's Activity and
 * Saved have between them. Needs you: runs stopped for an answer or an approval, schedules that did not run and notes
 * to review. Running: what works or waits in line. Done: what the app told you after its toast was gone. Saved: the
 * messages saved for later with "Lưu để xem sau".
 */
export function ActivityPage({ tab, running, tasks, teams, saved, pendingSchedules, notesToReview, onOpenChat, onOpenMessage, chatExists, onOpenSchedules, onOpenLibrary, onOpenArchive, updateReady, onRestartUpdate, tacetOutdated, onUpdateTacet }: {
  /** The part of Activity on screen, chosen in the sidebar. */
  tab: ActivityTab;
  running: readonly RunningItem[];
  tasks: readonly Task[];
  teams: readonly Team[];
  saved: readonly SavedMessage[];
  pendingSchedules: number;
  notesToReview: number;
  onOpenChat: (taskId: string) => void;
  onOpenMessage: (taskId: string, messageId: string) => void;
  chatExists: (taskId: string) => boolean;
  onOpenSchedules: () => void;
  onOpenLibrary: () => void;
  onOpenArchive: () => void;
  updateReady: boolean;
  onRestartUpdate: () => void;
  /** A newer Tacet is pinned than the one on disk (2026-10-07): Needs you offers the update until it is done. */
  tacetOutdated: boolean;
  onUpdateTacet: () => void;
}) {
  const waiting = running.filter(waitsForPerson);
  const working = running.filter(item => !waitsForPerson(item));
  return <PanelPage className="activity-page">
      {tab === 'needs' && <>
        {pendingSchedules > 0 && <ActivityLink icon={<CalendarClock size={16} />} text={t('{0} lịch cần bạn xem', [pendingSchedules])} action={t('Mở lịch chạy')} onClick={onOpenSchedules} />}
        {notesToReview > 0 && <ActivityLink icon={<BookOpen size={16} />} text={t('{0} ghi chú đang chờ duyệt', [notesToReview])} action={t('Mở thư viện')} onClick={onOpenLibrary} />}
        {tacetOutdated && <ActivityLink icon={<Sparkles size={16} />} text={t('Có bản Tacet mới. Tacet tạm nghỉ đến khi cập nhật.')} action={t('Cập nhật')} onClick={onUpdateTacet} />}
        <RunningGroups items={waiting} tasks={tasks} teams={teams} onOpenChat={onOpenChat} emptyLine={pendingSchedules + notesToReview > 0 || tacetOutdated ? undefined : t('Không có gì đang chờ bạn.')} />
      </>}
      {tab === 'running' && <RunningGroups items={working} tasks={tasks} teams={teams} onOpenChat={onOpenChat} emptyLine={t('Không có gì đang chạy.')} />}
      {tab === 'done' && <NoticeList open onOpenChat={onOpenChat} chatExists={chatExists} updateReady={updateReady} onRestartUpdate={onRestartUpdate} onOpenArchive={onOpenArchive} tacetOutdated={tacetOutdated} onUpdateTacet={onUpdateTacet} />}
      {tab === 'saved' && <SavedList saved={saved} chatExists={chatExists} onOpen={onOpenMessage} />}
  </PanelPage>;
}

function ActivityLink({ icon, text, action, onClick }: { icon: React.ReactNode; text: string; action: string; onClick: () => void }) {
  return <p className="activity-link">{icon}<span>{text}</span><Button variant="outline" onClick={onClick}>{action}</Button></p>;
}

function SavedList({ saved, chatExists, onOpen }: { saved: readonly SavedMessage[]; chatExists: (taskId: string) => boolean; onOpen: (taskId: string, messageId: string) => void }) {
  if (saved.length === 0) return <p className="muted saved-empty"><Bookmark size={16} aria-hidden="true" />{t('Chưa lưu tin nào. Dùng Lưu để xem sau dưới một tin nhắn.')}</p>;
  return <ul className="saved-list">
    {saved.map(item => {
      const opens = chatExists(item.taskId);
      const body = <>
        <span className="saved-head"><span className="saved-author">{item.author}</span><time dateTime={item.savedAt}>{dayLabel(item.savedAt)}, {clockLabel(item.savedAt)}</time></span>
        <span className="saved-text">{item.text}</span>
      </>;
      return <li key={`${item.taskId}:${item.messageId}`} className="saved-row">
        {opens
          ? <button type="button" className="saved-body" title={t('Mở tin nhắn')} onClick={() => onOpen(item.taskId, item.messageId)}>{body}</button>
          : <div className="saved-body">{body}</div>}
        <Button size="icon" aria-label={t('Bỏ lưu tin này')} title={t('Bỏ lưu')} onClick={() => unsaveMessage(item.taskId, item.messageId)}><BookmarkX size={16} /></Button>
      </li>;
    })}
  </ul>;
}
