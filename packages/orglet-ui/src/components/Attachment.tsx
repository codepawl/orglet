import type { ReactNode } from 'react';
import './Attachment.css';

/** What a file is, as far as a glance needs to know. Read from the extension of its name. */
export type FileKind = 'image' | 'video' | 'audio' | 'document' | 'spreadsheet' | 'data' | 'code' | 'archive' | 'text' | 'file';

const kindsByExtension: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image', tiff: 'image', tif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document', pages: 'document', md: 'document', markdown: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', numbers: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
  json: 'data', jsonl: 'data', ndjson: 'data', parquet: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data', sqlite: 'data', db: 'data',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code', java: 'code',
  kt: 'code', swift: 'code', c: 'code', h: 'code', cpp: 'code', cs: 'code', php: 'code', sh: 'code', ps1: 'code', bat: 'code', html: 'code',
  css: 'code', sql: 'code',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', '7z': 'archive', rar: 'archive', bz2: 'archive', xz: 'archive',
  txt: 'text', log: 'text', text: 'text',
};

export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return kindsByExtension[name.slice(dot + 1).toLowerCase()] ?? 'file';
}

/** "12 KB", "1.4 MB": one decimal under ten, whole numbers above, formatted for `locale`. */
export function formatFileSize(bytes: number, locale?: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit]}`;
}

type Removal = { onRemove: () => void; removeLabel: string; removeIcon: ReactNode } | { onRemove?: undefined; removeLabel?: undefined; removeIcon?: undefined };

/**
 * A file attached to a message, as a card: the kind's `icon`, the name, and a `meta` line saying what it is and how
 * big. With `onOpen` the whole card is a button that opens the file (a sent message's files). With `onRemove` it has
 * a remove button that keeps its place and only shows on hover or a visible focus, so nothing shifts when the pointer
 * arrives. Every card is the same width, so a row of them reads as a row. It renders a list item; the parent is the
 * list.
 */
export function Attachment({ name, meta, icon, onOpen, onRemove, removeLabel, removeIcon }: {
  name: string;
  meta: string;
  icon: ReactNode;
  onOpen?: () => void;
} & Removal) {
  const body = <>
    <span className="org-attachment-icon" aria-hidden="true">{icon}</span>
    <span className="org-attachment-text">
      <span className="org-attachment-name">{name}</span>
      <span className="org-attachment-meta">{meta}</span>
    </span>
  </>;
  if (onOpen) return <li className="org-attachment">
    <button type="button" className="org-attachment-open" title={name} onClick={onOpen}>{body}</button>
  </li>;
  return <li className="org-attachment" title={name}>
    {body}
    {onRemove && <button type="button" className="org-attachment-remove" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>{removeIcon}</button>}
  </li>;
}
