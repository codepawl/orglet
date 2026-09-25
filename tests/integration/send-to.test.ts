import { describe, expect, it } from 'vitest';
import type { Source, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { attachIntake, carriedDraft, FULL_MESSAGE_REASON } from '../../apps/desktop/src/shared/incoming';
import {
  importSentFiles,
  isPlainAbsolutePath,
  SEND_TO_ARGUMENTS,
  SEND_TO_SHORTCUT_NAME,
  SendToInstaller,
  SentFilesHandOff,
  SKIP_FOLDER,
  SKIP_FULL,
  SKIP_MISSING,
  SKIP_NOT_A_PATH,
  SKIP_UNSUPPORTED,
  type PathKind,
  type SentFileChecks,
  type ShortcutFiles,
  type ShortcutSpec,
} from '../../apps/desktop/src/main/send-to';
import { filterOptions, recentChats, sendToOptions } from '../../apps/desktop/src/renderer/sendTo';

// COD-246: files sent from Explorer are imported like picked files, with the same limits, and the Send to shortcut is
// added, pointed at the stable launcher and removed through fakes of the file system.

function source(name: string): Source {
  return { id: `source-${name}`, name, bytes: 10, hash: 'hash', revoked: false };
}

/** A machine where every path is a file unless listed otherwise, and the import refuses the names given. */
function fakeMachine(kinds: Record<string, PathKind> = {}, refuse: Record<string, string> = {}) {
  const imported: string[] = [];
  const checks: SentFileChecks = {
    kindOf: async path => kinds[path] ?? 'file',
    importFile: async path => {
      const name = path.split('\\').at(-1)!;
      if (refuse[name]) throw new Error(refuse[name]);
      imported.push(path);
      return source(name);
    },
  };
  return { checks, imported };
}

describe('files sent from Explorer', () => {
  it('imports supported files and lists the rest as skipped with the reason', async () => {
    const machine = fakeMachine({ 'C:\\Photos': 'folder', 'C:\\gone.txt': 'missing' }, { 'huge.txt': 'Chỉ đọc tệp văn bản tối đa 256 KB.' });
    const intake = await importSentFiles(['C:\\notes.md', 'C:\\Photos', 'C:\\gone.txt', 'C:\\setup.exe', 'C:\\huge.txt', 'report.csv', 'C:\\data.csv'], machine.checks);
    expect(intake.sources.map(item => item.name)).toEqual(['notes.md', 'data.csv']);
    expect(intake.skipped).toEqual([
      { name: 'Photos', reason: SKIP_FOLDER },
      { name: 'gone.txt', reason: SKIP_MISSING },
      { name: 'setup.exe', reason: SKIP_UNSUPPORTED },
      { name: 'huge.txt', reason: 'Chỉ đọc tệp văn bản tối đa 256 KB.' },
      { name: 'report.csv', reason: SKIP_NOT_A_PATH },
    ]);
  });

  it('stops at 20 files, like the file picker, and names the rest', async () => {
    const machine = fakeMachine();
    const paths = Array.from({ length: 23 }, (_, index) => `C:\\files\\note-${index}.txt`);
    const intake = await importSentFiles(paths, machine.checks);
    expect(intake.sources).toHaveLength(20);
    expect(intake.skipped).toEqual([20, 21, 22].map(index => ({ name: `note-${index}.txt`, reason: SKIP_FULL })));
    expect(machine.imported).toHaveLength(20);
  });

  it('counts the same file named twice once', async () => {
    const machine = fakeMachine();
    const intake = await importSentFiles(['C:\\a.txt', 'c:\\A.TXT', 'C:\\folder\\..\\a.txt'], machine.checks);
    expect(intake.sources).toHaveLength(1);
    expect(intake.skipped).toEqual([]);
  });

  it('accepts only plain absolute paths', () => {
    expect(isPlainAbsolutePath('C:\\Users\\An\\a.txt')).toBe(true);
    expect(isPlainAbsolutePath('\\\\server\\share\\a.txt')).toBe(true);
    expect(isPlainAbsolutePath('a.txt')).toBe(false);
    expect(isPlainAbsolutePath('\\\\?\\C:\\a.txt')).toBe(false);
    expect(isPlainAbsolutePath('\\\\.\\pipe\\x')).toBe(false);
    expect(isPlainAbsolutePath('C:\\a\0.txt')).toBe(false);
  });
});

describe('the hand-off to the window', () => {
  it('gives the window an id and names, and the paths only once for that id', () => {
    const handOff = new SentFilesHandOff();
    const offered = handOff.offer(['C:\\Notes\\a.txt', 'C:\\Notes\\b.csv', 'c:\\notes\\A.txt']);
    expect(offered).toMatchObject({ kind: 'files', count: 2, names: ['a.txt', 'b.csv'] });
    expect(JSON.stringify(offered)).not.toContain('Notes');
    expect(handOff.take(offered.id)).toEqual(['C:\\Notes\\a.txt', 'C:\\Notes\\b.csv']);
    expect(handOff.take(offered.id)).toBeUndefined();
  });

  it('keeps only the newest Send to, and forgets one the person closed', () => {
    const handOff = new SentFilesHandOff();
    const first = handOff.offer(['C:\\a.txt']);
    const second = handOff.offer(['C:\\b.txt']);
    expect(handOff.take(first.id)).toBeUndefined();
    handOff.drop(second.id);
    expect(handOff.take(second.id)).toBeUndefined();
  });
});

describe('what the message box ends up holding', () => {
  it('adds the files to the ones already there, without repeats, and skips what does not fit', () => {
    const current = Array.from({ length: 18 }, (_, index) => source(`old-${index}.txt`));
    const intake = { sources: [source('old-0.txt'), source('a.txt'), source('b.txt'), source('c.txt')], skipped: [{ name: 'x.exe', reason: SKIP_UNSUPPORTED }] };
    const merged = attachIntake(current, intake);
    expect(merged.sources).toHaveLength(20);
    expect(merged.sources.slice(-2).map(item => item.name)).toEqual(['a.txt', 'b.txt']);
    expect(merged.skipped).toEqual([{ name: 'x.exe', reason: SKIP_UNSUPPORTED }, { name: 'c.txt', reason: FULL_MESSAGE_REASON }]);
  });
});

describe('a draft when the window switches to a live chat', () => {
  it('moves the text and the files to the next message, with the skipped list', () => {
    const draft = { text: 'Summarise these', sources: [source('a.txt')], skipped: [{ name: 'x.exe', reason: SKIP_UNSUPPORTED }] };
    expect(carriedDraft(draft)).toEqual({ text: 'Summarise these', intake: { sources: [source('a.txt')], skipped: [{ name: 'x.exe', reason: SKIP_UNSUPPORTED }] } });
  });

  it('moves text alone, and a skipped list without files does not travel', () => {
    expect(carriedDraft({ text: 'hello', sources: [], skipped: [{ name: 'x.exe', reason: SKIP_UNSUPPORTED }] })).toEqual({ text: 'hello' });
  });

  it('carries nothing for an empty or blank box', () => {
    expect(carriedDraft({ text: '  \n', sources: [], skipped: [] })).toEqual({});
  });
});

/** A SendTo folder held in memory. */
function fakeShortcuts() {
  const files = new Map<string, ShortcutSpec>();
  const shortcuts: ShortcutFiles = {
    read: path => files.get(path),
    write: async (path, shortcut) => { files.set(path, shortcut); },
    remove: async path => { files.delete(path); },
  };
  return { files, shortcuts };
}

describe('the Send to shortcut', () => {
  const folder = 'C:\\Users\\An\\AppData\\Roaming\\Microsoft\\Windows\\SendTo';
  const stub = 'C:\\Users\\An\\AppData\\Local\\Orglet\\Orglet.exe';

  it('points at the stable launcher with the Send to flag, and goes away again', async () => {
    const { files, shortcuts } = fakeShortcuts();
    const installer = new SendToInstaller(folder, stub, shortcuts);
    expect(installer.isInstalled()).toBe(false);
    await installer.install();
    const written = files.get(`${folder}\\${SEND_TO_SHORTCUT_NAME}`) ?? files.get(`${folder}/${SEND_TO_SHORTCUT_NAME}`);
    expect(written).toMatchObject({ target: stub, args: SEND_TO_ARGUMENTS, icon: stub });
    expect(SEND_TO_ARGUMENTS).toBe('--orglet-send-to --');
    expect(installer.isInstalled()).toBe(true);
    await installer.remove();
    expect(installer.isInstalled()).toBe(false);
    expect(files.size).toBe(0);
  });

  it('is repointed on start when an older build wrote it, and never added back on start', async () => {
    const { files, shortcuts } = fakeShortcuts();
    const older = new SendToInstaller(folder, 'D:\\Orglet-old\\Orglet.exe', shortcuts);
    await older.install();
    const current = new SendToInstaller(folder, stub, shortcuts);
    await current.refresh();
    expect([...files.values()][0].target).toBe(stub);
    await current.remove();
    await current.refresh();
    expect(files.size).toBe(0);
  });

  it('is left alone on start when it already points here', async () => {
    const { shortcuts } = fakeShortcuts();
    let writes = 0;
    const counting: ShortcutFiles = { ...shortcuts, write: async (path, shortcut) => { writes += 1; await shortcuts.write(path, shortcut); } };
    const installer = new SendToInstaller(folder, stub, counting);
    await installer.install();
    await installer.refresh();
    expect(writes).toBe(1);
  });
});

describe('the picker list', () => {
  const researcher = { id: 'w1', name: 'Researcher', description: 'Reads and sums up' } as Worker;
  const accountant = { id: 'w2', name: 'Kế toán' } as Worker;
  const crew = { id: 't1', name: 'Review crew', memberIds: ['w1'], synthesizerId: 'w2' } as Team;
  const task = (id: string, createdAt: string, extra: Partial<Task> = {}) => ({ id, brief: `brief ${id}`, workerId: 'w1', createdAt, ...extra }) as Task;
  const workspace = {
    workers: [researcher, accountant],
    teams: [crew],
    tasks: [
      task('old', '2026-09-01T00:00:00Z'),
      task('seen', '2026-09-02T00:00:00Z', { seenAt: '2026-09-24T00:00:00Z', title: 'Invoices' }),
      task('new', '2026-09-20T00:00:00Z'),
      task('gone', '2026-09-25T00:00:00Z', { deletedAt: '2026-09-25T01:00:00Z' }),
      task('shelved', '2026-09-25T00:00:00Z', { archivedAt: '2026-09-25T01:00:00Z' }),
      task('crew', '2026-09-10T00:00:00Z', { teamId: 't1', workerId: 'w2' }),
    ],
  };

  it('puts the chats last opened first, then every orglet and crew with their faces', () => {
    expect(recentChats(workspace).map(item => item.id)).toEqual(['seen', 'new', 'crew']);
    const options = sendToOptions(workspace);
    expect(options.map(option => `${option.group}:${option.name}`)).toEqual([
      'recent:Invoices', 'recent:brief new', 'recent:brief crew', 'orglets:Researcher', 'orglets:Kế toán', 'crews:Review crew',
    ]);
    expect(options.find(option => option.group === 'crews')?.faces.map(worker => worker.id)).toEqual(['w1', 'w2']);
    expect(options.find(option => option.name === 'brief crew')?.target).toEqual({ kind: 'task', id: 'crew' });
  });

  it('narrows by name without regard to case or accents', () => {
    const options = sendToOptions(workspace);
    expect(filterOptions(options, 'ke toan').map(option => option.name)).toEqual(['Kế toán', 'Review crew']);
  });
});
