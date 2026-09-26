import type { ReactNode } from 'react';
import { AppWindow, Ban, Blocks, BookOpen, Brain, Camera, ChevronRight, FileDiff, FileText, FolderInput, FolderPlus, FolderSearch, Globe, Hourglass, Keyboard, Lightbulb, ListChecks, MonitorSmartphone, MousePointerClick, MoveVertical, ScanSearch, Search, ShieldCheck, Table2, Terminal, TextCursorInput, Trash2, UserRound, Wrench, type LucideIcon } from 'lucide-react';
import { t, tMessage } from '../i18n';
import { traceSummary, type TraceEntry, type TraceKind } from '../turnTrace';

/**
 * What a worker did before its answer, behind one quiet control above the bubble (COD-220): collapsed, one line
 * counting each kind of thing that happened; open, the rows in the order they happened, each an icon and plain
 * words. A native disclosure, so it is reachable and announced without state of its own. `children` are shown
 * after the rows when open, for what a live run keeps out of the headline (the timer, the worker's notes); with no
 * rows and no children there is nothing to open and nothing is drawn. `onOpenMemories` adds one link under the rows
 * to the worker's Memory tab when the trace holds a memory.
 */
export function TurnTrace({ entries, onOpenMemories, children }: { entries: readonly TraceEntry[]; onOpenMemories?: () => void; children?: ReactNode }) {
  if (!entries.length && !children) return null;
  const usedMemory = entries.some(entry => entry.kind === 'memory');
  return <details className="turn-trace">
    <summary className="activity-summary">
      <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
      <span>{traceSummary(entries) || t('Chi tiết')}</span>
    </summary>
    <div className="trace-detail">
      {entries.length > 0 && <ol className="trace-list" aria-label={t('Các bước của Tí')}>
        {entries.map(entry => <TraceRow key={entry.id} entry={entry} />)}
      </ol>}
      {usedMemory && onOpenMemories && <button type="button" className="trace-link" onClick={onOpenMemories}>{t('Mở tab Ghi nhớ')}</button>}
      {children}
    </div>
  </details>;
}

const traceIcons: Record<TraceKind, LucideIcon> = {
  memory: Brain, knowledge: BookOpen, read: FileText, search: Search, list: FolderSearch, skill: BookOpen,
  web_search: Globe, web_read: Globe, dataset: Table2, edit: FileDiff, folder: FolderPlus, move: FolderInput, delete: Trash2, command: Terminal, handoff: UserRound,
  remembered: Brain, proposal: Lightbulb, failed: Ban, other: Wrench, mcp: Blocks,
  browser_open: AppWindow, browser_read: AppWindow, browser_find: ScanSearch, browser_screenshot: Camera, browser_scroll: MoveVertical,
  browser_click: MousePointerClick, browser_type: TextCursorInput, browser_select: ListChecks, browser_press: Keyboard, browser_wait: Hourglass, browser_asked: ShieldCheck,
  desktop_read: MonitorSmartphone, desktop_find: ScanSearch, desktop_screenshot: Camera, desktop_act: MousePointerClick, desktop_asked: ShieldCheck,
};

/** The row's verb, worded as what the worker did, never which tool it called (docs/worker-actions.md). */
function traceVerb(kind: TraceKind): string {
  switch (kind) {
    case 'memory': return t('Ghi nhớ');
    case 'knowledge': return t('Ghi chú');
    case 'read': return t('Đọc');
    case 'search': return t('Tìm');
    case 'list': return t('Liệt kê tệp');
    case 'skill': return t('Đọc tài nguyên skill');
    case 'web_search': return t('Tìm trên web');
    case 'web_read': return t('Đọc trang web');
    case 'dataset': return t('Đã kiểm tra dữ liệu');
    case 'edit': return t('Sửa tệp');
    case 'folder': return t('Đã tạo thư mục');
    case 'move': return t('Đã chuyển');
    case 'delete': return t('Đã xóa');
    case 'command': return t('Chạy lệnh');
    case 'mcp': return t('Dùng công cụ MCP');
    case 'browser_open': return t('Mở trang');
    case 'browser_read': return t('Đọc nội dung trang');
    case 'browser_find': return t('Tìm trên trang');
    case 'browser_screenshot': return t('Chụp màn hình');
    case 'browser_scroll': return t('Cuộn trang');
    case 'browser_click': return t('Bấm trên trang');
    case 'browser_type': return t('Gõ trên trang');
    case 'browser_select': return t('Chọn trên trang');
    case 'browser_press': return t('Nhấn phím trên trang');
    case 'browser_wait': return t('Chờ trang');
    case 'browser_asked': return t('Đã hỏi bạn');
    case 'desktop_read': return t('Đọc nội dung cửa sổ');
    case 'desktop_find': return t('Tìm trong cửa sổ');
    case 'desktop_screenshot': return t('Chụp cửa sổ');
    case 'desktop_act': return t('Thao tác trong ứng dụng');
    case 'desktop_asked': return t('Đã hỏi bạn');
    case 'handoff': return t('Giao việc cho');
    case 'remembered': return t('Ghi nhớ thêm');
    case 'proposal': return t('Đề xuất');
    case 'failed': return t('Không thành');
    case 'other': return t('Dùng công cụ');
  }
}

/** A memory's text and a note's title are prose that wraps; a file name or a pattern is a chip that truncates. */
const proseKinds: readonly TraceKind[] = ['memory', 'knowledge'];

function TraceRow({ entry }: { entry: TraceEntry }) {
  const Icon = traceIcons[entry.kind];
  const classes = ['trace-row', entry.kind === 'failed' ? 'trace-row-muted' : '', entry.running ? 'running' : ''].filter(Boolean).join(' ');
  return <li className={classes}>
    <Icon size={14} aria-hidden="true" />
    {entry.note
      ? <span className="trace-note">{tMessage(entry.note)}</span>
      : <>
        <span className="trace-verb">{traceVerb(entry.kind)}</span>
        {entry.target && <span className={proseKinds.includes(entry.kind) ? 'trace-text' : 'trace-target'}>{entry.target}</span>}
      </>}
  </li>;
}
