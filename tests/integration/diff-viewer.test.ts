import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ChangedFilesLine, DiffBody, changedFilesLabel } from '../../apps/desktop/src/renderer/components/DiffViewer';
import { changedFilesOf } from '../../apps/desktop/src/renderer/components/TaskThread';
import type { WorkspaceDiff } from '../../apps/desktop/src/shared/workspace-diff';
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
  expect(html).toContain('src/app.ts');
  expect(html).toContain('+2 −1');
  expect(html).toContain('Binary');
  expect(html).toContain('New file');
  expect(html).toContain('Renamed');
  expect(html).toContain('docs/old-name.md → docs/new-name.md');
  expect(html).toContain('@@ -1,3 +1,4 @@ function main()');
  expect(html).toMatch(/class="line-removed"[^>]*data-old-line="2"[^>]*><span class="line-number">2<\/span><span class="line-number"><\/span>/);
  expect(html).toMatch(/class="line-added"[^>]*data-new-line="3"[^>]*><span class="line-number"><\/span><span class="line-number">3<\/span>/);
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
  expect(html.match(/src\/app\.ts/g)).toHaveLength(2); // the heading's text and its section's name for assistive technology
  expect(html).toContain('class="diff-file-heading"');
  // A file and a folder, or a plain copy with no lines, still get the list.
  expect(renderToStaticMarkup(createElement(DiffBody, { diff: { ...single, folders: [{ path: 'assets', status: 'added' }] } }))).toContain('class="diff-files"');
  expect(renderToStaticMarkup(createElement(DiffBody, { diff: { ...single, lines: false } }))).toContain('class="diff-files"');
});

it('words the turn line from the counts the core kept, naming the worker only when asked', () => {
  const summary = { files: 3, additions: 42, deletions: 7 };
  expect(changedFilesLabel(summary)).toBe('Files changed: 3 · +42 −7');
  expect(changedFilesLabel(summary, 'Scout')).toBe('Scout · files changed: 3 · +42 −7');
  const html = renderToStaticMarkup(createElement(ChangedFilesLine, { summary, onOpen: () => {} }));
  expect(html).toContain('class="activity-summary changed-files"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html.replace(/<[^>]+>/g, '')).toContain('Files changed: 3 · +42 −7');
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
  expect(html).toContain('receipt 3.pdf → receipts/march.pdf</span><span class="diff-file-status">Moved');
  expect(html).toContain('receipts/Scan 12.pdf → receipts/april.pdf</span><span class="diff-file-status">Renamed');
  expect(html).toContain('contract-old.pdf</span><span class="diff-file-status">Deleted');
  expect(html).toContain('receipts/</span><span class="diff-file-status">New folder');
  expect(html).toContain('old/</span><span class="diff-file-status">Folder deleted');
  // Nothing to scroll to and no counts: the rows are plain, and no file section follows the list.
  expect(html).not.toContain('<button');
  expect(html).not.toContain('diff-file-counts');
  expect(html).not.toContain('class="diff-file"');
});

it('words the turn line with moves, deletions and folders, and drops line counts a plain copy does not have (COD-254)', () => {
  expect(changedFilesLabel({ files: 6, additions: 0, deletions: 0, moved: 5, removed: 1, folders: 4, lines: false })).toBe('Files changed: 6 · 5 moved or renamed · 1 deleted');
  expect(changedFilesLabel({ files: 3, additions: 42, deletions: 7, moved: 1 }, 'Scout')).toBe('Scout · files changed: 3 · 1 moved or renamed · +42 −7');
  expect(changedFilesLabel({ files: 0, additions: 0, deletions: 0, folders: 2, lines: false })).toBe('Folders changed: 2');
  const runs = [run(runIds[0], 'Scout')];
  const recovery: WorkspaceRecoveryView = { taskId, attempts: [], processes: [], uncertainCalls: [], truncated: false,
    copies: [copy(runIds[0], { files: 0, additions: 0, deletions: 0, folders: 1, lines: false })] };
  expect(changedFilesOf(runs, recovery)).toHaveLength(1);
});
