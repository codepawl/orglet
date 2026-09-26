import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, FileDiff, FileX, FolderMinus, FolderPlus, Info, Undo2 } from 'lucide-react';
import { Button } from './ui';
import { Checkbox } from './Checkbox';
import { fileKindIcon } from './Attachment';
import type { Run } from '../../shared/contracts';
import type { DiffFile, DiffFolder, DiffHunk, WorkspaceDiff, WorkspaceDiffSummary } from '../../shared/workspace-diff';
import { SourceViewer } from './SourceViewer';
import type { InfoTipRow } from './InfoTip';
import { languageOf, tokenizeLines, type Language } from './highlight';
import { currentLocale, t, tMessage, translated } from '../i18n';
import { orglet } from '../api';
import { Skeleton, SkeletonGroup, SkeletonText } from '@codepawl/orglet-ui';
import { workspaceDiffs } from '../caches';
import { useCached } from '../prefetch';

/*
 * What a run changed in its private working copy (COD-163), read the way a code review reads a patch: every changed
 * file listed with its counts, then each file's hunks with the snapshot's and the copy's line numbers side by side,
 * removed lines tinted in the error colour and added lines in the success colour, the way `CodePreview` marks a
 * pair. Reading it never touches the person's folder. The one decision it carries is for changes a run held for
 * review (COD-279): Apply, with a tick per file to leave some out, or Discard. Conflicts and keeping current files
 * stay in Details (`WorkspaceRecovery`).
 */

/** A modified file needs no word; the counts say it. */
const statusLabels: Partial<Record<DiffFile['status'], string>> = translated({ added: 'Tệp mới', deleted: 'Đã xóa', renamed: 'Đã đổi tên' });
const folderLabels: Record<DiffFolder['status'], string> = translated({ added: 'Thư mục mới', deleted: 'Đã xóa thư mục' });

/** Git calls both a rename; a person tells a file that went to another folder apart from one that got a new name (COD-254). */
function statusLabel(file: DiffFile): string | undefined {
  if (file.status === 'renamed' && file.previousPath && folderOf(file.previousPath) !== folderOf(file.path)) return t('Đã chuyển');
  return statusLabels[file.status];
}

const folderOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const pathLabel = (file: DiffFile) => file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

/** "+42 −7" with the locale's digits; a binary file has no counts to show. */
export function countsLabel(counts: Pick<WorkspaceDiffSummary, 'additions' | 'deletions'>): string {
  const locale = currentLocale();
  return `+${counts.additions.toLocaleString(locale)} −${counts.deletions.toLocaleString(locale)}`;
}

/** "Đã thay đổi 3 tệp", or the folders when only folders changed, with the worker named when asked. */
function changedHead(summary: WorkspaceDiffSummary, workerName?: string): string {
  const locale = currentLocale();
  if (summary.files > 0) {
    const files = summary.files.toLocaleString(locale);
    if (workerName) return t('{0} đã thay đổi {1} tệp', [workerName, files]);
    return t('Đã thay đổi {0} tệp', [files]);
  }
  const folders = (summary.folders ?? 0).toLocaleString(locale);
  if (workerName) return t('{0} đã thay đổi {1} thư mục', [workerName, folders]);
  return t('Đã thay đổi {0} thư mục', [folders]);
}

/**
 * "Đã thay đổi 3 tệp · +42 −7", or with the worker named when the turn has more than one run that changed files.
 * Moves and deletions get their own counts (COD-254); a plain folder copy has no line counts, so it shows none.
 */
export function changedFilesLabel(summary: WorkspaceDiffSummary, workerName?: string): string {
  const parts = changedParts(summary, workerName);
  if (hasLineCounts(summary)) parts.push(countsLabel(summary));
  return parts.join(' · ');
}

/** The words of the changed-files line, without the line counts. */
function changedParts(summary: WorkspaceDiffSummary, workerName?: string): string[] {
  const locale = currentLocale();
  const parts = [changedHead(summary, workerName)];
  if (summary.moved) parts.push(t('{0} chuyển hoặc đổi tên', [summary.moved.toLocaleString(locale)]));
  if (summary.removed) parts.push(t('{0} đã xóa', [summary.removed.toLocaleString(locale)]));
  return parts;
}

function hasLineCounts(summary: WorkspaceDiffSummary): boolean {
  return summary.lines !== false && summary.files > 0;
}

/**
 * Lines added and removed, in the colours the diff itself uses (the theme's success and error), so they read apart
 * from the file count beside them.
 */
export function DiffCounts({ counts, hideZero = false }: { counts: Pick<WorkspaceDiffSummary, 'additions' | 'deletions'>; /** One file's counts leave out a side that is zero, as "+6" for a new file. */ hideZero?: boolean }) {
  const locale = currentLocale();
  const added = !hideZero || counts.additions > 0 || counts.deletions === 0;
  const removed = !hideZero || counts.deletions > 0;
  return <span className="diff-counts">
    {added && <span className="diff-count-added">+{counts.additions.toLocaleString(locale)}</span>}
    {added && removed && ' '}
    {removed && <span className="diff-count-removed">−{counts.deletions.toLocaleString(locale)}</span>}
  </span>;
}

/**
 * What became of changes a run held for review (COD-279): waiting, applied (with how many steps the person left
 * out), dropped, or carried on by a later turn that reviews them together with its own.
 */
export type ReviewStatus =
  | { state: 'pending' }
  /** The person applied them and the broker is working through the steps. */
  | { state: 'applying' }
  | { state: 'applied'; skipped: number }
  /** The apply stopped at a file the person changed meanwhile; what is left is settled in Details. */
  | { state: 'stopped' }
  | { state: 'discarded' }
  | { state: 'carried' };

/** The words after the counts that say where the changes stand; nothing for a run that handed in at once. */
function reviewSuffix(review: ReviewStatus): ReactNode {
  if (review.state === 'pending') return <>
    <span className="changed-files-pending">{t('Chưa áp dụng vào thư mục')}</span>
    {' · '}<span className="changed-files-open">{t('Xem lại')}</span>
  </>;
  if (review.state === 'applying') return t('Đang áp dụng…');
  if (review.state === 'applied') return review.skipped > 0 ? t('Đã áp dụng, bỏ qua {0}', [review.skipped.toLocaleString(currentLocale())]) : t('Đã áp dụng');
  if (review.state === 'stopped') return <span className="changed-files-pending">{t('Dừng ở xung đột, xem trong Chi tiết')}</span>;
  if (review.state === 'discarded') return t('Đã bỏ, thư mục không đổi');
  return t('Chuyển sang lượt sau');
}

/**
 * The one quiet line a turn shows when its run changed files or folders: it sits under the answer, shaped like the
 * folded trace above it, and opens the viewer. Nothing is shown when nothing changed, so the line itself is the claim.
 * Changes held for review say so at the end of the line, and it opens the viewer where they are applied or dropped;
 * changes a later turn carried on have no viewer of their own, so that line is plain text.
 */
export function ChangedFilesLine({ summary, workerName, review, onOpen }: { summary: WorkspaceDiffSummary; workerName?: string; review?: ReviewStatus; onOpen: () => void }) {
  const content = <>
    <FileDiff size={14} aria-hidden="true" />
    <span>
      {changedParts(summary, workerName).join(' · ')}{hasLineCounts(summary) && <> · <DiffCounts counts={summary} /></>}
      {review && <> · {reviewSuffix(review)}</>}
    </span>
  </>;
  if (review?.state === 'carried') return <p className="activity-summary changed-files changed-files-carried">{content}</p>;
  const pending = review?.state === 'pending';
  return <button type="button" className={pending ? 'activity-summary changed-files changed-files-review' : 'activity-summary changed-files'} aria-haspopup="dialog" onClick={onOpen}>
    {content}
  </button>;
}

/** Apply and Discard for changes held for review (COD-279); the dialog below owns the bridge. */
export type DiffReview = { busy: boolean; onApply: (paths?: string[]) => void; onDiscard: () => void };

/** The paths one row of the list stands for: a moved file by both of its paths, so either end of the plan's move matches. */
const rowPaths = (file: DiffFile) => file.previousPath ? [file.path, file.previousPath] : [file.path];

const fileElementId = (index: number) => `diff-file-${index}`;

/**
 * The viewer over a diff already fetched; pure, so a test can render it and the dialog below owns the bridge. With
 * `review`, the changes are still held (COD-279): the toolbar carries Discard and Apply, and with more than one file
 * each has a tick, so the person can leave some out. Apply names how many files it takes when not all.
 */
export function DiffViewer({ diff, workerName, info, review, onClose }: { diff: WorkspaceDiff; workerName: string; info: InfoTipRow[]; review?: DiffReview; onClose: () => void }) {
  const files = diff.files.length.toLocaleString(currentLocale());
  // The counts wear the diff's own colours here too, the way the chat's changed-files line does.
  const meta = diff.lines === false ? t('{0} tệp', [files]) : <>{t('{0} tệp', [files])} · <DiffCounts counts={diff} /></>;
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const ticked = diff.files.filter(file => !skipped.has(file.path)).length;
  // Folders follow their files: a new one is made for a kept file, a removed one goes once nothing inside stays.
  const apply = () => {
    if (!review) return;
    if (skipped.size === 0) { review.onApply(); return; }
    const kept = [...diff.files.filter(file => !skipped.has(file.path)).flatMap(rowPaths), ...(diff.folders ?? []).map(folder => folder.path)];
    review.onApply(kept);
  };
  const actions = review && <>
    <Button variant="outline" className="diff-discard" disabled={review.busy} onClick={review.onDiscard} aria-label={t('Bỏ thay đổi')} title={t('Bỏ thay đổi')}>
      <Undo2 size={16} aria-hidden="true" /><span className="diff-action-label">{t('Bỏ thay đổi')}</span>
    </Button>
    <Button variant="primary" disabled={review.busy || ticked === 0} onClick={apply}><Check size={16} aria-hidden="true" />
      {skipped.size === 0 ? t('Áp dụng') : t('Áp dụng {0}/{1}', [ticked, diff.files.length])}
    </Button>
  </>;
  // One file is applied or discarded whole, so it gets no tick.
  const selection = review && diff.files.length > 1 ? {
    isTicked: (path: string) => !skipped.has(path),
    toggle: (path: string, on: boolean) => setSkipped(previous => {
      const next = new Set(previous);
      if (on) next.delete(path); else next.add(path);
      return next;
    }),
  } : undefined;
  return <SourceViewer open onClose={onClose} name={t('Thay đổi của {0}', [workerName])} meta={meta}
    icon={FileDiff} info={info} infoLabel={t('Thông tin về thay đổi này')} menuLabel={t('Tùy chọn')} actions={actions}>
    {review && <p className="preview-note diff-review-note">{t('Chưa có gì vào thư mục của bạn. Áp dụng để đưa thay đổi vào, hoặc bỏ nếu không cần.')}</p>}
    {diff.files.length === 0 && !diff.folders?.length
      ? <p className="preview-state">{t('Không có thay đổi nào trong bản làm việc.')}</p>
      : <DiffBody diff={diff} selection={selection} />}
  </SourceViewer>;
}

/** Which files go with Apply, while changes wait for review (COD-279). */
export type DiffSelection = { isTicked: (path: string) => boolean; toggle: (path: string, ticked: boolean) => void };

/** A path as a reviewer scans it: the folder quiet and allowed to shorten, the file's name in full weight. */
function PathText({ path }: { path: string }) {
  const cut = path.lastIndexOf('/') + 1;
  return <span className="diff-path" title={path}>
    {cut > 0 && <span className="diff-path-folder">{path.slice(0, cut)}</span>}
    <span className="diff-path-name">{path.slice(cut)}</span>
  </span>;
}

/** Where a moved file came from, quiet, then where it is now. */
function FilePath({ file }: { file: DiffFile }) {
  if (!file.previousPath) return <PathText path={file.path} />;
  return <span className="diff-path-move" title={pathLabel(file)}>
    <span className="diff-path-from">{file.previousPath}</span>
    <span className="diff-path-arrow" aria-hidden="true">→</span>
    <span className="visually-hidden"> → </span>
    <PathText path={file.path} />
  </span>;
}

/** The small word for what happened to the file; a modified file needs none, its counts say it. */
function StatusChip({ file }: { file: DiffFile }) {
  const status = statusLabel(file);
  return status ? <span className={`diff-file-status diff-status-${file.status}`}>{status}</span> : null;
}

/** "+2 −1" in the diff's colours, "Binary" for a file with no lines, nothing for a plain copy that counts no lines. */
function FileCounts({ file }: { file: DiffFile }) {
  return <span className="diff-file-counts">{file.binary ? t('Nhị phân') : <DiffCounts counts={file} hideZero />}</span>;
}

/**
 * The file list and the stacked files; exported so a test can render it without the dialog's portal. The list is one
 * quiet card: each row the file's kind, its path with the folder muted, what happened to it and its counts, and a
 * click jumps to its section. Each section is a card of its own whose header stays in view while its lines scroll by
 * and folds the file away. A plain folder copy has no hunks, so its list is the whole view.
 * With `selection`, every file starts with a tick for the files to apply, in the list and in its header.
 */
export function DiffBody({ diff, selection }: { diff: WorkspaceDiff; selection?: DiffSelection }) {
  const withLines = diff.lines !== false;
  const folders = diff.folders ?? [];
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  // One file with its lines needs no list to jump from: its heading already names it (dogfood, 2026-09-26).
  const listed = !withLines || diff.files.length + folders.length > 1;
  const tick = (file: DiffFile) => selection && <Checkbox className="diff-file-tick" checked={selection.isTicked(file.path)}
    onChange={event => selection.toggle(file.path, event.currentTarget.checked)}><span className="visually-hidden">{t('Áp dụng {0}', [pathLabel(file)])}</span></Checkbox>;
  const toggleFold = (path: string) => setFolded(previous => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const jumpTo = (path: string, index: number) => {
    setFolded(previous => {
      if (!previous.has(path)) return previous;
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    document.getElementById(fileElementId(index))?.scrollIntoView({ block: 'start' });
  };
  return <div className="diff-view">
    {!withLines && <p className="preview-note">{t('Thư mục này không phải Git repository nên chỉ hiện tệp nào đã thay đổi, không hiện từng dòng.')}</p>}
    {listed && <ul className={selection ? 'diff-files selectable' : 'diff-files'} aria-label={t('Tệp đã thay đổi')}>
      {diff.files.map((file, index) => {
        const Kind = fileKindIcon(file.path);
        const content = <>
          <Kind size={15} aria-hidden="true" className="diff-file-kind" />
          <FilePath file={file} />
          <StatusChip file={file} />
          {withLines && <FileCounts file={file} />}
        </>;
        const skipped = selection !== undefined && !selection.isTicked(file.path);
        return <li key={file.path} className={skipped ? 'skipped' : undefined}>
          {tick(file)}
          {withLines
            ? <button type="button" className="diff-file-row" onClick={() => jumpTo(file.path, index)}>{content}</button>
            : <span className="diff-file-row static">{content}</span>}
        </li>;
      })}
      {/* A folder has no tick of its own: it follows the files in it. The empty box keeps its name in line with theirs. */}
      {folders.map(folder => <li key={`folder:${folder.path}`}>
        {selection && <span className="diff-file-tick-space" aria-hidden="true" />}
        <span className="diff-file-row static">
          {folder.status === 'added' ? <FolderPlus size={15} aria-hidden="true" className="diff-file-kind" /> : <FolderMinus size={15} aria-hidden="true" className="diff-file-kind" />}
          <span className="diff-path"><span className="diff-path-name">{`${folder.path}/`}</span></span>
          <span className={`diff-file-status diff-status-${folder.status === 'added' ? 'added' : 'deleted'}`}>{folderLabels[folder.status]}</span>
        </span>
      </li>)}
    </ul>}
    {diff.truncated && <p className="preview-note">{t('Diff quá dài: một số tệp chỉ hiện số dòng thay đổi, không hiện nội dung.')}</p>}
    {withLines && diff.files.map((file, index) => <FileSection key={file.path} file={file} id={fileElementId(index)}
      folded={folded.has(file.path)} skipped={selection !== undefined && !selection.isTicked(file.path)} onFold={() => toggleFold(file.path)} tick={tick(file)} />)}
  </div>;
}

function FileSection({ file, id, folded, skipped, onFold, tick }: { file: DiffFile; id: string; folded: boolean; /** Unticked while changes wait: it will not be applied, so its lines dim. */ skipped: boolean; onFold: () => void; tick: ReactNode }) {
  const language = languageOf(file.path);
  const Kind = fileKindIcon(file.path);
  const bodyId = `${id}-lines`;
  const note = file.binary ? t('Tệp nhị phân; không hiện nội dung.')
    : file.truncated ? (file.hunks.length > 0 ? t('Tệp dài; chỉ hiện phần đầu của thay đổi.') : t('Nội dung không được gửi vì diff quá dài.'))
    : file.hunks.length === 0 ? t('Không có dòng nào thay đổi.') : undefined;
  return <section className={['diff-file', folded && 'folded', skipped && 'skipped'].filter(Boolean).join(' ')} id={id} aria-label={file.path}>
    <h3 className="diff-file-heading">
      <button type="button" className="diff-file-fold" aria-expanded={!folded} aria-controls={bodyId}
        aria-label={folded ? t('Mở {0}', [file.path]) : t('Thu gọn {0}', [file.path])} onClick={onFold}>
        <ChevronDown size={15} aria-hidden="true" className="diff-fold-chevron" />
      </button>
      {tick}
      <Kind size={15} aria-hidden="true" className="diff-file-kind" />
      <FilePath file={file} />
      <StatusChip file={file} />
      <FileCounts file={file} />
    </h3>
    {!folded && <div className="diff-file-body" id={bodyId}>
      {note && <p className="diff-file-note">{file.binary ? <FileX size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}{note}</p>}
      {file.hunks.map((hunk, index) => <HunkView key={index} hunk={hunk} language={language} />)}
    </div>}
  </section>;
}

/**
 * A hunk: its range as a quiet label on a tinted band, then every line as a row of four columns, the snapshot's and
 * the copy's line numbers, the sign, and the code, which wraps inside its own column so a long line never widens the
 * viewer. Hunks are told apart by the band and space, never by a rule.
 */
function HunkView({ hunk, language }: { hunk: DiffHunk; language: Language }) {
  // One tokenizer pass over the whole hunk keeps a comment or string that spans lines coloured across them.
  const tokenLines = useMemo(() => tokenizeLines(hunk.lines.map(line => line.text).join('\n'), language), [hunk, language]);
  const lastLine = Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines);
  const numberWidth = `${String(lastLine).length + 1}ch`;
  return <div className={`diff-hunk language-${language}`} style={{ '--line-number-width': numberWidth } as React.CSSProperties}>
    <p className="diff-hunk-range">
      <span className="diff-hunk-lines">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</span>
      {hunk.heading && <span className="diff-hunk-heading">{hunk.heading}</span>}
    </p>
    <div className="diff-lines">
      {hunk.lines.map((line, index) => {
        const tokens = tokenLines[index] ?? [{ kind: 'plain' as const, text: line.text }];
        const className = line.kind === 'added' ? 'diff-line line-added' : line.kind === 'removed' ? 'diff-line line-removed' : 'diff-line';
        return <div key={index} className={className} data-old-line={line.oldLine ?? undefined} data-new-line={line.newLine ?? undefined}>
          <span className="line-number">{line.oldLine ?? ''}</span>
          <span className="line-number">{line.newLine ?? ''}</span>
          <span className="diff-sign" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
          <code className="diff-code">{tokens.map((token, tokenIndex) => token.kind === 'plain' ? token.text : <span key={tokenIndex} className={`tok-${token.kind}`}>{token.text}</span>)}</code>
        </div>;
      })}
    </div>
  </div>;
}

/** The shape of a diff on its way: a few file rows, then lines of code. */
function DiffShape() {
  return <SkeletonGroup label={t('Đang mở…')} className="diff-shape">
    <Skeleton width="34%" /><Skeleton width="28%" delay={0.06} />
    <SkeletonText lines={6} className="diff-shape-lines" />
  </SkeletonGroup>;
}

/**
 * The viewer wired to the core for one run of a chat: the diff comes through the bridge, never from the file system.
 * A diff already seen this session is drawn at once (COD-218); the kept copy goes when the workspace changes.
 */
export function DiffDialog({ taskId, run, review, onClose }: { taskId: string; run: Run; review?: DiffReview; onClose: () => void }) {
  const key = `${taskId}:${run.id}`;
  const diff = useCached(workspaceDiffs, key);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (diff) return;
    let active = true;
    setError(undefined);
    workspaceDiffs.read(key).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [key, diff]);
  const loaded = diff ? { loading: false, diff } : error ? { loading: false, error } : { loading: true };
  const workerName = run.snapshot.worker.name;
  const info: InfoTipRow[] = [
    { label: t('So với'), value: t('Bản chụp thư mục lúc lần chạy này bắt đầu') },
    { label: t('Thư mục của bạn'), value: t('Không bị đọc hay sửa khi xem; tích hợp và xung đột nằm trong Chi tiết') },
    { label: t('Mã lần chạy'), value: run.id, mono: true, onCopy: () => orglet.copyText(run.id) },
  ];
  if (loaded.loading || !loaded.diff) {
    return <SourceViewer open onClose={onClose} name={t('Thay đổi của {0}', [workerName])} meta={loaded.loading ? '' : t('Không mở được')}
      icon={FileDiff} info={info} infoLabel={t('Thông tin về thay đổi này')} menuLabel={t('Tùy chọn')}>
      {loaded.loading ? <DiffShape /> : <p className="preview-state">{tMessage(loaded.error ?? '')}</p>}
    </SourceViewer>;
  }
  return <DiffViewer diff={loaded.diff} workerName={workerName} info={info} review={review} onClose={onClose} />;
}
