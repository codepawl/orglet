import { File, FileArchive, FileCode, FileData, FileDocument, FileImage, FileSpreadsheet, FileText, X, type Icon } from './icons';
import { currentLocale, t, translated } from '../i18n';

/** What a file is, as far as a glance needs to know. Read from the extension of its name. */
export type FileKind = 'image' | 'document' | 'spreadsheet' | 'data' | 'code' | 'archive' | 'text' | 'file';

const kindsByExtension: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image', avif: 'image', tiff: 'image', tif: 'image',
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document', pages: 'document', md: 'document', markdown: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', numbers: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
  json: 'data', jsonl: 'data', ndjson: 'data', parquet: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data', sqlite: 'data', db: 'data',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code', java: 'code', kt: 'code', swift: 'code', c: 'code', h: 'code', cpp: 'code', cs: 'code', php: 'code', sh: 'code', ps1: 'code', bat: 'code', html: 'code', css: 'code', sql: 'code',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', '7z': 'archive', rar: 'archive', bz2: 'archive', xz: 'archive',
  txt: 'text', log: 'text', text: 'text',
};

const kindIcons: Record<FileKind, Icon> = { image: FileImage, document: FileDocument, spreadsheet: FileSpreadsheet, data: FileData, code: FileCode, archive: FileArchive, text: FileText, file: File };

const kindLabels: Record<FileKind, string> = translated({ image: 'Ảnh', document: 'Tài liệu văn bản', spreadsheet: 'Bảng tính', data: 'Dữ liệu', code: 'Mã nguồn', archive: 'Tệp nén', text: 'Văn bản thuần', file: 'Tệp khác' });

export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return kindsByExtension[name.slice(dot + 1).toLowerCase()] ?? 'file';
}

export function fileKindIcon(name: string): Icon {
  return kindIcons[fileKind(name)];
}

/** "12 KB", "1.4 MB": one decimal under ten, whole numbers above, in the interface language. */
export function fileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toLocaleString(currentLocale(), { maximumFractionDigits: digits })} ${units[unit]}`;
}

/**
 * A file attached to a message: the kind's icon, the name, and a line saying what it is and how big. The remove
 * button keeps its place and only shows on hover or a visible focus, so nothing shifts when the pointer arrives.
 * Renders a list item; the parent is the list (the composer strip, or a wrapping `.attachment-list`).
 */
export function Attachment({ name, bytes, onRemove, removeLabel }: { name: string; bytes?: number; onRemove?: () => void; removeLabel?: string }) {
  const kind = fileKind(name);
  const KindIcon = kindIcons[kind];
  const meta = bytes !== undefined ? `${kindLabels[kind]} · ${fileSize(bytes)}` : kindLabels[kind];
  return <li className={`attachment kind-${kind}`} title={name}>
    <span className="attachment-icon" aria-hidden="true"><KindIcon size={20} /></span>
    <span className="attachment-text">
      <span className="attachment-name">{name}</span>
      <span className="attachment-meta">{meta}</span>
    </span>
    {onRemove && <button type="button" className="attachment-remove" aria-label={removeLabel ?? t('Bỏ {0}', [name])} title={removeLabel ?? t('Bỏ {0}', [name])} onClick={onRemove}><X size={14} /></button>}
  </li>;
}
