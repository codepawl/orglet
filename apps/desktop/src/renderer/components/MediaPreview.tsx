import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { currentLocale, t } from '../i18n';
import { PreviewBar, PreviewIconButton } from './PreviewBar';
import type { MediaKind } from '../../shared/source-kinds';

/** An object URL for `bytes`, revoked when the bytes change or the component goes away. */
export function useObjectUrl(bytes: Uint8Array, mimeType: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => { URL.revokeObjectURL(next); setUrl(undefined); };
  }, [bytes, mimeType]);
  return url;
}

/**
 * A picture on a checkerboard, so transparent parts read as transparent (the way Preview and every image editor show
 * them), with its pixel size in the bar. It opens fitted to the window; the switch shows it at its real size, and a
 * click on the picture does the same.
 */
function ImagePreview({ url, name }: { url: string; name: string }) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [fitted, setFitted] = useState(true);
  const summary = size ? t('{0} × {1} px', [size.width.toLocaleString(currentLocale()), size.height.toLocaleString(currentLocale())]) : t('Ảnh');
  return <div className="image-preview">
    <PreviewBar summary={summary}>
      <PreviewIconButton label={fitted ? t('Xem kích thước thật') : t('Vừa khung xem')} icon={fitted ? <Maximize2 size={15} aria-hidden="true" /> : <Minimize2 size={15} aria-hidden="true" />} onClick={() => setFitted(current => !current)} />
    </PreviewBar>
    <figure className={fitted ? 'media-preview media-image' : 'media-preview media-image actual-size'}>
      <img src={url} alt={name} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onClick={() => setFitted(current => !current)} />
    </figure>
  </div>;
}

/**
 * An image, a video or an audio recording, played from bytes the core already checked. Everything goes through
 * a blob URL, so an SVG is a picture in an <img> and its scripts never run.
 */
export function MediaPreview({ kind, bytes, mimeType, name }: { kind: Exclude<MediaKind, 'pdf'>; bytes: Uint8Array; mimeType: string; name: string }) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) return null;
  if (kind === 'image') return <ImagePreview url={url} name={name} />;
  if (kind === 'video') return <figure className="media-preview media-video"><video src={url} controls preload="metadata" aria-label={name} /></figure>;
  return <figure className="media-preview media-audio"><audio src={url} controls preload="metadata" aria-label={name} /></figure>;
}
