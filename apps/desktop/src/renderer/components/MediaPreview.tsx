import { useEffect, useState } from 'react';
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
 * An image, a video or an audio recording, played from bytes the core already checked. Everything goes through
 * a blob URL, so an SVG is a picture in an <img> and its scripts never run.
 */
export function MediaPreview({ kind, bytes, mimeType, name }: { kind: Exclude<MediaKind, 'pdf'>; bytes: Uint8Array; mimeType: string; name: string }) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) return null;
  if (kind === 'image') return <figure className="media-preview media-image"><img src={url} alt={name} /></figure>;
  if (kind === 'video') return <figure className="media-preview media-video"><video src={url} controls preload="metadata" aria-label={name} /></figure>;
  return <figure className="media-preview media-audio"><audio src={url} controls preload="metadata" aria-label={name} /></figure>;
}
