import { z } from 'zod';

/**
 * The two fonts the app ships with, and what a person may put in their place. A font is chosen by family name and
 * applied as a CSS custom property, so the name is validated here rather than trusted: letters, digits, spaces,
 * hyphens and periods only, which cannot close a declaration or add one.
 */
export const BUNDLED_INTERFACE_FONT = 'Inter';
export const BUNDLED_CODE_FONT = 'JetBrains Mono';

export const FontFamily = z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N} .-]+$/u, 'Font family');

/**
 * The interface default (owner's pick, 2026-09-22): SF Pro first, which macOS supplies itself and a person on
 * another platform can install for their own machine. Orglet does not ship it — Apple licenses it for use on
 * Apple platforms, so it cannot be bundled — and the bundled Inter stands right behind it, which is what a
 * machine without SF Pro actually draws.
 */
export const INTERFACE_PREFERRED_FONTS = ['SF Pro Text', 'SF Pro Display'];

/** Kept after the chosen family so text still renders when it is missing, and so emoji keep their own font. */
const INTERFACE_FALLBACK = 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
const CODE_FALLBACK = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

export type FontRole = 'interface' | 'code';
export const bundledFont = (role: FontRole) => role === 'interface' ? BUNDLED_INTERFACE_FONT : BUNDLED_CODE_FONT;

/** The CSS value for one role: the family the person picked, then the bundled font, then the platform stack. */
export function fontStack(role: FontRole, family?: string): string {
  const fallback = role === 'interface' ? INTERFACE_FALLBACK : CODE_FALLBACK;
  const chosen = FontFamily.safeParse(family);
  // Nothing picked means the default stack; a pick replaces the preference, not the bundled face behind it.
  const preferred = chosen.success ? [] : role === 'interface' ? INTERFACE_PREFERRED_FONTS : [];
  const picked = chosen.success && chosen.data !== bundledFont(role) ? [chosen.data] : [];
  const names = [...preferred, ...picked, bundledFont(role)];
  return `${names.map(name => `"${name}"`).join(', ')}, ${fallback}`;
}

/**
 * Families offered beside the bundled one. Only those the machine actually has are shown, so the list is a
 * starting point rather than a promise; anything else can be typed.
 */
export const INTERFACE_FONT_SUGGESTIONS = ['Segoe UI', 'SF Pro Text', 'Helvetica Neue', 'Arial', 'Roboto', 'Noto Sans', 'IBM Plex Sans', 'Georgia'];
export const CODE_FONT_SUGGESTIONS = ['Cascadia Mono', 'Consolas', 'SF Mono', 'Menlo', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Courier New'];
