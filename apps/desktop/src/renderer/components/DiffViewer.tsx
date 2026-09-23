import { useEffect, useMemo, useState } from 'react';
import { FileDiff } from 'lucide-react';
import type { Run } from '../../shared/contracts';
import type { DiffFile, DiffHunk, WorkspaceDiff, WorkspaceDiffSummary } from '../../shared/workspace-diff';
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

/** "+42 −7" with the locale's digits; a binary file has no counts to show. */
export function countsLabel(counts: Pick<WorkspaceDiffSummary, 'additions' | 'deletions'>): string {
  const locale = currentLocale();
  return `+${counts.additions.toLocaleString(locale)} −${counts.deletions.toLocaleString(locale)}`;
}

/** "Đã thay đổi 3 tệp · +42 −7", or with the worker named when the turn has more than one run that changed files. */
export function changedFilesLabel(summary: WorkspaceDiffSummary, workerName?: string): string {
  const files = summary.files.toLocaleString(currentLocale());
  return workerName
    ? t('{0} đã thay đổi {1} tệp · {2}', [workerName, files, countsLabel(summary)])
    : t('Đã thay đổi {0} tệp · {1}', [files, countsLabel(summary)]);
}

/**
 * The one quiet line a turn shows when its run changed files: it sits with the folded step line above the answer
 * and opens the viewer. Nothing is shown when nothing changed, so the line itself is the claim.
 */
export function ChangedFilesLine({ summary, workerName, onOpen }: { summary: WorkspaceDiffSummary; workerName?: string; onOpen: () => void }) {
  return <button type="button" className="activity-summary changed-files" aria-haspopup="dialog" onClick={onOpen}>
    <FileDiff size={14} aria-hidden="true" />
    <span>{changedFilesLabel(summary, workerName)}</span>
  </button>;
}

const fileElementId = (index: number) => `diff-file-${index}`;

/** The viewer over a diff already fetched; pure, so a test can render it and the dialog below owns the bridge. */
export function DiffViewer({ diff, workerName, info, onClose }: { diff: WorkspaceDiff; workerName: string; info: InfoTipRow[]; onClose: () => void }) {
  const summary = { files: diff.files.length, additions: diff.additions, deletions: diff.deletions };
  return <SourceViewer open onClose={onClose} name={t('Thay đổi của {0}', [workerName])} meta={t('{0} tệp · {1}', [summary.files.toLocaleString(currentLocale()), countsLabel(summary)])}
    icon={FileDiff} info={info} infoLabel={t('Thông tin về thay đổi này')} menuLabel={t('Tùy chọn')}>
    {diff.files.length === 0
      ? <p className="preview-state">{t('Không có thay đổi nào trong bản làm việc.')}</p>
      : <DiffBody diff={diff} />}
  </SourceViewer>;
}

/** The file list and the stacked files; exported so a test can render it without the dialog's portal. */
export function DiffBody({ diff }: { diff: WorkspaceDiff }) {
  return <div className="diff-view">
    <ul className="diff-files" aria-label={t('Tệp đã thay đổi')}>
      {diff.files.map((file, index) => <li key={file.path}>
        <button type="button" className="diff-file-row" onClick={() => document.getElementById(fileElementId(index))?.scrollIntoView({ block: 'start' })}>
          <span className="diff-file-path">{file.path}</span>
          {statusLabels[file.status] && <span className="diff-file-status">{statusLabels[file.status]}</span>}
          <span className="diff-file-counts">{file.binary ? t('Nhị phân') : countsLabel(file)}</span>
        </button>
      </li>)}
    </ul>
    {diff.truncated && <p className="preview-note">{t('Diff quá dài: một số tệp chỉ hiện số dòng thay đổi, không hiện nội dung.')}</p>}
    {diff.files.map((file, index) => <FileSection key={file.path} file={file} id={fileElementId(index)} />)}
  </div>;
}

function FileSection({ file, id }: { file: DiffFile; id: string }) {
  const language = languageOf(file.path);
  return <section className="diff-file" id={id} aria-label={file.path}>
    <h3 className="diff-file-heading">
      <span className="diff-file-path">{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
      {statusLabels[file.status] && <span className="diff-file-status">{statusLabels[file.status]}</span>}
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
