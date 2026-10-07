import { useId, useState, type ReactNode } from 'react';
import { Tabs } from '@codepawlhq/orglet-ui';
import type { Source, SourceBytes } from '../../shared/contracts';
import type { MediaKind } from '../../shared/source-kinds';
import { t } from '../i18n';
import { Markdown } from './Markdown';
import { CodePreview } from './CodePreview';
import { TablePreview } from './TablePreview';
import { JsonPreview } from './JsonPreview';
import { MediaPreview } from './MediaPreview';
import { PdfPreview } from './PdfPreview';
import { PreviewBar } from './PreviewBar';
import { languageOf } from './highlight';

/** How a source is shown. Media comes from the core's `media`; text kinds come from the name. */
export type PreviewKind = MediaKind | 'markdown' | 'code' | 'text' | 'csv' | 'tsv' | 'json' | 'jsonl' | 'parquet';

export function previewKindOf(source: Pick<Source, 'name' | 'format' | 'media'>): PreviewKind {
  if (source.media) return source.media;
  if (source.format === 'parquet') return 'parquet';
  if (source.format === 'csv') return 'csv';
  if (source.format === 'jsonl') return 'jsonl';
  const dot = source.name.lastIndexOf('.');
  const extension = dot > 0 ? source.name.slice(dot + 1).toLowerCase() : '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'json') return 'json';
  if (extension === 'tsv') return 'tsv';
  if (extension === 'csv') return 'csv';
  if (extension === 'jsonl' || extension === 'ndjson') return 'jsonl';
  if (languageOf(source.name) !== 'text') return 'code';
  return 'text';
}

/**
 * Picks the previewer for a source's content. Text kinds take `text`; media kinds take `media`. Markdown renders
 * as a document and can flip to its source; a citation opens the source view directly, since lines are what it
 * points at.
 */
export function SourcePreview({ name, kind, text, media, citedLines, openExternally }: { name: string; kind: PreviewKind; text?: string; media?: SourceBytes; citedLines?: [number, number]; openExternally?: ReactNode }) {
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const markdownTabsId = useId();
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    if (!media) return null;
    return <MediaPreview kind={kind} bytes={media.bytes} mimeType={media.mimeType} name={name} />;
  }
  if (kind === 'pdf') {
    if (!media) return null;
    return <PdfPreview bytes={media.bytes} name={name} fallback={<p className="preview-state">{t('Không mở được PDF này trong Orglet.')} {openExternally}</p>} />;
  }
  if (text === undefined) return null;
  if (kind === 'markdown') {
    const asSource = showMarkdownSource || citedLines !== undefined;
    return <div className="markdown-preview">
      <PreviewBar summary={t('Tài liệu Markdown')}>
        <Tabs id={markdownTabsId} className="preview-tabs" label={t('Cách xem Markdown')} value={asSource ? 'source' : 'rendered'}
          tabs={[{ id: 'rendered', label: t('Trình bày') }, { id: 'source', label: t('Văn bản gốc') }]}
          onChange={next => setShowMarkdownSource(next === 'source')} />
      </PreviewBar>
      {asSource ? <CodePreview text={text} language="text" citedLines={citedLines} /> : <Markdown className="source-preview source-document" text={text} />}
    </div>;
  }
  if (kind === 'csv') return <TablePreview text={text} delimiter="," />;
  if (kind === 'tsv') return <TablePreview text={text} delimiter={'\t'} />;
  if (kind === 'json') return <JsonPreview text={text} lines={false} />;
  if (kind === 'jsonl') return <JsonPreview text={text} lines={true} />;
  return <CodePreview text={text} language={kind === 'code' ? languageOf(name) : 'text'} citedLines={citedLines} toolbar />;
}
