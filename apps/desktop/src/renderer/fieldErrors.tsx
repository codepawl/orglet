import { useState, type ReactNode } from 'react';
import { FieldError } from '@codepawlhq/orglet-ui';

/** One thing a form needs before it can be saved: `failed` is true when the field does not meet it. */
export type FieldCheck = { field: string; failed: boolean; message: string };

/** The message of every failed check, by field. A field that fails twice keeps its first message. */
export function failedMessages(checks: readonly FieldCheck[]): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const check of checks) {
    if (check.failed && !(check.field in messages)) messages[check.field] = check.message;
  }
  return messages;
}

/** The first field, in the order the checks were listed, that fails: the one to focus. */
export function firstFailedField(checks: readonly FieldCheck[]): string | undefined {
  return checks.find(check => check.failed)?.field;
}

/** Whether a typed value is empty once the spaces around it are gone. */
export function isBlank(value: string): boolean {
  return value.trim() === '';
}

/**
 * The line under a field of a dialog that records one failure as `invalid` (the field) and `error` (what is wrong):
 * the message appears under the field it is about, and nowhere else.
 */
export function fieldMessage(field: string, invalid: string | undefined, error: string): ReactNode {
  return invalid === field && error ? <FieldError>{error}</FieldError> : null;
}

/** A field's `id` for its error, so the field can point `aria-describedby` at it. */
export function fieldErrorId(form: string, field: string): string {
  return `${form}-${field}-error`;
}

/**
 * Validation a form runs when it is submitted, with the app's own message under each field in place of the browser's
 * bubble (which the form turns off with `noValidate`). `check` shows every failure at once and moves focus to the
 * first one, matching `data-field` on the control. `props(field)` marks a control, `message(field)` is the line under it,
 * and a field's message goes as soon as the person edits it (`clear`).
 */
export function useFieldErrors(form: string) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState(0);

  const check = (container: HTMLElement | null, checks: readonly FieldCheck[]): boolean => {
    const messages = failedMessages(checks);
    setErrors(messages);
    const first = firstFailedField(checks);
    if (first === undefined) return true;
    setFlash(count => count + 1);
    container?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
    return false;
  };

  const clear = (field: string) => {
    setErrors(current => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  };

  const props = (field: string) => ({
    'data-field': field,
    invalid: field in errors,
    flash,
    'aria-describedby': field in errors ? fieldErrorId(form, field) : undefined,
  });

  /** For a tick box, which takes no `invalid` prop: the attributes that turn it red and flash it. */
  const toggleProps = (field: string) => ({
    'data-field': field,
    ...(field in errors ? { 'aria-invalid': true as const, 'data-flash': flash, 'aria-describedby': fieldErrorId(form, field) } : {}),
  });

  const message = (field: string): ReactNode => field in errors
    ? <FieldError id={fieldErrorId(form, field)}>{errors[field]}</FieldError>
    : null;

  return { check, clear, reset: () => setErrors({}), props, toggleProps, message, hasErrors: Object.keys(errors).length > 0 };
}
