/*
 * What the About tab shows of a release's notes (COD-237): only what changed. Every GitHub Release body opens by
 * naming the build and saying how it reaches people, and closes with the same install advice; the entry already
 * names the version, and the advice is for the release page, not for someone who is already running the app.
 * The releases themselves stay as they are; this trims the text the app shows. Anything it does not recognise
 * stays, so a release written differently loses nothing.
 */

// "**Orglet 0.3.1** for Windows." as the first line: the entry's own header already says this.
const buildLinePattern = /^\s*\*\*\s*orglet\s+v?\d+(?:\.\d+){1,2}\S*\s*\*\*\s+for\b.*$/i;
// "If you run 0.2.4 or later from Setup, this update arrives by itself…", and 0.2.5's "If you installed 0.2.4 with
// Setup, this one arrives by itself…": how the update travels, said before the first section.
const deliveryParagraphPattern = /^\s*if\s+you\s+(?:run|installed)\b/i;
// "### Before you install" and everything after it: the unsigned-installer advice and the licence and checklist line.
const installSectionPattern = /^\s{0,3}#{1,6}\s*before\s+you\s+install\s*#*\s*$/i;
const headingPattern = /^\s{0,3}#{1,6}\s/;
const fencePattern = /^\s*(```|~~~)/;

/** Splits notes into lines, with any mix of line endings. */
function linesOf(notes: string): string[] {
  return notes.replace(/\r\n?/g, '\n').split('\n');
}

/** Drops the blank lines at both ends. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

/** Removes the build line when it is the first line with text. */
function withoutBuildLine(lines: string[]): string[] {
  const trimmed = trimBlankLines(lines);
  if (trimmed.length > 0 && buildLinePattern.test(trimmed[0])) return trimmed.slice(1);
  return trimmed;
}

/** Cuts at the "Before you install" heading, which is the last section of every release that has it. */
function withoutInstallSection(lines: string[]): string[] {
  let inFence = false;
  for (let index = 0; index < lines.length; index++) {
    if (fencePattern.test(lines[index])) inFence = !inFence;
    if (!inFence && installSectionPattern.test(lines[index])) return lines.slice(0, index);
  }
  return lines;
}

/**
 * Removes the paragraph about how the update arrives. It is only looked for before the first heading: a section
 * further down that happens to start with "If you run" is part of what changed.
 */
function withoutDeliveryParagraph(lines: string[]): string[] {
  const kept: string[] = [];
  let skipping = false;
  let beforeFirstHeading = true;
  for (const line of lines) {
    if (headingPattern.test(line) || fencePattern.test(line)) beforeFirstHeading = false;
    const startsParagraph = kept.length === 0 || kept[kept.length - 1].trim() === '';
    if (beforeFirstHeading && startsParagraph && deliveryParagraphPattern.test(line)) skipping = true;
    if (skipping && line.trim() === '') skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept;
}

/** The part of a release's notes that says what changed, or an empty string when nothing else is left. */
export function releaseHighlights(notes: string): string {
  const withoutBuild = withoutBuildLine(linesOf(notes));
  const withoutInstall = withoutInstallSection(withoutBuild);
  const withoutDelivery = withoutDeliveryParagraph(withoutInstall);
  return trimBlankLines(withoutDelivery).join('\n');
}
