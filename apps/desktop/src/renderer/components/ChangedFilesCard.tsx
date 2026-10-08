import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, FolderMinus, FolderPlus } from 'lucide-react';
import { Button } from './ui';
import { fileKindIcon } from './Attachment';
import { ChangedFilesLine, DiffCounts, FilePath, entryStatusLabel, type ReviewStatus } from './DiffViewer';
import { CARD_FILE_ROWS, cardRowsOf, entryCountsKind } from '../changedFiles';
import type { WorkspaceDiffEntry, WorkspaceDiffSummary } from '../../shared/workspace-diff';
import { currentLocale, t } from '../i18n';

/**
 * What a turn changed, as a compact card under the answer (the way a code agent lists its edits): the headline is the
 * files line (count, counts in the diff's colours, where the changes stand) and opens the viewer; under it the first
 * few files, each with its kind, path, what happened to it and its own counts, and a click on one opens the viewer at
 * that file. The rest fold behind "Show N more". A run from before the files were kept, and a line that cannot be
 * opened, stay the single line.
 */
export function ChangedFilesCard({ summary, workerName, review, restored = false, onOpen }: {
  summary: WorkspaceDiffSummary;
  workerName?: string;
  review?: ReviewStatus;
  restored?: boolean;
  /** Opens the viewer, at `path` when a file row asked for it. */
  onOpen: (path?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = cardRowsOf({ summary, review, restored }, expanded);
  const headline = <ChangedFilesLine summary={summary} workerName={workerName} review={review} restored={restored} compact={rows !== undefined} onOpen={() => onOpen()} />;
  if (!rows) return headline;
  const locale = currentLocale();
  const canFold = (summary.entries?.length ?? 0) > CARD_FILE_ROWS;
  // Entries past the core's cap are only in the viewer; say so once the listed ones are all showing.
  const showUnlisted = rows.unlisted > 0 && (expanded || !canFold);
  return <div className="changed-files-card">
    {headline}
    <ul className="changed-files-rows" aria-label={t('Tệp đã thay đổi')}>
      {rows.shown.map(entry => <li key={`${entry.folder ? 'folder' : 'file'}:${entry.path}`}>
        <Button type="button" className="changed-file-row" aria-haspopup="dialog" onClick={() => onOpen(entry.folder ? undefined : entry.path)}>
          <EntryKind entry={entry} />
          <span className="changed-file-path">{entry.folder ? <span className="diff-path"><span className="diff-path-name">{`${entry.path}/`}</span></span> : <FilePath file={entry} />}</span>
          <EntryStatus entry={entry} />
          <EntryCounts summary={summary} entry={entry} />
          <ChevronRight size={14} aria-hidden="true" className="changed-file-chevron" />
        </Button>
      </li>)}
    </ul>
    {(canFold || showUnlisted) && <div className="changed-files-more">
      {canFold && (expanded
        ? <Button type="button" className="changed-files-toggle" aria-expanded onClick={() => setExpanded(false)}>
          <ChevronUp size={14} aria-hidden="true" />{t('Thu gọn')}
        </Button>
        : <Button type="button" className="changed-files-toggle" aria-expanded={false} onClick={() => setExpanded(true)}>
          <ChevronDown size={14} aria-hidden="true" />{t('Hiện thêm {0}', [rows.hidden.toLocaleString(locale)])}
        </Button>)}
      {showUnlisted && <Button type="button" className="changed-files-toggle" aria-haspopup="dialog" onClick={() => onOpen()}>
        {t('Xem thêm {0} tệp trong trình xem', [rows.unlisted.toLocaleString(locale)])}
      </Button>}
    </div>}
  </div>;
}

function EntryKind({ entry }: { entry: WorkspaceDiffEntry }) {
  if (entry.folder) {
    const Folder = entry.status === 'added' ? FolderPlus : FolderMinus;
    return <Folder size={15} aria-hidden="true" className="diff-file-kind" />;
  }
  const Kind = fileKindIcon(entry.path);
  return <Kind size={15} aria-hidden="true" className="diff-file-kind" />;
}

function EntryStatus({ entry }: { entry: WorkspaceDiffEntry }) {
  const status = entryStatusLabel(entry);
  return status ? <span className={`diff-file-status diff-status-${entry.status}`}>{status}</span> : null;
}

function EntryCounts({ summary, entry }: { summary: WorkspaceDiffSummary; entry: WorkspaceDiffEntry }) {
  const kind = entryCountsKind(summary, entry);
  if (kind === 'none') return null;
  return <span className="diff-file-counts">
    {kind === 'binary' ? t('Nhị phân') : <DiffCounts counts={{ additions: entry.added, deletions: entry.removed }} hideZero />}
  </span>;
}
