import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';
import './EditableText.css';

/**
 * A name that can be renamed where it is shown. At rest it reads as text; on hover or keyboard focus it shows the
 * outline of an input so it is clear it can be edited; a click, Enter or F2 turns it into an input with the text
 * selected. Enter or leaving the field keeps the change, Escape puts the old value back. An empty or unchanged
 * value changes nothing.
 *
 * `onCommit` does the saving and may be async; the new text is shown while it runs, and the old one comes back if
 * it throws. What to say about a failure is the application's business, so the error is rethrown for it.
 */
export function EditableText({ value, onCommit, label, maxLength, disabled, className }: {
  value: string;
  onCommit: (next: string) => void | Promise<void>;
  /** The accessible name, for example "Rename Researcher". Also the tooltip. */
  label: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  // Enter ends editing and unmounts the input, which can also report a blur; this keeps the change to one commit.
  const open = useRef(false);
  const shown = pending ?? value;

  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const startEditing = () => {
    if (disabled) return;
    setDraft(shown);
    open.current = true;
    setEditing(true);
  };

  const commit = async () => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    const next = draft.trim();
    if (!next || next === value) return;
    setPending(next);
    try {
      await onCommit(next);
    } finally {
      setPending(undefined);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void commit().catch(() => undefined);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open.current = false;
      setEditing(false);
    }
  };

  const onRestKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'F2') {
      event.preventDefault();
      startEditing();
    }
  };

  if (editing) {
    // The input grows with what is typed (`field-sizing` in the stylesheet, `size` where that is missing).
    return <input
      ref={input}
      className={cn('org-editable-text', 'org-editable-text-input', className)}
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      size={Math.max(draft.length, 1)}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => void commit().catch(() => undefined)}
    />;
  }
  return <button
    type="button"
    className={cn('org-editable-text', className)}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={startEditing}
    onKeyDown={onRestKeyDown}
  >{shown}</button>;
}
