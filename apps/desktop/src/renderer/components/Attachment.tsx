import { File, FileArchive, FileAudio, FileCode, FileData, FileDocument, FileImage, FileSpreadsheet, FileText, FileVideo, X, type Icon } from './icons';
import { currentLocale, t, translated } from '../i18n';
import { Attachment as KitAttachment, fileKind, formatFileSize, type FileKind } from '@codepawl/orglet-ui';

export { fileKind, type FileKind } from '@codepawl/orglet-ui';

const kindIcons: Record<FileKind, Icon> = { image: FileImage, video: FileVideo, audio: FileAudio, document: FileDocument, spreadsheet: FileSpreadsheet, data: FileData, code: FileCode, archive: FileArchive, text: FileText, file: File };

const kindLabels: Record<FileKind, string> = translated({ image: 'Ảnh', video: 'Video', audio: 'Âm thanh', document: 'Tài liệu văn bản', spreadsheet: 'Bảng tính', data: 'Dữ liệu', code: 'Mã nguồn', archive: 'Tệp nén', text: 'Văn bản thuần', file: 'Tệp khác' });

/** "Ảnh", "Mã nguồn": the kind's label in the interface language. */
export function fileKindLabel(name: string): string {
  return kindLabels[fileKind(name)];
}

export function fileKindIcon(name: string): Icon {
  return kindIcons[fileKind(name)];
}

/** "12 KB", "1.4 MB" in the interface language. */
export function fileSize(bytes: number): string {
  return formatFileSize(bytes, currentLocale());
}

/**
 * A file attached to a message, drawn by the kit's card (COD-274) with the app's own file-kind icons and words: the
 * kind and size on the meta line, "Remove {name}" on the remove button.
 */
export function Attachment({ name, bytes, onRemove, onOpen, removeLabel }: { name: string; bytes?: number; onRemove?: () => void; onOpen?: () => void; removeLabel?: string }) {
  const kind = fileKind(name);
  const KindIcon = kindIcons[kind];
  const meta = bytes !== undefined ? `${kindLabels[kind]} · ${fileSize(bytes)}` : kindLabels[kind];
  const icon = <KindIcon size={20} />;
  if (onRemove) {
    return <KitAttachment name={name} meta={meta} icon={icon} onOpen={onOpen} onRemove={onRemove}
      removeLabel={removeLabel ?? t('Bỏ {0}', [name])} removeIcon={<X size={14} />} />;
  }
  return <KitAttachment name={name} meta={meta} icon={icon} onOpen={onOpen} />;
}
