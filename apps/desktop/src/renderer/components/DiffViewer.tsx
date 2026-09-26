import { useEffect, useMemo, useState } from 'react';
import { FileDiff } from 'lucide-react';
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
 * pair. It is evidence, never a control: nothing here applies, reverts or touches the person's folder. The
 * apply-or-keep decisions stay in Details (`WorkspaceRecovery`).
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
export function DiffCounts({ counts }: { counts: Pick<WorkspaceDiffSummary, 'additions' | 'deletions'> }) {
  const locale = currentLocale();
  return <span className="diff-counts">
    <span className="diff-count-added">+{counts.additions.toLocaleString(locale)}</span>
    {' '}
    <span className="diff-count-removed">−{counts.deletions.toLocaleString(locale)}</span>
  </span>;
}

/**
 * The one quiet line a turn shows when its run changed files or folders: it sits under the answer, shaped like the
 * folded trace above it, and opens the viewer. Nothing is shown when nothing changed, so the line itself is the claim.
 */
export function ChangedFilesLine({ summary, workerName, onOpen }: { summary: WorkspaceDiffSummary; workerName?: string; onOpen: () => void }) {
  return <button type="button" className="activity-summary changed-files" aria-haspopup="dialog" onClick={onOpen}>
    <FileDiff size={14} aria-hidden="true" />
    <span>{changedParts(summary, workerName).join(' · ')}{hasLineCounts(summary) && <> · <DiffCounts counts={summary} /></>}</span>
  </button>;
}

const fileElementId = (index: number) => `diff-file-${index}`;

/** The viewer over a diff already fetched; pure, so a test can render it and the dialog below owns the bridge. */
export function DiffViewer({ diff, workerName, info, onClose }: { diff: WorkspaceDiff; workerName: string; info: InfoTipRow[]; onClose: () => void }) {
  const files = diff.files.length.toLocaleString(currentLocale());
  const meta = diff.lines === false ? t('{0} tệp', [files]) : t('{0} tệp · {1}', [files, countsLabel(diff)]);
  return <SourceViewer open onClose={onClose} name={t('Thay đổi của {0}', [workerName])} meta={meta}
    icon={FileDiff} info={info} infoLabel={t('Thông tin về thay đổi này')} menuLabel={t('Tùy chọn')}>
    {diff.files.length === 0 && !diff.folders?.length
      ? <p className="preview-state">{t('Không có thay đổi nào trong bản làm việc.')}</p>
      : <DiffBody diff={diff} />}
  </SourceViewer>;
}

/**
 * The file list and the stacked files; exported so a test can render it without the dialog's portal. A plain folder
 * copy has no hunks, so its list is the whole view: each row says what happened to the file, and nothing to scroll to.
 */
export function DiffBody({ diff }: { diff: WorkspaceDiff }) {
  const withLines = diff.lines !== false;
  const folders = diff.folders ?? [];
  return <div className="diff-view">
    {!withLines && <p className="preview-note">{t('Thư mục này không phải Git repository nên chỉ hiện tệp nào đã thay đổi, không hiện từng dòng.')}</p>}
    <ul className="diff-files" aria-label={t('Tệp đã thay đổi')}>
      {diff.files.map((file, index) => <li key={file.path}>
        {withLines
          ? <button type="button" className="diff-file-row" onClick={() => document.getElementById(fileElementId(index))?.scrollIntoView({ block: 'start' })}>
            <FileRowContent file={file} counts />
          </button>
          : <span className="diff-file-row static"><FileRowContent file={file} counts={false} /></span>}
      </li>)}
      {folders.map(folder => <li key={`folder:${folder.path}`}>
        <span className="diff-file-row static">
          <span className="diff-file-path">{`${folder.path}/`}</span>
          <span className="diff-file-status">{folderLabels[folder.status]}</span>
        </span>
      </li>)}
    </ul>
    {diff.truncated && <p className="preview-note">{t('Diff quá dài: một số tệp chỉ hiện số dòng thay đổi, không hiện nội dung.')}</p>}
    {withLines && diff.files.map((file, index) => <FileSection key={file.path} file={file} id={fileElementId(index)} />)}
  </div>;
}

function FileRowContent({ file, counts }: { file: DiffFile; counts: boolean }) {
  const status = statusLabel(file);
  return <>
    <span className="diff-file-path" title={pathLabel(file)}>{pathLabel(file)}</span>
    {status && <span className="diff-file-status">{status}</span>}
    {counts && <span className="diff-file-counts">{file.binary ? t('Nhị phân') : countsLabel(file)}</span>}
  </>;
}

function FileSection({ file, id }: { file: DiffFile; id: string }) {
  const language = languageOf(file.path);
  const status = statusLabel(file);
  return <section className="diff-file" id={id} aria-label={file.path}>
    <h3 className="diff-file-heading">
      <span className="diff-file-path">{pathLabel(file)}</span>
      {status && <span className="diff-file-status">{status}</span>}
      <span className="diff-file-counts">{file.binary ? t('Nhị phân') : countsLabel(file)}</span>
    </h3>
    {file.binary && <p className="preview-note">{t('Tệp nhị phân; không hiện nội dung.')}</p>}
    {file.truncated && !file.binary && <p className="preview-note">{file.hunks.length > 0 ? t('Tệp dài; chỉ hiện phần đầu của thay đổi.') : t('Nội dung không được gửi vì diff quá dài.')}</p>}
    {file.hunks.map((hunk, index) => <HunkView key={index} hunk={hunk} language={language} />)}
  </section>;
}

/** A hunk as one `source-preview` block: the range line, then every line with both numbers and its sign. */
function HunkView({ hunk, language }: { hunk: DiffHunk; language: Language }) {
  // One tokenizer pass over the whole hunk keeps a comment or string that spans lines coloured across them.
  const tokenLines = useMemo(() => tokenizeLines(hunk.lines.map(line => line.text).join('\n'), language), [hunk, language]);
  const lastLine = Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines);
  const numberWidth = `${String(lastLine).length + 1}ch`;
  return <pre className={`source-preview diff-hunk language-${language}`} style={{ '--line-number-width': numberWidth } as React.CSSProperties}>
    <span className="diff-hunk-range">
      <span className="line-number" aria-hidden="true" /><span className="line-number" aria-hidden="true" /><span className="diff-sign" aria-hidden="true" />
      {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.heading ? ` ${hunk.heading}` : ''}`}{'\n'}
    </span>
    {hunk.lines.map((line, index) => {
      const tokens = tokenLines[index] ?? [{ kind: 'plain' as const, text: line.text }];
      const className = line.kind === 'added' ? 'line-added' : line.kind === 'removed' ? 'line-removed' : undefined;
      return <span key={index} className={className} data-old-line={line.oldLine ?? undefined} data-new-line={line.newLine ?? undefined}>
        <span className="line-number">{line.oldLine ?? ''}</span>
        <span className="line-number">{line.newLine ?? ''}</span>
        <span className="diff-sign" aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
        {tokens.map((token, tokenIndex) => token.kind === 'plain' ? token.text : <span key={tokenIndex} className={`tok-${token.kind}`}>{token.text}</span>)}
        {'\n'}
      </span>;
    })}
  </pre>;
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
export function DiffDialog({ taskId, run, onClose }: { taskId: string; run: Run; onClose: () => void }) {
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
  return <DiffViewer diff={loaded.diff} workerName={workerName} info={info} onClose={onClose} />;
}
