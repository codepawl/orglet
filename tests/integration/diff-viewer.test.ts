import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ChangedFilesLine, DiffBody, changedFilesLabel } from '../../apps/desktop/src/renderer/components/DiffViewer';
import { changedFilesOf } from '../../apps/desktop/src/renderer/components/TaskThread';
import { ChangedFilesCard } from '../../apps/desktop/src/renderer/components/ChangedFilesCard';
import { CARD_FILE_ROWS, cardRowsOf, entryCountsKind } from '../../apps/desktop/src/renderer/changedFiles';
import { DIFF_SUMMARY_ENTRY_LIMIT, WorkspaceDiffSummary, countsOf, summarize, type WorkspaceDiff, type WorkspaceDiffEntry } from '../../apps/desktop/src/shared/workspace-diff';
import { ChangedFilesRecord } from '../../apps/desktop/src/shared/workspace-recovery';
import type { WorkspaceRecoveryView } from '../../apps/desktop/src/shared/workspace-recovery';
import type { Run } from '../../apps/desktop/src/shared/contracts';

const taskId = '11111111-1111-4111-8111-111111111111';
const runIds = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222223'];

/** A run and a copy of the recovery view are only read for their ids and counts here. */
const run = (id: string, name: string): Run => ({ id, taskId, status: 'completed', startedAt: '2026-09-23T09:00:00.000Z', error: null,
  snapshot: { worker: { id: `4444444${name.length}-4444-4444-8444-444444444441`, revision: 1, name, instructions: 'Work.', provider: 'anthropic', skillId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, skill: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, name: 'Skill', content: 'Help.' } } });
const copy = (runId: string, diff?: WorkspaceRecoveryView['copies'][number]['diff']): WorkspaceRecoveryView['copies'][number] =>
  ({ runId, state: 'integrated', kind: 'git-worktree', changes: [], changeCount: 0, ...(diff ? { diff } : {}) });

const diff: WorkspaceDiff = {
  runId: runIds[0], additions: 3, deletions: 1, truncated: false,
  files: [
    { path: 'src/app.ts', status: 'modified', binary: false, additions: 2, deletions: 1, truncated: false, hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, heading: 'function main()', lines: [
      { kind: 'context', text: 'const a = 1;', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: 'const b = "old";', oldLine: 2, newLine: null },
      { kind: 'added', text: 'const b = "new";', oldLine: null, newLine: 2 },
      { kind: 'added', text: 'const c = 3;', oldLine: null, newLine: 3 },
      { kind: 'context', text: 'export { a, b };', oldLine: 3, newLine: 4 },
    ] }] },
    { path: 'logo.png', status: 'added', binary: true, additions: 0, deletions: 0, truncated: false, hunks: [] },
    { path: 'docs/new-name.md', previousPath: 'docs/old-name.md', status: 'renamed', binary: false, additions: 1, deletions: 0, truncated: true, hunks: [] },
  ],
};

it('lists every changed file with its counts and draws the hunks with both line numbers and the tinted lines', () => {
  const html = renderToStaticMarkup(createElement(DiffBody, { diff }));
  expect(html.match(/class="diff-file-row"/g)).toHaveLength(3);
  // A path reads as its folder, quiet, then its name in full weight.
  expect(html).toContain('<span class="diff-path-folder">src/</span><span class="diff-path-name">app.ts</span>');
  // The counts wear the diff's colours in the list and in each file's header (owner, 2026-09-26: they were grey).
  expect(html.match(/<span class="diff-count-added">\+2<\/span> <span class="diff-count-removed">−1<\/span>/g)).toHaveLength(2);
  expect(html).toContain('Binary');
  expect(html).toContain('<span class="diff-file-status diff-status-added">New file</span>');
  expect(html).toContain('<span class="diff-file-status diff-status-renamed">Renamed</span>');
  expect(html).toContain('<span class="diff-path-from">docs/old-name.md</span>');
  expect(html).toContain('<span class="diff-hunk-lines">@@ -1,3 +1,4 @@</span><span class="diff-hunk-heading">function main()</span>');
  expect(html).toMatch(/class="diff-line line-removed"[^>]*data-old-line="2"[^>]*><span class="line-number">2<\/span><span class="line-number"><\/span>/);
  expect(html).toMatch(/class="diff-line line-added"[^>]*data-new-line="3"[^>]*><span class="line-number"><\/span><span class="line-number">3<\/span>/);
  // Every file folds from its header, which stays in view while its lines scroll by.
  expect(html.match(/class="diff-file-fold" aria-expanded="true"/g)).toHaveLength(3);
  expect(html).toContain('tok-string');
  expect(html).toContain('The content was left out because the diff is too long.');
  expect(html).toContain('Binary file; its content is not shown.');
  // Read-only: no apply, revert or keep control anywhere in the viewer.
  expect(html).not.toMatch(/Apply|Revert|Keep current files/);
});

it('names a single changed file once, in its heading, without a list above it (dogfood, 2026-09-26)', () => {
  const single: WorkspaceDiff = { ...diff, additions: 2, deletions: 1, files: [diff.files[0]] };
  const html = renderToStaticMarkup(createElement(DiffBody, { diff: single }));
  expect(html).not.toContain('class="diff-files"');
  expect(html.match(/class="diff-path-name">app\.ts</g)).toHaveLength(1); // named once, in the heading
  expect(html).toContain('class="diff-file-heading"');
  // A file and a folder, or a plain copy with no lines, still get the list.
  expect(renderToStaticMarkup(createElement(DiffBody, { diff: { ...single, folders: [{ path: 'assets', status: 'added' }] } }))).toContain('class="diff-files"');
  expect(renderToStaticMarkup(createElement(DiffBody, { diff: { ...single, lines: false } }))).toContain('class="diff-files"');
});

it('words the turn line from the counts the core kept, naming the worker only when asked', () => {
  const summary = { files: 3, additions: 42, deletions: 7 };
  expect(changedFilesLabel(summary)).toBe('Changed 3 files · +42 −7');
  expect(changedFilesLabel(summary, 'Scout')).toBe('Scout changed 3 files · +42 −7');
  // One file has its own words, alone and in a crew's named line (COD-291).
  expect(changedFilesLabel({ files: 1, additions: 3, deletions: 0 })).toBe('Changed 1 file · +3 −0');
  expect(changedFilesLabel({ files: 1, additions: 3, deletions: 0 }, 'Writer')).toBe('Writer changed 1 file · +3 −0');
  expect(changedFilesLabel({ files: 0, additions: 0, deletions: 0, folders: 1, lines: false }, 'Writer')).toBe('Writer changed 1 folder');
  const html = renderToStaticMarkup(createElement(ChangedFilesLine, { summary, onOpen: () => {} }));
  expect(html).toContain('class="activity-summary changed-files"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html.replace(/<[^>]+>/g, '')).toContain('Changed 3 files · +42 −7');
  // The line counts wear the diff's colours, apart from the file count.
  expect(html).toContain('<span class="diff-count-added">+42</span>');
  expect(html).toContain('<span class="diff-count-removed">−7</span>');
});

it('shows a line only for runs whose copy changed something', () => {
  const runs = [run(runIds[0], 'Scout'), run(runIds[1], 'Writer'), run(runIds[2], 'Lead')];
  const recovery: WorkspaceRecoveryView = { taskId, attempts: [], processes: [], uncertainCalls: [], truncated: false,
    copies: [copy(runIds[0], { files: 2, additions: 5, deletions: 1 }), copy(runIds[1], { files: 0, additions: 0, deletions: 0 })] };
  expect(changedFilesOf(runs, recovery).map(item => [item.run.snapshot.worker.name, item.summary])).toEqual([['Scout', { files: 2, additions: 5, deletions: 1 }]]);
  expect(changedFilesOf(runs, undefined)).toEqual([]);
});

it('keeps a restored turn’s line with its counts and outcome, and says it cannot be opened (COD-299)', () => {
  const runs = [run(runIds[0], 'Scout'), run(runIds[1], 'Writer'), run(runIds[2], 'Lead')];
  const recovery: WorkspaceRecoveryView = { taskId, attempts: [], processes: [], uncertainCalls: [], truncated: false,
    copies: [copy(runIds[0], { files: 2, additions: 5, deletions: 1 })],
    restored: [
      // A working copy on this computer wins over what a backup kept for the same run.
      { runId: runIds[0], diff: { files: 9, additions: 9, deletions: 9 }, outcome: { state: 'discarded' } },
      { runId: runIds[1], diff: { files: 3, additions: 42, deletions: 7 }, outcome: { state: 'applied', skipped: 0 } },
      { runId: runIds[2], diff: { files: 1, additions: 1, deletions: 0 }, outcome: { state: 'pending' } },
    ] };
  const lines = changedFilesOf(runs, recovery);
  expect(lines.map(line => [line.run.snapshot.worker.name, line.summary.files, line.review, line.restored])).toEqual([
    ['Scout', 2, { state: 'applied', skipped: 0 }, undefined],
    ['Writer', 3, { state: 'applied', skipped: 0 }, true],
    // Changes that waited for review cannot be applied without their working copy.
    ['Lead', 1, { state: 'unapplied' }, true],
  ]);
  const html = renderToStaticMarkup(createElement(ChangedFilesLine, { summary: lines[1].summary, review: lines[1].review, restored: true, onOpen: () => {} }));
  expect(html).not.toContain('<button');
  expect(html.replace(/<[^>]+>/g, '')).toBe('Changed 3 files · +42 −7 · Applied · Restored from a backup, the changes can’t be opened');
});

it('tells a move from a rename, lists new and removed folders, and shows a plain copy without counts (COD-254)', () => {
  const plain: WorkspaceDiff = {
    runId: runIds[0], additions: 0, deletions: 0, truncated: false, lines: false,
    files: [
      { path: 'contract-old.pdf', status: 'deleted', binary: false, additions: 0, deletions: 0, truncated: false, hunks: [] },
      { path: 'receipts/march.pdf', previousPath: 'receipt 3.pdf', status: 'renamed', binary: false, additions: 0, deletions: 0, truncated: false, hunks: [] },
      { path: 'receipts/april.pdf', previousPath: 'receipts/Scan 12.pdf', status: 'renamed', binary: false, additions: 0, deletions: 0, truncated: false, hunks: [] },
    ],
    folders: [{ path: 'receipts', status: 'added' }, { path: 'old', status: 'deleted' }],
  };
  const html = renderToStaticMarkup(createElement(DiffBody, { diff: plain }));
  expect(html).toContain('This folder is not a Git repository, so only the files that changed are listed, not their lines.');
  const text = html.replace(/<[^>]+>/g, '');
  expect(text).toContain('receipt 3.pdf→ → receipts/march.pdfMoved');
  expect(text).toContain('receipts/Scan 12.pdf→ → receipts/april.pdfRenamed');
  expect(html).toContain('<span class="diff-path-name">contract-old.pdf</span></span><span class="diff-file-status diff-status-deleted">Deleted</span>');
  expect(html).toContain('<span class="diff-path-name">receipts/</span></span><span class="diff-file-status diff-status-added">New folder</span>');
  expect(html).toContain('<span class="diff-path-name">old/</span></span><span class="diff-file-status diff-status-deleted">Folder deleted</span>');
  // Nothing to scroll to and no counts: the rows are plain, and no file section follows the list.
  expect(html).not.toContain('<button');
  expect(html).not.toContain('diff-file-counts');
  expect(html).not.toContain('class="diff-file"');
});

it('words the turn line with moves, deletions and folders, and drops line counts a plain copy does not have (COD-254)', () => {
  expect(changedFilesLabel({ files: 6, additions: 0, deletions: 0, moved: 5, removed: 1, folders: 4, lines: false })).toBe('Changed 6 files · 5 moved or renamed · 1 deleted');
  expect(changedFilesLabel({ files: 3, additions: 42, deletions: 7, moved: 1 }, 'Scout')).toBe('Scout changed 3 files · 1 moved or renamed · +42 −7');
  expect(changedFilesLabel({ files: 0, additions: 0, deletions: 0, folders: 2, lines: false })).toBe('Changed 2 folders');
  const runs = [run(runIds[0], 'Scout')];
  const recovery: WorkspaceRecoveryView = { taskId, attempts: [], processes: [], uncertainCalls: [], truncated: false,
    copies: [copy(runIds[0], { files: 0, additions: 0, deletions: 0, folders: 1, lines: false })] };
  expect(changedFilesOf(runs, recovery)).toHaveLength(1);
});

const fileEntry = (path: string, added = 1, removed = 0): WorkspaceDiffEntry => ({ path, status: 'modified', added, removed });
const fiveFiles: WorkspaceDiffSummary = { files: 5, additions: 155, deletions: 0, entries: [
  { path: 'src/app.ts', status: 'added', added: 80, removed: 0 }, fileEntry('src/util.ts', 40), fileEntry('README.md', 20),
  fileEntry('package.json', 10), fileEntry('src/index.css', 5),
] };

it('keeps one entry per file and folder in the summary, caps them, and counts what it left out', () => {
  const file = (path: string) => ({ path, status: 'modified' as const, binary: false, additions: 2, deletions: 1, truncated: false, hunks: [] });
  const small = summarize({ additions: 3, deletions: 1, files: [file('a.ts'), { ...file('b.png'), binary: true, additions: 0, deletions: 0 }], folders: [{ path: 'assets', status: 'added' }] });
  expect(small.entries).toEqual([
    { path: 'a.ts', status: 'modified', added: 2, removed: 1 },
    { path: 'b.png', status: 'modified', binary: true, added: 0, removed: 0 },
    { path: 'assets', status: 'added', folder: true, added: 0, removed: 0 },
  ]);
  expect(small.moreEntries).toBeUndefined();
  const many = Array.from({ length: DIFF_SUMMARY_ENTRY_LIMIT + 7 }, (_, index) => file(`f${String(index).padStart(3, '0')}.ts`));
  const capped = summarize({ additions: 0, deletions: 0, files: many });
  expect(capped.files).toBe(DIFF_SUMMARY_ENTRY_LIMIT + 7);
  expect(capped.entries).toHaveLength(DIFF_SUMMARY_ENTRY_LIMIT);
  expect(capped.moreEntries).toBe(7);
  expect(WorkspaceDiffSummary.parse(capped)).toEqual(capped);
  // A path too long to store is counted, never allowed to fail the save.
  const tooLong = summarize({ additions: 0, deletions: 0, files: [file('x'.repeat(2000)), file('ok.ts')] });
  expect(tooLong.entries?.map(entry => entry.path)).toEqual(['ok.ts']);
  expect(tooLong.moreEntries).toBe(1);
  expect(summarize({ additions: 0, deletions: 0, files: [] })).toEqual({ files: 0, additions: 0, deletions: 0 });
});

it('keeps the paths out of a backup: only the counts travel', () => {
  const summary = summarize({ additions: 1, deletions: 0, files: [{ path: 'secret/plan.md', status: 'added', binary: false, additions: 1, deletions: 0, truncated: false, hunks: [] }] });
  expect(countsOf(summary)).toEqual({ files: 1, additions: 1, deletions: 0 });
  expect(() => ChangedFilesRecord.parse({ runId: runIds[0], diff: summary })).toThrow();
  expect(ChangedFilesRecord.parse({ runId: runIds[0], diff: countsOf(summary) }).diff).not.toHaveProperty('entries');
  // A summary stored before the entries existed still reads.
  expect(WorkspaceDiffSummary.parse({ files: 2, additions: 5, deletions: 1 })).toEqual({ files: 2, additions: 5, deletions: 1 });
});

it('shows three file rows and folds the rest behind "Show more"', () => {
  expect(cardRowsOf({ summary: fiveFiles }, false)).toEqual({ shown: fiveFiles.entries!.slice(0, CARD_FILE_ROWS), hidden: 2, unlisted: 0 });
  expect(cardRowsOf({ summary: fiveFiles }, true)).toEqual({ shown: fiveFiles.entries, hidden: 0, unlisted: 0 });
  const three: WorkspaceDiffSummary = { ...fiveFiles, files: 3, entries: fiveFiles.entries!.slice(0, 3) };
  expect(cardRowsOf({ summary: three }, false)?.hidden).toBe(0);
  // Files past the core's cap are only in the viewer.
  expect(cardRowsOf({ summary: { ...fiveFiles, moreEntries: 9 } }, true)?.unlisted).toBe(9);
  // Counts alone (a run from before the files were kept), a restored line and carried changes stay the single line.
  expect(cardRowsOf({ summary: { files: 5, additions: 155, deletions: 0 } }, false)).toBeUndefined();
  expect(cardRowsOf({ summary: fiveFiles, restored: true }, false)).toBeUndefined();
  expect(cardRowsOf({ summary: fiveFiles, review: { state: 'carried' } }, false)).toBeUndefined();
});

it('says "+0 −0" for nothing: folders, plain copies and unchanged lines show no counts', () => {
  expect(entryCountsKind({}, fileEntry('a.ts', 6, 2))).toBe('lines');
  expect(entryCountsKind({}, { path: 'logo.png', status: 'added', binary: true, added: 0, removed: 0 })).toBe('binary');
  expect(entryCountsKind({}, { path: 'assets', status: 'added', folder: true, added: 0, removed: 0 })).toBe('none');
  expect(entryCountsKind({}, fileEntry('mode-only.sh', 0, 0))).toBe('none');
  expect(entryCountsKind({ lines: false }, fileEntry('note.txt', 0, 0))).toBe('none');
});

it('draws the card: the headline, three rows with kind, path and their own counts, then "Show 2 more"', () => {
  const html = renderToStaticMarkup(createElement(ChangedFilesCard, { summary: fiveFiles, onOpen: () => {} }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(html).toContain('class="changed-files-card"');
  expect(text).toContain('Changed 5 files · +155');
  // The headline and a new file read "+155" and "+80" alone: a side that is zero is left out.
  expect(html).toContain('<span class="diff-count-added">+80</span>');
  expect(html.match(/class="[^"]*changed-file-row/g)).toHaveLength(3);
  expect(text).toContain('New file');
  expect(html).toContain('class="diff-path-folder">src/</span>');
  expect(html).not.toContain('package.json');
  expect(text).toContain('Show 2 more');
});

it('shows one changed file as that file\'s row alone, with where it stands and its counts', () => {
  const one: WorkspaceDiffSummary = { files: 1, additions: 4, deletions: 2, entries: [fileEntry('services/sync/src/account-object.ts', 4, 2)] };
  const html = renderToStaticMarkup(createElement(ChangedFilesCard, { summary: one, review: { state: 'pending' }, onOpen: () => {} }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(html).toContain('changed-files-single');
  expect(html.match(/class="[^"]*changed-file-row/g)).toHaveLength(1);
  expect(text).not.toContain('Changed 1 file');
  expect(text).toContain('account-object.ts');
  expect(text).toContain('Review');
  expect(html).toContain('<span class="diff-count-added">+4</span>');
  // A crew member's single file keeps the headline, so the card still names whose change it is.
  const crew = renderToStaticMarkup(createElement(ChangedFilesCard, { summary: one, workerName: 'Writer', onOpen: () => {} }));
  expect(crew).not.toContain('changed-files-single');
});

it('words a crew member\'s card, a move, a deletion and a folder without line counts', () => {
  const plain: WorkspaceDiffSummary = { files: 2, additions: 0, deletions: 0, moved: 1, removed: 1, folders: 1, lines: false, entries: [
    { path: 'receipts/march.pdf', previousPath: 'receipt 3.pdf', status: 'renamed', added: 0, removed: 0 },
    { path: 'contract-old.pdf', status: 'deleted', added: 0, removed: 0 },
    { path: 'receipts', status: 'added', folder: true, added: 0, removed: 0 },
  ] };
  const html = renderToStaticMarkup(createElement(ChangedFilesCard, { summary: plain, workerName: 'Writer', onOpen: () => {} }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(text).toContain('Writer changed 2 files');
  // The rows say what moved or went away, so the headline does not repeat it (the plain line still does).
  expect(text).not.toContain('moved or renamed');
  expect(changedFilesLabel(plain)).toContain('1 moved or renamed · 1 deleted');
  expect(text).toContain('Moved');
  expect(text).toContain('Deleted');
  expect(text).toContain('New folder');
  expect(html).not.toContain('diff-count-added');
  expect(html).not.toContain('Show');
  // A summary with counts only is still the one line, not a card.
  const line = renderToStaticMarkup(createElement(ChangedFilesCard, { summary: { files: 3, additions: 42, deletions: 7 }, onOpen: () => {} }));
  expect(line).not.toContain('changed-files-card');
  expect(line).toContain('class="activity-summary changed-files"');
});
