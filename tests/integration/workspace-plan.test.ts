import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { planIntegration, plainCopyDiff, TYPE_CHANGE_REFUSAL } from '../../apps/desktop/src/core/tools/workspace-plan';
import { summarize } from '../../apps/desktop/src/shared/workspace-diff';
import type { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
const file = (path: string, content: string) => ({ path, hash: hashOf(content), bytes: Buffer.byteLength(content) });
const manifest = (files: Record<string, string>, folders: string[] = []): WorkspaceManifest => ({
  files: Object.entries(files).map(([path, content]) => file(path, content)), omitted: [], folders,
});

/** The inbox from the COD-254 report: loose receipts, contracts, images and notes, with an older copy of a contract. */
const inbox = manifest({
  'IMG_0412.jpg': 'photo bytes',
  'contract (1).pdf': 'contract v1',
  'contract-final.pdf': 'contract v2',
  'contract-old.pdf': 'contract v1',
  'notes.txt': 'meeting notes',
  'receipt 3.pdf': 'receipt march',
});
const tidied = manifest({
  'contracts/2026-lease.pdf': 'contract v2',
  'contracts/2026-lease-draft.pdf': 'contract v1',
  'images/office-photo.jpg': 'photo bytes',
  'notes/meeting-notes.txt': 'meeting notes\nfollow up friday',
  'receipts/2026-03-receipt.pdf': 'receipt march',
}, ['contracts', 'images', 'notes', 'receipts']);

it('turns an inbox tidy-up into folders first, renames, one deletion for the duplicate and a new note', () => {
  const steps = planIntegration(inbox, tidied);
  expect(steps).toEqual([
    { kind: 'folder', path: 'contracts' },
    { kind: 'folder', path: 'images' },
    { kind: 'folder', path: 'notes' },
    { kind: 'folder', path: 'receipts' },
    // Two files had the draft's bytes; neither shares the new name, so the first in order moves and the other goes.
    { kind: 'move', from: 'contract (1).pdf', path: 'contracts/2026-lease-draft.pdf', hash: hashOf('contract v1'), bytes: 11 },
    { kind: 'move', from: 'contract-final.pdf', path: 'contracts/2026-lease.pdf', hash: hashOf('contract v2'), bytes: 11 },
    { kind: 'move', from: 'IMG_0412.jpg', path: 'images/office-photo.jpg', hash: hashOf('photo bytes'), bytes: 11 },
    { kind: 'move', from: 'receipt 3.pdf', path: 'receipts/2026-03-receipt.pdf', hash: hashOf('receipt march'), bytes: 13 },
    // The note was moved and edited, so it cannot be a rename: it is a new file plus the deletion of the old one.
    { kind: 'write', path: 'notes/meeting-notes.txt', hash: hashOf('meeting notes\nfollow up friday'), bytes: 30, expectedHash: null },
    { kind: 'delete', path: 'contract-old.pdf', expectedHash: hashOf('contract v1'), bytes: 11 },
    { kind: 'delete', path: 'notes.txt', expectedHash: hashOf('meeting notes'), bytes: 13 },
  ]);
});

it('prefers the duplicate with the same name, then the one in the same folder, as the source of a move', () => {
  const baseline = manifest({ 'a/report.pdf': 'same', 'b/copy.pdf': 'same', 'b/other.pdf': 'same' }, ['a', 'b']);
  expect(planIntegration(baseline, manifest({ 'c/report.pdf': 'same' }, ['a', 'b', 'c'])).filter(step => step.kind === 'move'))
    .toMatchObject([{ from: 'a/report.pdf', path: 'c/report.pdf' }]);
  expect(planIntegration(baseline, manifest({ 'b/renamed.pdf': 'same' }, ['a', 'b'])).filter(step => step.kind === 'move'))
    .toMatchObject([{ from: 'b/copy.pdf', path: 'b/renamed.pdf' }]);
});

it('orders new folders outermost first and removed folders innermost last', () => {
  const baseline = manifest({ 'old/deep/one.txt': '1' }, ['old', 'old/deep']);
  const current = manifest({ 'new/deeper/one.txt': '1' }, ['new', 'new/deeper', 'new/deeper/empty']);
  expect(planIntegration(baseline, current).map(step => `${step.kind} ${step.path}`)).toEqual([
    'folder new', 'folder new/deeper', 'folder new/deeper/empty',
    'move new/deeper/one.txt',
    'remove_folder old/deep', 'remove_folder old',
  ]);
});

it('keeps an edit a replacement against the snapshot hash and a new file a create-only write', () => {
  const steps = planIntegration(manifest({ 'note.txt': 'old' }), manifest({ 'note.txt': 'new', 'added.txt': 'fresh' }));
  expect(steps).toEqual([
    { kind: 'write', path: 'note.txt', hash: hashOf('new'), bytes: 3, expectedHash: hashOf('old') },
    { kind: 'write', path: 'added.txt', hash: hashOf('fresh'), bytes: 5, expectedHash: null },
  ]);
});

it('renames in place when only the letter case changed, and edits the renamed file against the snapshot', () => {
  const steps = planIntegration(manifest({ 'Docs/Readme.md': 'a' }, ['Docs']), manifest({ 'Docs/README.md': 'b' }, ['Docs']));
  expect(steps).toEqual([
    { kind: 'move', from: 'Docs/Readme.md', path: 'Docs/README.md', hash: hashOf('a'), bytes: 1 },
    { kind: 'write', path: 'Docs/README.md', hash: hashOf('b'), bytes: 1, expectedHash: hashOf('a') },
  ]);
  // A folder whose name only changed case is the same folder on Windows: nothing to create or remove.
  expect(planIntegration(manifest({ 'Docs/a.md': 'a' }, ['Docs']), manifest({ 'docs/a.md': 'a' }, ['docs']))).toEqual([]);
});

it('refuses a file replaced by a folder of the same name before anything changes, but still describes it', () => {
  const baseline = manifest({ notes: 'plain file' });
  const current = manifest({ 'notes/today.txt': 'plain file' }, ['notes']);
  expect(() => planIntegration(baseline, current)).toThrow(TYPE_CHANGE_REFUSAL);
  expect(() => planIntegration(current, baseline)).toThrow(TYPE_CHANGE_REFUSAL);
  expect(plainCopyDiff(baseline, current).files).toEqual([
    { path: 'notes/today.txt', previousPath: 'notes', status: 'renamed', binary: false, additions: 0, deletions: 0, truncated: false, hunks: [] },
  ]);
});

it('adds no folder steps for a snapshot saved before folders were recorded, and never the worktree pointer', () => {
  const legacy: WorkspaceManifest = { files: [file('note.txt', 'a')], omitted: [] };
  const current = manifest({ 'new/note.txt': 'a', '.git': 'gitdir: ../repository.git/worktrees/worktree' }, ['new', 'empty']);
  expect(planIntegration(legacy, current)).toEqual([{ kind: 'move', from: 'note.txt', path: 'new/note.txt', hash: hashOf('a'), bytes: 1 }]);
});

it('describes a plain copy file by file without lines, and summarizes moves, deletions and folders', () => {
  const diff = plainCopyDiff(inbox, tidied);
  expect(diff.lines).toBe(false);
  expect(diff.files.map(entry => [entry.path, entry.status, entry.previousPath ?? null])).toEqual([
    ['contract-old.pdf', 'deleted', null],
    ['contracts/2026-lease-draft.pdf', 'renamed', 'contract (1).pdf'],
    ['contracts/2026-lease.pdf', 'renamed', 'contract-final.pdf'],
    ['images/office-photo.jpg', 'renamed', 'IMG_0412.jpg'],
    ['notes.txt', 'deleted', null],
    ['notes/meeting-notes.txt', 'added', null],
    ['receipts/2026-03-receipt.pdf', 'renamed', 'receipt 3.pdf'],
  ]);
  expect(diff.folders).toEqual([
    { path: 'contracts', status: 'added' }, { path: 'images', status: 'added' },
    { path: 'notes', status: 'added' }, { path: 'receipts', status: 'added' },
  ]);
  expect(summarize(diff)).toEqual({ files: 7, additions: 0, deletions: 0, moved: 4, removed: 2, folders: 4, lines: false });
  expect(plainCopyDiff(inbox, inbox)).toEqual({ files: [], additions: 0, deletions: 0, truncated: false, lines: false });
});
