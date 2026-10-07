import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Tooltip } from '@codepawlhq/orglet-ui';
import { Check, Copy } from 'lucide-react';
import { orglet } from '../api';
import { t } from '../i18n';

/**
 * The slim bar above a file's content in the viewer: what the content is and how much of it is on screen on the
 * left, the few controls that change how it is drawn on the right. Every previewer shares it so a table, a code
 * file, a picture and a PDF all open with the same calm header, like the toolbar of Quick Look or a GitHub file.
 */
export function PreviewBar({ summary, children }: { summary: ReactNode; children?: ReactNode }) {
  return <div className="preview-bar">
    <p className="preview-bar-summary" aria-live="polite">{summary}</p>
    {children && <div className="preview-bar-tools">{children}</div>}
  </div>;
}

/** An icon-only control of the bar. It names itself in a tooltip and, when it is a switch, says whether it is on. */
export function PreviewIconButton({ label, icon, onClick, pressed, disabled }: {
  label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean;
}) {
  return <Tooltip label={label}>
    <Button type="button" size="icon" className="preview-icon-button" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  </Tooltip>;
}

/** Copies `text` to the clipboard and shows a tick for a moment, so the click is answered without a toast. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function copy() {
    void orglet.copyText(text);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  }
  return <PreviewIconButton label={copied ? t('Đã sao chép') : label} icon={copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} onClick={copy} />;
}
