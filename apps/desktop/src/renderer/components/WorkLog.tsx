import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppWindow, Ban, Blocks, BookOpen, Brain, Camera, Check, ChevronRight, FileDiff, FileText, FolderInput, FolderPlus, FolderSearch, Globe, Hourglass, ImageOff, Keyboard, Lightbulb, ListChecks, MonitorSmartphone, Mouse, MousePointerClick, MoveVertical, ScanSearch, Search, ShieldCheck, Table2, Terminal, TextCursorInput, Trash2, UserRound, Wrench, X, type LucideIcon } from 'lucide-react';
import { Skeleton, SkeletonGroup, SkeletonText, Tooltip } from '@codepawlhq/orglet-ui';
import { t, tMessage } from '../i18n';
import { workspaceDiffs } from '../caches';
import { useCached } from '../prefetch';
import { diffFileOf, diffKinds, splitTrace, traceStatusOf, traceSummary, visibleStepLimit, type TraceEntry, type TraceKind, type TraceStatus } from '../turnTrace';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { DiffBody, DiffCounts } from './DiffViewer';

/** The run whose working copy a step's file can be read from: only a finished run that kept one has a diff to open. */
export type WorkLogDiffRun = { taskId: string; runId: string };

/**
 * What an orglet did before its answer, laid out the way an agent's work reads in a code tool (shown only when the
 * person turned on "Hiện cách Tí làm việc"): the steps in the order they happened, each with a mark that says how it
 * ended, an icon, its verb and what it touched. What the run loaded first (memories, notes) is one folded row on top.
 * A step that changed a file opens that file's changes from the run's working copy. While a run streams, its notes
 * ("thinking") are a block of their own at the top; they are never saved, so a finished answer has none. Every row is
 * something the core recorded (docs/worker-actions.md); nothing here is guessed from the answer. `children` follow the
 * rows (the live timer). With nothing to show, nothing is drawn.
 */
export function WorkLog({ entries, thinking, onOpenMemories, diffRun, children }: {
  entries: readonly TraceEntry[]; thinking?: string; onOpenMemories?: () => void; diffRun?: WorkLogDiffRun; children?: ReactNode;
}) {
  const { loaded, steps } = splitTrace(entries);
  const [showAll, setShowAll] = useState(false);
  if (!entries.length && !thinking && !children) return null;
  const shown = showAll ? steps : steps.slice(0, visibleStepLimit);
  const hidden = steps.length - shown.length;
  return <div className="work-log">
    {thinking && <details className="work-fold work-thinking" open>
      <summary className="activity-summary work-summary">
        <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
        <span>{t('Đang suy nghĩ…')}</span>
      </summary>
      <p className="activity-notes work-thinking-text">{thinking}</p>
    </details>}
    {loaded.length > 0 && <details className="work-fold work-loaded">
      <summary className="activity-summary work-summary">
        <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
        <span>{traceSummary(loaded)}</span>
      </summary>
      <ol className="work-list work-loaded-list" aria-label={t('Ghi nhớ và ghi chú đã nạp')}>
        {loaded.map(entry => <li key={entry.id} className="work-row">
          <KindIcon kind={entry.kind} />
          <span className="work-verb">{traceVerb(entry.kind)}</span>
          {entry.target && <span className="work-text">{entry.target}</span>}
          {entry.why && <span className="work-why">{entry.why}</span>}
        </li>)}
      </ol>
      {onOpenMemories && loaded.some(entry => entry.kind === 'memory') && <Button type="button" className="work-link" onClick={onOpenMemories}>{t('Mở tab Ghi nhớ')}</Button>}
    </details>}
    {shown.length > 0 && <ol className="work-list work-steps" aria-label={t('Các bước của Tí')}>
      {shown.map(entry => <StepRow key={entry.id} entry={entry} diffRun={diffRun} />)}
    </ol>}
    {hidden > 0 && <Button type="button" className="work-more" onClick={() => setShowAll(true)}>{t('Xem thêm {0} bước', [hidden])}</Button>}
    {children}
  </div>;
}

const statusNames: Record<TraceStatus, () => string> = {
  done: () => t('Xong'),
  failed: () => t('Không thành'),
  running: () => t('Đang chạy'),
};

/** Done is a tick, a step that did not go through is a cross, a running one a pulsing dot: three shapes, never colour alone. */
function StatusGlyph({ status }: { status: TraceStatus }) {
  return <span className={`work-mark work-mark-${status}`} role="img" aria-label={statusNames[status]()}>
    {status === 'done' && <Check size={13} aria-hidden="true" />}
    {status === 'failed' && <X size={13} aria-hidden="true" />}
    {status === 'running' && <span className="work-dot" aria-hidden="true" />}
  </span>;
}

function StepRow({ entry, diffRun }: { entry: TraceEntry; diffRun?: WorkLogDiffRun }) {
  const status = traceStatusOf(entry);
  const classes = ['work-row', status === 'failed' ? 'work-row-failed' : '', status === 'running' ? 'running' : ''].filter(Boolean).join(' ');
  const openable = diffRun !== undefined && !entry.running && diffKinds.includes(entry.kind) && Boolean(entry.target);
  if (openable) return <li className={classes}><EditStep entry={entry} diffRun={diffRun} status={status} /></li>;
  return <li className={classes}><RowContent entry={entry} status={status} /></li>;
}

function RowContent({ entry, status }: { entry: TraceEntry; status: TraceStatus }) {
  const face = entry.face;
  return <>
    <StatusGlyph status={status} />
    {/* A named orglet's face belongs beside the name, and a step that did not go through already wears a cross. */}
    {face || entry.kind === 'failed' ? null : <KindIcon kind={entry.kind} />}
    {entry.note
      ? <span className="work-note">{tMessage(entry.note)}</span>
      : <>
        <span className="work-verb">{traceVerb(entry.kind)}</span>
        {entry.target && (face
          ? <span className="work-target work-person">
            <Avatar name={face.name} seed={face.seed} mascot={face.mascot} defaultMascot hint={face.hint} color={face.color} size="xxs" />
            {entry.target}
          </span>
          : <Tooltip label={entry.target}><span className="work-target">{entry.target}</span></Tooltip>)}
        {entry.why && <span className="work-why">{entry.why}</span>}
      </>}
  </>;
}

/** A step that changed a file: opening it reads that run's diff, once, and shows only this file's hunks. */
function EditStep({ entry, diffRun, status }: { entry: TraceEntry; diffRun: WorkLogDiffRun; status: TraceStatus }) {
  const [open, setOpen] = useState(false);
  const key = `${diffRun.taskId}:${diffRun.runId}`;
  const diff = useCached(workspaceDiffs, open ? key : undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || diff) return;
    let active = true;
    setFailed(false);
    workspaceDiffs.read(key).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, key, diff]);
  const file = diff ? diffFileOf(diff.files, entry) : undefined;
  const onlyThisFile = useMemo(() => file && diff ? { ...diff, files: [file], folders: [], truncated: file.truncated } : undefined, [diff, file]);
  return <details className="work-edit" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="work-edit-summary">
      <RowContent entry={entry} status={status} />
      {file && !file.binary && diff?.lines !== false && <DiffCounts counts={file} hideZero />}
      <ChevronRight size={14} aria-hidden="true" className="activity-chevron work-edit-chevron" />
    </summary>
    <div className="work-diff">
      {onlyThisFile
        ? <DiffBody diff={onlyThisFile} />
        : diff
          ? <p className="work-diff-note">{t('Không tìm thấy thay đổi nào của tệp này trong bản làm việc.')}</p>
          : failed
            ? <p className="work-diff-note">{t('Không mở được thay đổi.')}</p>
            : <SkeletonGroup label={t('Đang mở…')} className="work-diff-shape"><Skeleton width="30%" /><SkeletonText lines={4} /></SkeletonGroup>}
    </div>
  </details>;
}

const traceIcons: Record<TraceKind, LucideIcon> = {
  memory: Brain, knowledge: BookOpen, read: FileText, search: Search, list: FolderSearch, skill: BookOpen,
  web_search: Globe, web_read: Globe, dataset: Table2, edit: FileDiff, folder: FolderPlus, move: FolderInput, delete: Trash2, command: Terminal, handoff: UserRound,
  remembered: Brain, proposal: Lightbulb, withheld: ImageOff, failed: Ban, other: Wrench, mcp: Blocks,
  browser_open: AppWindow, browser_read: AppWindow, browser_find: ScanSearch, browser_screenshot: Camera, browser_scroll: MoveVertical,
  browser_click: MousePointerClick, browser_type: TextCursorInput, browser_select: ListChecks, browser_press: Keyboard, browser_wait: Hourglass, browser_asked: ShieldCheck,
  desktop_read: MonitorSmartphone, desktop_find: ScanSearch, desktop_screenshot: Camera, desktop_act: MousePointerClick, desktop_asked: ShieldCheck, desktop_borrow: Mouse,
};

function KindIcon({ kind }: { kind: TraceKind }) {
  const Icon = traceIcons[kind];
  return <Icon size={14} aria-hidden="true" className="work-kind" />;
}

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
    case 'desktop_borrow': return t('Mượn chuột và bàn phím');
    case 'handoff': return t('Giao việc cho');
    case 'remembered': return t('Ghi nhớ thêm');
    case 'proposal': return t('Đề xuất');
    case 'withheld': return t('Không gửi ảnh');
    case 'failed': return t('Không thành');
    case 'other': return t('Dùng công cụ');
  }
}
