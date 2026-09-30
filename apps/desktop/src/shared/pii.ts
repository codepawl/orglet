/**
 * Email addresses on screen are shown only in part (owner's rule, 2026-09-30), so a screenshot or a screen share does
 * not carry the full address. The domain stays readable, because it tells which account is which ("…@gmail.com"
 * against "…@company.com"); the name before the @ keeps its first two letters.
 */
const MASK = '•••';
const VISIBLE_LEADING_CHARACTERS = 2;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** "an.nguyen@example.com" → "an•••@example.com"; a string without one @ comes back unchanged. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return email;
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = localPart.length <= VISIBLE_LEADING_CHARACTERS ? localPart.slice(0, 1) : localPart.slice(0, VISIBLE_LEADING_CHARACTERS);
  return `${shown}${MASK}@${domain}`;
}

/** Masks every email address inside a longer text, such as a line a command-line tool printed about its sign-in. */
export function maskEmailsIn(text: string): string {
  return text.replace(EMAIL_IN_TEXT, maskEmail);
}
