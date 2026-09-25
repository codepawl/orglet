import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { harnessPrompt, sourceForModel } from '../../apps/desktop/src/core/orchestration/runner';
import type { ModelReply, RunMessage } from '../../apps/desktop/src/core/adapters/openai';
import { cost } from '../../apps/desktop/src/core/budgets/ledger';
import type { Source, SourceBytes, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { INLINE_PREVIEW_LIMIT, MEDIA_SOURCE_LIMITS, mediaUnreadableNote, withheldSourceNote } from '../../apps/desktop/src/shared/source-kinds';
import { IMAGE_SEND_LIMIT, IMAGE_TOKEN_ALLOWANCE } from '../../apps/desktop/src/shared/images';
import { invoicePdf } from './pdf-fixture';

const MEGABYTE = 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// The PNG signature followed by filler: enough to be a file of that kind by name and to have a real hash.
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);

/** One request as the fake connection received it: the messages sent, the reservation it ran under, the checkpoints then. */
type SentRequest = { messages: RunMessage[]; reservationId?: string; checkpoints: string };
let directory: string; let store: Store; let core: CoreService;
let replies: ModelReply[]; let sent: SentRequest[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-media-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; sent = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, _tools, _signal, _progress, reservationId) {
      const checkpoints = JSON.stringify(store.db.prepare('SELECT data FROM checkpoints').all());
      sent.push({ messages: structuredClone(messages), reservationId, checkpoints });
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


/** The source list the worker was given, from the brief message: a JSON string inside the message list. */
function briefSources(request: SentRequest) {
  const briefMessage = request.messages.find(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('"sources"'))!;
  return (JSON.parse(briefMessage.content as string) as { sources: Record<string, unknown>[] }).sources;
}
const toolResult = (request: SentRequest) => request.messages.findLast(message => message.role === 'tool')!;
async function chatWith(provider: 'openai' | 'anthropic' | 'xai', sourceIds: string[], brief: string, modelId?: string) {
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider, ...(modelId ? { modelId } : {}) });
  const taskId = await core.command('createTask', { workerId: worker.id, brief, sourceIds, consent: true, providerScopes: [provider], budgetMicros: 100_000 }) as string;
  await until(() => ['completed', 'failed'].includes(store.detail(taskId).task.status));
  return store.detail(taskId);
}

describe('images for API connections (COD-260)', () => {
  it('show an image to a model that sees images: by hash in the checkpoint, as bytes only in the request', async () => {
    const image = join(directory, 'shot.png'); await writeFile(image, pngBytes);
    const [shot] = await core.sources.import([image]);
    replies.push(call('read_source', { sourceId: shot.id }), answer('A settings screen with two toggles.'));
    const detail = await chatWith('openai', [shot.id], 'What does this screenshot show?');
    expect(detail.task.status).toBe('completed');
    const listed = briefSources(sent[0])[0];
    expect(listed).toMatchObject({ id: shot.id, media: 'image', note: 'An image: read_source shows it to you.' });
    expect(listed).not.toHaveProperty('readable');
    // The first request carries no image; the one after read_source carries it on the tool result, with its bytes.
    expect(JSON.stringify(sent[0].messages)).not.toContain(pngBytes.toString('base64'));
    expect(toolResult(sent[1]).images).toEqual([{ hash: sha256(pngBytes), mime: 'image/png', data: pngBytes.toString('base64') }]);
    // What was saved for a resume holds the reference, never the bytes.
    expect(sent[1].checkpoints).toContain(sha256(pngBytes));
    expect(sent[1].checkpoints).not.toContain(pngBytes.toString('base64'));
    expect(JSON.stringify(detail)).not.toContain(pngBytes.toString('base64'));
    expect(detail.events.map(event => event.message)).toContain('Đã đọc shot.png');
  }, 20_000);

  it('hold each image at its token allowance in the amount reserved before a paid request', async () => {
    const image = join(directory, 'shot.png'); await writeFile(image, pngBytes);
    const [shot] = await core.sources.import([image]);
    replies.push(call('read_source', { sourceId: shot.id }), answer('A settings screen.'));
    await chatWith('openai', [shot.id], 'What does this screenshot show?');
    const held = sent.map(request => Number(store.db.prepare('SELECT amount FROM reservations WHERE id=?').get(request.reservationId!)!.amount));
    expect(held[1] - held[0]).toBeGreaterThanOrEqual(cost(IMAGE_TOKEN_ALLOWANCE, 0, 'openai'));
  }, 20_000);

  it('tell a model that cannot see images so, and never send it the bytes', async () => {
    const image = join(directory, 'shot.png'); await writeFile(image, pngBytes);
    const [shot] = await core.sources.import([image]);
    replies.push(call('read_source', { sourceId: shot.id }), answer('I cannot see that image.'));
    // xAI's catalog model, grok-3-mini, takes text only.
    const detail = await chatWith('xai', [shot.id], 'What does this screenshot show?');
    expect(detail.task.status).toBe('completed');
    const note = withheldSourceNote(shot, false)!;
    expect(note).toContain('cannot see images');
    expect(briefSources(sent[0])[0]).toMatchObject({ id: shot.id, readable: false, note });
    expect(JSON.parse(toolResult(sent[1]).content as string)).toMatchObject({ sourceId: shot.id, readable: false, error: note });
    expect(toolResult(sent[1])).not.toHaveProperty('images');
    expect(JSON.stringify(sent)).not.toContain(pngBytes.toString('base64'));
    expect(detail.events.map(event => event.message)).toContain('Tí không xem được ảnh shot.png: kết nối này không nhận ảnh.');
  }, 20_000);

  it('keep SVG, BMP and images over 5 MB from every model, with the reason', async () => {
    const vector = join(directory, 'logo.svg'); await writeFile(vector, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const big = await sparseFile('photo.jpg', IMAGE_SEND_LIMIT + 1);
    const [logo, photo] = await core.sources.import([vector, big]);
    expect(withheldSourceNote(logo, true)).toContain('SVG or BMP');
    expect(withheldSourceNote(photo, true)).toContain('over 5 MB');
    await expect(core.sources.readImage(logo.id, [logo.id])).rejects.toThrow('SVG, BMP');
    await expect(core.sources.readImage(photo.id, [photo.id])).rejects.toThrow('5 MB');
  });

  it('read an image for a request only while the chat allows it and the file is unchanged', async () => {
    const image = join(directory, 'shot.png'); await writeFile(image, pngBytes);
    const [shot] = await core.sources.import([image]);
    const reference = { hash: sha256(pngBytes), mime: 'image/png' as const };
    await expect(core.sources.imageData(reference, [shot.id])).resolves.toBe(pngBytes.toString('base64'));
    await expect(core.sources.imageData(reference, [])).rejects.toThrow('không còn trong nguồn được phép');
    await writeFile(image, Buffer.concat([pngBytes, Buffer.from([1])]));
    await expect(core.sources.imageData(reference, [shot.id])).rejects.toThrow('thay đổi');
    await writeFile(image, pngBytes);
    await core.command('revoke', { id: shot.id });
    await expect(core.sources.imageData(reference, [shot.id])).rejects.toThrow('không còn trong nguồn được phép');
  });
});

describe('PDFs for API connections (COD-260)', () => {
  it('hand the PDF text, page by page, to the model through read_source', async () => {
    const pdf = join(directory, 'invoice-acme.pdf'); await writeFile(pdf, invoicePdf());
    const [invoice] = await core.sources.import([pdf]);
    replies.push(call('read_source', { sourceId: invoice.id }), answer('Total due is 1.750.000 VND, due 30 Sep 2026.'));
    const detail = await chatWith('anthropic', [invoice.id], 'What is the total and when is it due?');
    expect(detail.task.status).toBe('completed');
    const listed = briefSources(sent[0])[0];
    expect(listed).toMatchObject({ id: invoice.id, media: 'pdf', note: expect.stringContaining('text layer') });
    expect(listed).not.toHaveProperty('readable');
    const result = JSON.parse(toolResult(sent[1]).content as string) as { content: string; coverage: string };
    expect(result.content.startsWith('[Page 1 of 1]\nINVOICE #2026-0917')).toBe(true);
    expect(result.content).toContain('Total due ............... 1.750.000 VND');
    expect(result.content).toContain('Due date: 30 Sep 2026');
    expect(result.coverage).toContain('1 of 1 pages have text');
    expect(detail.events.map(event => event.message)).toContain('Đã đọc invoice-acme.pdf');
  }, 20_000);
});

describe('what a worker is told about each kind', () => {
  it('reads text and PDFs, sees images only when it can, and never reads video or audio', async () => {
    const source = (name: string, media?: Source['media']): Source => ({ id: name, name, bytes: 10, hash: 'x', revoked: false, ...(media ? { media } : {}) });
    expect(sourceForModel(source('note.txt'))).not.toHaveProperty('readable');
    expect(sourceForModel(source('paper.pdf', 'pdf'))).not.toHaveProperty('readable');
    expect(sourceForModel(source('shot.png', 'image'), true)).not.toHaveProperty('readable');
    expect(sourceForModel(source('shot.png', 'image'))).toMatchObject({ readable: false, note: expect.stringContaining('cannot see images') });
    expect(sourceForModel(source('clip.mp4', 'video'), true)).toMatchObject({ readable: false, note: mediaUnreadableNote('video') });
    const image = join(directory, 'photo.png'); await writeFile(image, pngBytes);
    const [photo] = await core.sources.import([image]);
    // An image is never text: read and the harness text copy refuse it by name.
    await expect(core.sources.read(photo.id, [photo.id])).rejects.toThrow('không có văn bản để đọc');
    await expect(core.sources.readVerified(photo.id, [photo.id])).rejects.toThrow('không có văn bản để đọc');
  });

  it('list what a CLI was not given in its prompt, with the note it can repeat', () => {
    const prompt = harnessPrompt([], [{ sourceId: 'a', name: 'note.txt', file: 'sources/01-note.txt', format: 'text' }], undefined, false, false,
      [{ sourceId: 'b', name: 'clip.mp4', kind: 'video', note: mediaUnreadableNote('video') }]);
    expect(prompt).toContain('Attached but not readable by you');
    expect(prompt).toContain('clip.mp4');
    expect(prompt).toContain('never guess at its contents');
  });
});
