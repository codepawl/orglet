import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { harnessPrompt, sourceForModel } from '../../apps/desktop/src/core/orchestration/runner';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Source, SourceBytes, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { INLINE_PREVIEW_LIMIT, MEDIA_SOURCE_LIMITS, mediaUnreadableNote } from '../../apps/desktop/src/shared/source-kinds';

const MEGABYTE = 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// The PNG signature followed by filler: enough to be a file of that kind by name and to have a real hash.
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);

let directory: string; let store: Store; let core: CoreService;
let replies: ModelReply[]; let sent: { messages: unknown[] }[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-media-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; sent = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages) {
      sent.push({ messages: structuredClone(messages) });
      const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply;
    },
  }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

/** A file of `size` bytes without writing them all: the tail is zero-filled by the file system. */
async function sparseFile(name: string, size: number) {
  const path = join(directory, name);
  await writeFile(path, Buffer.from('head'));
  await truncate(path, size);
  return path;
}
function taskWith(sourceIds: string[]): Task {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), brief: 'Look', workerId: worker.id, sourceIds, consent: false, budgetMicros: 10000, createdAt: now(), status: 'queued', accepted: false };
  store.put('tasks', task);
  return task;
}
const call = (name: string, args: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(args) }], usage: { input: 200, output: 50 } });
const answer = (message: string): ModelReply => call('reply', { message, knowledgeProposals: [] });
const until = async (check: () => boolean) => { for (let tries = 0; tries < 300 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };

describe('attaching media', () => {
  it('accepts images, video, audio and PDF by kind, with a streamed hash and no text checks', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const video = join(directory, 'clip.mp4'); await writeFile(video, Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0]));
    const audio = join(directory, 'voice.mp3'); await writeFile(audio, Buffer.from([0xff, 0xfb, 0x90, 0, 0]));
    const pdf = join(directory, 'paper.pdf'); await writeFile(pdf, Buffer.from('%PDF-1.4\n\0binary\n%%EOF'));
    const [photo, clip, voice, paper] = await core.sources.import([image, video, audio, pdf]);
    expect(photo).toMatchObject({ name: 'photo.png', media: 'image', bytes: pngBytes.length, hash: sha256(pngBytes), revoked: false });
    expect(photo.format).toBeUndefined();
    expect(clip.media).toBe('video'); expect(voice.media).toBe('audio'); expect(paper.media).toBe('pdf');
    expect(paper.hash).toBe(sha256(await readFile(pdf)));
  });

  it('refuses media over its kind cap and keeps the text and dataset limits as they were', async () => {
    const bigImage = await sparseFile('huge.png', MEDIA_SOURCE_LIMITS.image + 1);
    await expect(core.sources.import([bigImage])).rejects.toThrow('20 MB');
    const bigAudio = await sparseFile('long.wav', MEDIA_SOURCE_LIMITS.audio + 1);
    await expect(core.sources.import([bigAudio])).rejects.toThrow('50 MB');
    const bigVideo = await sparseFile('film.mp4', MEDIA_SOURCE_LIMITS.video + 1);
    await expect(core.sources.import([bigVideo])).rejects.toThrow('200 MB');
    const text = join(directory, 'notes.txt'); await writeFile(text, Buffer.alloc(300_000, 65));
    await expect(core.sources.import([text])).rejects.toThrow('256');
    const binary = join(directory, 'blob.bin'); await writeFile(binary, Buffer.from([0, 1, 2]));
    await expect(core.sources.import([binary])).rejects.toThrow('nhị phân');
    const dataset = await sparseFile('rows.csv', 32 * MEGABYTE + 1);
    await expect(core.sources.import([dataset])).rejects.toThrow('32 MB');
  });

  it('lists the picked path for the person and never puts it in the source record', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const [photo] = await core.sources.import([image]);
    const task = taskWith([photo.id]);
    expect(await core.command('sourceOrigins', { taskId: task.id })).toEqual([{ id: photo.id, path: resolve(image) }]);
    expect(JSON.stringify(store.get<Source>('sources', photo.id))).not.toContain(directory);
  });
});

describe('media preview bytes', () => {
  it('serve verified bytes behind the task, revoke and hash gate', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const [photo] = await core.sources.import([image]);
    const task = taskWith([photo.id]);
    const served = await core.command('sourceBytes', { taskId: task.id, id: photo.id }) as SourceBytes;
    expect(served.name).toBe('photo.png'); expect(served.mimeType).toBe('image/png');
    expect(Buffer.from(served.bytes).equals(pngBytes)).toBe(true);
    const other = taskWith([]);
    await expect(core.command('sourceBytes', { taskId: other.id, id: photo.id })).rejects.toThrow('quyền');
    expect(core.sourcePath({ taskId: task.id, id: photo.id })).toBe(resolve(image));
    expect(() => core.sourcePath({ taskId: other.id, id: photo.id })).toThrow('quyền');
    await writeFile(image, Buffer.concat([pngBytes, Buffer.from([1])]));
    await expect(core.command('sourceBytes', { taskId: task.id, id: photo.id })).rejects.toThrow('thay đổi');
    await writeFile(image, pngBytes);
    await core.command('revoke', { id: photo.id });
    await expect(core.command('sourceBytes', { taskId: task.id, id: photo.id })).rejects.toThrow('thu hồi');
    expect(() => core.sourcePath({ taskId: task.id, id: photo.id })).toThrow('thu hồi');
  });

  it('refuse text sources, and media past the inline limit while still verifying it by streamed hash', async () => {
    const text = join(directory, 'notes.txt'); await writeFile(text, 'plain');
    const video = await sparseFile('long.mp4', INLINE_PREVIEW_LIMIT + 1);
    const [notes, clip] = await core.sources.import([text, video]);
    const task = taskWith([notes.id, clip.id]);
    await expect(core.command('sourceBytes', { taskId: task.id, id: notes.id })).rejects.toThrow('văn bản');
    await expect(core.command('sourceBytes', { taskId: task.id, id: clip.id })).rejects.toThrow('64 MB');
    await expect(core.sources.verify(clip.id, task.sourceIds)).resolves.toBeUndefined();
    await expect(core.command('previewSource', { taskId: task.id, id: clip.id })).rejects.toThrow('chưa đọc được');
  }, 60_000);
});

describe('workers and media', () => {
  it('tell the model the file exists and cannot be read, and answer a read_source for it without failing the run', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const [photo] = await core.sources.import([image]);
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    replies.push(call('read_source', { sourceId: photo.id }), answer('Mình không xem được ảnh này.'));
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Ảnh này là gì?', sourceIds: [photo.id], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 }) as string;
    await until(() => ['completed', 'failed'].includes(store.detail(taskId).task.status));
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    // The brief message is a JSON string inside the message list, so it is parsed back before looking inside.
    const briefMessage = (sent[0].messages as { role: string; content: string }[]).find(message => message.role === 'user' && message.content.includes('"sources"'))!;
    const manifest = JSON.parse(briefMessage.content) as { sources: Record<string, unknown>[] };
    expect(manifest.sources[0]).toMatchObject({ id: photo.id, media: 'image', readable: false, note: mediaUnreadableNote('image') });
    expect(JSON.stringify(sent)).not.toContain(pngBytes.toString('base64'));
    const toolMessage = sent[1].messages.at(-1) as { role: string; content: string };
    expect(toolMessage.role).toBe('tool');
    expect(JSON.parse(toolMessage.content)).toMatchObject({ sourceId: photo.id, readable: false, error: expect.stringContaining('cannot read this kind of file') });
    expect(detail.events.map(event => event.message)).toContainEqual(expect.stringContaining('chưa đọc được'));
  }, 20_000);

  it('are refused the bytes of a media source through every read path', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const [photo] = await core.sources.import([image]);
    await expect(core.sources.read(photo.id, [photo.id])).rejects.toThrow('chưa đọc được');
    await expect(core.sources.readVerified(photo.id, [photo.id])).rejects.toThrow('chưa đọc được');
  });

  it('see media in a harness prompt as attached but unreadable, with no copy listed', () => {
    const prompt = harnessPrompt([], [{ sourceId: 'a', name: 'note.txt', file: 'sources/01-note.txt', format: 'text' }], undefined, false, false,
      [{ sourceId: 'b', name: 'photo.png', kind: 'image', note: mediaUnreadableNote('image') }]);
    expect(prompt).toContain('Attached but not readable by you');
    expect(prompt).toContain('photo.png');
    expect(prompt).toContain('never guess at its contents');
    expect(sourceForModel({ id: 'b', name: 'photo.png', bytes: 1, hash: 'x', revoked: false, media: 'image' })).toMatchObject({ readable: false, note: mediaUnreadableNote('image') });
    expect(sourceForModel({ id: 'a', name: 'note.txt', bytes: 1, hash: 'x', revoked: false })).not.toHaveProperty('readable');
  });
});
