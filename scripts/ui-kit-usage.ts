// Counts the places where the renderer goes around the UI kit: a raw control where a kit component exists, a `title`
// attribute where a Tooltip belongs, a colour written as hex where a token belongs. The counts are compared with
// ui-kit-usage-baseline.json by tests/integration/ui-kit-usage.test.ts, so the numbers can only go down.
//   node scripts/ui-kit-usage.ts            prints the counts that differ from the baseline
//   node scripts/ui-kit-usage.ts --update   rewrites the baseline after a clean-up
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type UsageCounts = {
  rawButton: number;
  rawSelect: number;
  rawCheckbox: number;
  titleAttribute: number;
  hexColour: number;
};

export type UsageReport = Record<string, UsageCounts>;

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererFolder = join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer');
export const baselinePath = join(repositoryRoot, 'scripts', 'ui-kit-usage-baseline.json');

export const usageAdvice: Record<keyof UsageCounts, string> = {
  rawButton: 'use Button from the kit instead of <button>',
  rawSelect: 'use Select from the kit instead of <select>',
  rawCheckbox: 'use Checkbox (picking) or Switch (on/off) from the kit instead of a checkbox input',
  titleAttribute: 'use Tooltip from the kit instead of a title attribute',
  hexColour: 'use a token (var(--...)) instead of a hex colour',
};

/** The text of every opening tag of a lowercase (HTML) element, attributes included. */
export function intrinsicOpeningTags(source: string): { name: string; text: string }[] {
  const tags: { name: string; text: string }[] = [];
  const opening = /<([a-z][a-z0-9]*)(?=[\s/>])/g;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    const end = openingTagEnd(source, match.index + match[0].length);
    tags.push({ name: match[1], text: source.slice(match.index, end) });
    opening.lastIndex = end;
  }
  return tags;
}

/** Where an opening tag closes: the first `>` that is not inside a `{...}` expression or a quoted string. */
function openingTagEnd(source: string, from: number): number {
  let braceDepth = 0;
  let quote = '';
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (character === '>' && braceDepth === 0) return index + 1;
  }
  return source.length;
}

/** The tag's own attributes, without what sits inside its `{...}` expressions. */
function ownAttributes(tagText: string): string {
  let result = '';
  let braceDepth = 0;
  for (const character of tagText) {
    if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (braceDepth === 0) result += character;
  }
  return result;
}

export function countUsage(source: string): UsageCounts {
  const counts: UsageCounts = { rawButton: 0, rawSelect: 0, rawCheckbox: 0, titleAttribute: 0, hexColour: 0 };
  for (const tag of intrinsicOpeningTags(source)) {
    const attributes = ownAttributes(tag.text);
    if (tag.name === 'button') counts.rawButton += 1;
    if (tag.name === 'select') counts.rawSelect += 1;
    if (tag.name === 'input' && /\btype="checkbox"/.test(attributes)) counts.rawCheckbox += 1;
    if (/\stitle=/.test(attributes)) counts.titleAttribute += 1;
  }
  counts.hexColour = (source.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z])/g) ?? []).length;
  return counts;
}

/** Hex colours in a stylesheet, leaving out the lines that define a token: that is where a colour belongs. */
export function countStylesheetHex(source: string): number {
  let total = 0;
  for (const line of source.split('\n')) {
    if (/^\s*--[\w-]+\s*:/.test(line)) continue;
    total += (line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  }
  return total;
}

function sourceFiles(folder: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path, extension));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

function hasFindings(counts: UsageCounts): boolean {
  return Object.values(counts).some(count => count > 0);
}

export function scanRenderer(): UsageReport {
  const report: UsageReport = {};
  for (const path of sourceFiles(rendererFolder, '.tsx')) {
    const counts = countUsage(readFileSync(path, 'utf8'));
    if (hasFindings(counts)) report[relative(rendererFolder, path).replaceAll('\\', '/')] = counts;
  }
  for (const path of sourceFiles(rendererFolder, '.css')) {
    const hexColour = countStylesheetHex(readFileSync(path, 'utf8'));
    if (hexColour > 0) {
      report[relative(rendererFolder, path).replaceAll('\\', '/')] = { rawButton: 0, rawSelect: 0, rawCheckbox: 0, titleAttribute: 0, hexColour };
    }
  }
  return Object.fromEntries(Object.entries(report).sort(([first], [second]) => first.localeCompare(second)));
}

export function readBaseline(): UsageReport {
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as UsageReport;
}

export type UsageDifference = { file: string; kind: keyof UsageCounts; baseline: number; current: number };

export function compareWithBaseline(current: UsageReport, baseline: UsageReport): UsageDifference[] {
  const differences: UsageDifference[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    for (const kind of Object.keys(usageAdvice) as (keyof UsageCounts)[]) {
      const baselineCount = baseline[file]?.[kind] ?? 0;
      const currentCount = current[file]?.[kind] ?? 0;
      if (baselineCount !== currentCount) differences.push({ file, kind, baseline: baselineCount, current: currentCount });
    }
  }
  return differences;
}

function runFromCommandLine(): void {
  const current = scanRenderer();
  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Baseline written: ${Object.keys(current).length} files`);
    return;
  }
  const differences = compareWithBaseline(current, readBaseline());
  for (const difference of differences) {
    console.log(`${difference.file}: ${difference.kind} ${difference.baseline} -> ${difference.current}`);
  }
  console.log(differences.length ? `${differences.length} differences` : 'Matches the baseline');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runFromCommandLine();
