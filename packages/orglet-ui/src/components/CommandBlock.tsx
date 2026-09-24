import type { ReactNode } from 'react';
import { cn } from '../cn';
import './CommandBlock.css';

/**
 * A command for someone to paste into a terminal: an optional label, then the command on a quiet card with a copy
 * button. `toolbar` fills the card's top bar on the left, for a small control that changes the command, such as a
 * terminal picker; the copy button then sits at the bar's right. Without a toolbar the copy button keeps the card's
 * top corner.
 *
 * The component never touches the clipboard: `onCopy` receives the command and the application writes it, because
 * how that works (and what it says afterwards) depends on where the application runs.
 */
export function CommandBlock({ command, label, toolbar, copyLabel, copyIcon, onCopy, className }: {
  command: string;
  label?: ReactNode;
  toolbar?: ReactNode;
  /** The copy button's accessible name and tooltip. */
  copyLabel: string;
  copyIcon?: ReactNode;
  onCopy: (command: string) => void;
  className?: string;
}) {
  const copyButton = <button
    type="button"
    className="org-command-block-copy"
    aria-label={copyLabel}
    title={copyLabel}
    onClick={() => onCopy(command)}
  >{copyIcon ?? <CopyGlyph />}</button>;
  return <div className={cn('org-command-block', className)}>
    {label && <span className="org-command-block-label">{label}</span>}
    <div className={cn('org-command-block-card', toolbar ? 'org-command-block-with-toolbar' : undefined)}>
      {toolbar
        ? <div className="org-command-block-toolbar">{toolbar}{copyButton}</div>
        : copyButton}
      <code className="org-command-block-text">{breakableCommand(command)}</code>
    </div>
  </div>;
}

/**
 * A long command read in a narrow column may break after a path separator or a space, never inside a word, so
 * "harness-accounts" stays whole. Each piece keeps together (the browser would otherwise also break after a
 * hyphen) and the breaks sit between them. What is copied is the command itself, not this markup.
 */
function breakableCommand(command: string): ReactNode[] {
  return command.split(/(?<=[\\/ ])/).flatMap((piece, index) => {
    const whole = <span key={`piece-${index}`} className="org-command-block-piece">{piece}</span>;
    if (index === 0) return [whole];
    return [<wbr key={`break-${index}`} />, whole];
  });
}

/** Two overlapping sheets, drawn here so the kit needs no icon library. */
function CopyGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>;
}
