/**
 * What kinds of file can be attached to a chat, and how large each may be. Text and datasets are what workers read;
 * media (images, video, audio, PDF) is preview-only for now: the person can look at it in Chat sources, and a
 * worker is told the file exists and that it cannot read that kind.
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';

const MEGABYTE = 1024 * 1024;

export const TEXT_SOURCE_LIMIT = 256 * 1024;
export const DATASET_SOURCE_LIMIT = 32 * MEGABYTE;
/** Per-kind attachment caps. Images are small by nature; recordings and documents are allowed to be long. */
export const MEDIA_SOURCE_LIMITS: Record<MediaKind, number> = {
  image: 20 * MEGABYTE,
  audio: 50 * MEGABYTE,
  video: 200 * MEGABYTE,
  pdf: 200 * MEGABYTE,
};
/** The most that is sent to the window for an inline preview; larger media opens in the default app instead. */
export const INLINE_PREVIEW_LIMIT = 64 * MEGABYTE;

const mediaByExtension: Record<string, { kind: MediaKind; mimeType: string }> = {
  png: { kind: 'image', mimeType: 'image/png' },
  jpg: { kind: 'image', mimeType: 'image/jpeg' },
  jpeg: { kind: 'image', mimeType: 'image/jpeg' },
  gif: { kind: 'image', mimeType: 'image/gif' },
  webp: { kind: 'image', mimeType: 'image/webp' },
  bmp: { kind: 'image', mimeType: 'image/bmp' },
  svg: { kind: 'image', mimeType: 'image/svg+xml' },
  mp4: { kind: 'video', mimeType: 'video/mp4' },
  webm: { kind: 'video', mimeType: 'video/webm' },
  mov: { kind: 'video', mimeType: 'video/mp4' },
  mp3: { kind: 'audio', mimeType: 'audio/mpeg' },
  wav: { kind: 'audio', mimeType: 'audio/wav' },
  ogg: { kind: 'audio', mimeType: 'audio/ogg' },
  m4a: { kind: 'audio', mimeType: 'audio/mp4' },
  pdf: { kind: 'pdf', mimeType: 'application/pdf' },
};

export const TEXT_SOURCE_EXTENSIONS = ['md', 'txt', 'json', 'jsonl', 'csv', 'parquet', 'ts', 'js', 'py', 'yaml', 'yml', 'log'];
export const MEDIA_SOURCE_EXTENSIONS = Object.keys(mediaByExtension);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function mediaKindOf(name: string): MediaKind | undefined {
  return mediaByExtension[extensionOf(name)]?.kind;
}

export function mediaMimeType(name: string): string {
  return mediaByExtension[extensionOf(name)]?.mimeType ?? 'application/octet-stream';
}

/** One line a worker can repeat to the user when asked about a media source. */
export function mediaUnreadableNote(kind: MediaKind): string {
  const noun = { image: 'an image', video: 'a video', audio: 'an audio recording', pdf: 'a PDF' }[kind];
  return `This source is ${noun}. Workers cannot read this kind of file yet; the user can view it in Chat sources. Do not guess at its contents.`;
}
