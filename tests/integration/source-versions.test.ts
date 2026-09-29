import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { editedSourcesDirectory } from '../../apps/desktop/src/core/tools/sources';
import type { Source, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import { isVersionNameFor, versionName } from '../../apps/desktop/src/shared/source-versions';
import { pngSize } from '../../apps/desktop/src/shared/png';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** A real PNG of `width` × `height` grey pixels, so its header can be read back after a save. */
function pngOf(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height, 128);
  for (let row = 0; row < height; row += 1) rows[row * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let directory: string;
let store: Store;
let core: CoreService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-versions-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => ({ async request() { throw new Error('No model in this test'); } }));
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

function chatWith(sourceIds: string[]): Task {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), brief: 'Look', workerId: worker.id, sourceIds, consent: false, budgetMicros: 10000, createdAt: now(), status: 'completed', accepted: false };
  store.put('tasks', task);
  return task;
}

async function attach(name: string, content: Buffer | string): Promise<{ source: Source; path: string }> {
  const path = join(directory, name);
  await writeFile(path, content);
  const [source] = await core.sources.import([path]);
  return { source, path };
}

const save = (args: Record<string, unknown>) => core.command('saveSourceVersion', args) as Promise<Source>;

describe('naming an edited version', () => {
  it('adds the edit word before the extension and counts on without nesting', () => {
    expect(versionName('invoice.png', [], 'edited')).toBe('invoice (edited).png');
    expect(versionName('invoice.png', ['Invoice (Edited).png'], 'edited')).toBe('invoice (edited 2).png');
    expect(versionName('invoice (edited).png', ['invoice (edited).png'], 'edited')).toBe('invoice (edited 2).png');
    expect(versionName('invoice (edited 2).png', ['invoice (edited).png', 'invoice (edited 2).png'], 'edited')).toBe('invoice (edited 3).png');
    expect(versionName('photo.jpg', [], 'đã sửa', 'png')).toBe('photo (đã sửa).png');
    expect(versionName('docs/readme.md', [], 'edited')).toBe('docs/readme (edited).md');
    expect(versionName('Makefile', [], 'edited')).toBe('Makefile (edited)');
  });

  it('accepts only a plain name in the same folder with the expected extension', () => {
    expect(isVersionNameFor('notes.md', 'notes (edited).md')).toBe(true);
    expect(isVersionNameFor('docs/notes.md', 'docs/notes (edited).md')).toBe(true);
    expect(isVersionNameFor('notes.md', 'notes (edited).txt')).toBe(false);
    expect(isVersionNameFor('notes.md', '../notes.md')).toBe(false);
    expect(isVersionNameFor('notes.md', 'other/notes.md')).toBe(false);
    expect(isVersionNameFor('notes.md', 'no:tes.md')).toBe(false);
    expect(isVersionNameFor('photo.jpg', 'photo (edited).png', 'png')).toBe(true);
    expect(isVersionNameFor('photo.jpg', 'photo (edited).jpg', 'png')).toBe(false);
  });
});

describe('saving an edit as a new source', () => {
  it('keeps the original file and adds a linked copy to the chat without sending it', async () => {
    const { source: original, path } = await attach('notes.md', '# Notes\nFirst line.\n');
    const chat = chatWith([original.id]);
    chat.currentInput = { brief: 'Look', sourceIds: [original.id] };
    store.put('tasks', chat);
    const edited = await save({ taskId: chat.id, sourceId: original.id, name: 'notes (edited).md', text: '# Notes\nFirst line, fixed.\n' });

    expect(edited).toMatchObject({ name: 'notes (edited).md', editedFrom: original.id, revoked: false, hash: sha256('# Notes\nFirst line, fixed.\n') });
    expect(edited.id).not.toBe(original.id);
    expect(await readFile(path, 'utf8')).toBe('# Notes\nFirst line.\n');
    expect(store.get<Source>('sources', original.id).hash).toBe(original.hash);

    const detail = await core.command('task', { id: chat.id }) as TaskDetail;
    expect(detail.task.sourceIds).toEqual([original.id, edited.id]);
    // The next message carries what the last one carried; the edit goes only when the person attaches it.
    expect(detail.task.currentInput?.sourceIds).toEqual([original.id]);
    const preview = await core.command('previewSource', { taskId: chat.id, id: edited.id }) as { text: string };
    expect(preview.text).toBe('# Notes\nFirst line, fixed.\n');

    const origins = await core.command('sourceOrigins', { taskId: chat.id }) as { id: string; path: string }[];
    const copyPath = origins.find(origin => origin.id === edited.id)!.path;
    expect(copyPath.startsWith(editedSourcesDirectory(store)!)).toBe(true);
  });

  it('keeps a first message and its runs to the files they had, so the edit is not sent or shown as sent', async () => {
    const { source: original } = await attach('brief.txt', 'draft');
    const chat = chatWith([original.id]);
    const runId = id();
    store.put('runs', { id: runId, taskId: chat.id, status: 'completed', snapshot: {}, startedAt: now(), error: null } as never, { column: 'task_id', value: chat.id });
    const edited = await save({ taskId: chat.id, sourceId: original.id, name: 'brief (edited).txt', text: 'final' });
    const detail = await core.command('task', { id: chat.id }) as TaskDetail;
    expect(detail.task.sourceIds).toEqual([original.id, edited.id]);
    expect(detail.task.currentInput).toMatchObject({ brief: 'Look', sourceIds: [original.id] });
    expect(detail.runs.find(run => run.id === runId)?.snapshot.input?.sourceIds).toEqual([original.id]);
  });

  it('saves an image as PNG bytes that keep their size, and refuses anything else', async () => {
    const { source: original } = await attach('screen.png', pngOf(40, 30));
    const chat = chatWith([original.id]);
    const cropped = pngOf(24, 12);
    const edited = await save({ taskId: chat.id, sourceId: original.id, name: 'screen (edited).png', bytes: new Uint8Array(cropped) });
    expect(edited).toMatchObject({ media: 'image', bytes: cropped.length, hash: sha256(cropped), editedFrom: original.id });
    const shown = await core.command('sourceBytes', { taskId: chat.id, id: edited.id }) as { bytes: Uint8Array; mimeType: string };
    expect(shown.mimeType).toBe('image/png');
    expect(pngSize(shown.bytes)).toEqual({ width: 24, height: 12 });

    await expect(save({ taskId: chat.id, sourceId: original.id, name: 'screen (edited 2).png', bytes: new Uint8Array(Buffer.from('GIF89a')) })).rejects.toThrow('PNG');
    await expect(save({ taskId: chat.id, sourceId: original.id, name: 'screen (edited 2).png', text: 'hello' })).rejects.toThrow('PNG');
    await expect(save({ taskId: chat.id, sourceId: original.id, name: '../escape.png', bytes: new Uint8Array(cropped) })).rejects.toThrow('PNG');
  });

  it('refuses a source outside the chat, a revoked one, a changed kind and video', async () => {
    const { source: inside } = await attach('inside.txt', 'inside');
    const { source: outside } = await attach('outside.txt', 'outside');
    const { source: clip } = await attach('clip.mp4', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]));
    const chat = chatWith([inside.id, clip.id]);
    await expect(save({ taskId: chat.id, sourceId: outside.id, name: 'outside (edited).txt', text: 'x' })).rejects.toThrow('Không có quyền');
    await expect(save({ taskId: chat.id, sourceId: inside.id, name: 'inside (edited).md', text: 'x' })).rejects.toThrow('loại tệp gốc');
    await expect(save({ taskId: chat.id, sourceId: clip.id, name: 'clip (edited).mp4', bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow('Chưa sửa được');
    await core.command('revoke', { id: inside.id });
    await expect(save({ taskId: chat.id, sourceId: inside.id, name: 'inside (edited).txt', text: 'x' })).rejects.toThrow('thu hồi');
    expect(store.all<Source>('sources').some(source => source.editedFrom)).toBe(false);
    // A refused save leaves no half-written copy behind.
    const copies = editedSourcesDirectory(store)!;
    expect(existsSync(copies) ? await readdir(copies) : []).toEqual([]);
  });

  it('lets an edited copy be edited again and backed up, and erasing sources deletes the copies', async () => {
    const { source: original } = await attach('plan.txt', 'one');
    const chat = chatWith([original.id]);
    const first = await save({ taskId: chat.id, sourceId: original.id, name: 'plan (edited).txt', text: 'two' });
    const second = await save({ taskId: chat.id, sourceId: first.id, name: 'plan (edited 2).txt', text: 'three' });
    expect(second.editedFrom).toBe(first.id);
    expect(() => core.backups.preview(core.backups.export())).not.toThrow();
    const copies = editedSourcesDirectory(store)!;
    expect(existsSync(join(copies, first.id, 'plan (edited).txt'))).toBe(true);
    await core.command('eraseData', { scope: 'sources' });
    expect(existsSync(copies)).toBe(false);
    expect(await readFile(join(directory, 'plan.txt'), 'utf8')).toBe('one');
  });
});
