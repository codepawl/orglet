// Everything that lists the kit's components is written from docs/components/*.md, so the README, llms.txt and the
// agent skill cannot drift from each other or from what src/index.ts exports.
//   node scripts/build-docs.mjs          rewrites the generated files
//   node scripts/build-docs.mjs --check  fails when a generated file is stale or an export has no page
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesFolder = join(packageRoot, 'docs', 'components');
const checkOnly = process.argv.includes('--check');

export const GROUP_ORDER = ['Foundations', 'Actions', 'Forms', 'Navigation', 'Overlays', 'Feedback', 'Display', 'Utilities'];
const REQUIRED_HEADINGS = ['When to use', 'When not to', 'Example', 'Props', 'Accessibility'];

function readText(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function parsePage(fileName) {
  const text = readText(join(pagesFolder, fileName));
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${fileName}: no frontmatter`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  for (const key of ['name', 'exports', 'group', 'summary']) {
    if (!fields[key]) throw new Error(`${fileName}: frontmatter has no ${key}`);
  }
  if (`${fields.name}.md` !== fileName) throw new Error(`${fileName}: name is ${fields.name}`);
  if (!GROUP_ORDER.includes(fields.group)) throw new Error(`${fileName}: unknown group ${fields.group}`);
  const headings = [...match[2].matchAll(/^## (.+)$/gm)].map(heading => heading[1]);
  if (headings.join('|') !== REQUIRED_HEADINGS.join('|')) {
    throw new Error(`${fileName}: sections are [${headings.join(', ')}], expected [${REQUIRED_HEADINGS.join(', ')}]`);
  }
  return {
    name: fields.name,
    exports: fields.exports.split(',').map(name => name.trim()).filter(Boolean),
    group: fields.group,
    summary: fields.summary,
    body: match[2].trim(),
  };
}

function exportedNames(kind) {
  const source = readText(join(packageRoot, 'src', 'index.ts'));
  const names = [];
  for (const statement of source.matchAll(/export (type )?{([^}]+)}/g)) {
    const isType = Boolean(statement[1]);
    if (kind === 'values' && isType) continue;
    for (const name of statement[2].split(',')) names.push(name.trim());
  }
  return names.filter(Boolean);
}

function checkCoverage(pages) {
  const owners = new Map();
  for (const page of pages) {
    for (const name of page.exports) {
      if (owners.has(name)) throw new Error(`${name} is on two pages: ${owners.get(name)} and ${page.name}`);
      owners.set(name, page.name);
    }
  }
  const exported = exportedNames();
  const missing = exported.filter(name => !owners.has(name));
  const unknown = [...owners.keys()].filter(name => !exported.includes(name));
  if (missing.length) throw new Error(`No page covers: ${missing.join(', ')}`);
  if (unknown.length) throw new Error(`Pages name exports that do not exist: ${unknown.join(', ')}`);
}

function groupedPages(pages) {
  return GROUP_ORDER
    .map(group => ({ group, pages: pages.filter(page => page.group === group).sort((first, second) => first.name.localeCompare(second.name)) }))
    .filter(entry => entry.pages.length > 0);
}

const valueNames = new Set(exportedNames('values'));

function valueExports(page) {
  return page.exports.filter(name => valueNames.has(name));
}

function componentTable(pages, linkPrefix) {
  const lines = ['| Need | Use | Page |', '|---|---|---|'];
  for (const entry of groupedPages(pages)) {
    for (const page of entry.pages) {
      const names = valueExports(page).map(name => `\`${name}\``).join(', ');
      lines.push(`| ${page.summary} | ${names} | [${page.name}](${linkPrefix}${page.name}.md) |`);
    }
  }
  return lines.join('\n');
}

function llmsIndex(pages) {
  const lines = [
    '# OUI (Orglet UI)',
    '',
    '> OUI is @codepawlhq/orglet-ui: a small set of accessible React 19 components and the `--org-` tokens they read.',
    '> Import `@codepawlhq/orglet-ui/tokens.css` once, then import components by name from `@codepawlhq/orglet-ui`.',
    '',
    'Rules that hold for every component: text comes in as props, `className` is applied last, colours come from',
    '`--org-` tokens, keyboard and screen-reader behaviour is built in. The kit has no spinner (a wait is a',
    '`Skeleton`), no separator line and no alert with a coloured left border.',
    '',
  ];
  for (const entry of groupedPages(pages)) {
    lines.push(`## ${entry.group}`, '');
    for (const page of entry.pages) lines.push(`- [${page.name}](docs/components/${page.name}.md): ${page.summary}`);
    lines.push('');
  }
  lines.push('## Optional', '', '- [Every page in one file](llms-full.txt)', '- [Agent skill](skills/orglet-ui/SKILL.md)', '');
  return lines.join('\n');
}

function llmsFull(pages) {
  const sections = [];
  for (const entry of groupedPages(pages)) {
    for (const page of entry.pages) {
      sections.push(`# ${page.name}\n\n${page.summary}\n\nExports: ${page.exports.join(', ')}\n\n${page.body}`);
    }
  }
  return `${sections.join('\n\n---\n\n')}\n`;
}

function replaceBetweenMarkers(text, marker, replacement, path) {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0) throw new Error(`${path}: markers for ${marker} are missing`);
  return `${text.slice(0, startIndex + start.length)}\n${replacement}\n${text.slice(endIndex)}`;
}

const staleFiles = [];

function writeGenerated(relativePath, content) {
  const path = join(packageRoot, relativePath);
  let current = null;
  try {
    current = readText(path);
  } catch {
    current = null;
  }
  if (current === content) return;
  if (checkOnly) staleFiles.push(relativePath);
  else writeFileSync(path, content);
}

function writeMarked(relativePath, marker, replacement) {
  const path = join(packageRoot, relativePath);
  writeGenerated(relativePath, replaceBetweenMarkers(readText(path), marker, replacement, relativePath));
}

const pages = readdirSync(pagesFolder).filter(fileName => fileName.endsWith('.md')).map(parsePage);
checkCoverage(pages);
writeGenerated('llms.txt', llmsIndex(pages));
writeGenerated('llms-full.txt', llmsFull(pages));
writeMarked('README.md', 'components', componentTable(pages, 'docs/components/'));
writeMarked('skills/orglet-ui/SKILL.md', 'components', componentTable(pages, '../../docs/components/'));

if (staleFiles.length) {
  console.error(`Out of date: ${staleFiles.join(', ')}. Run: pnpm --filter @codepawlhq/orglet-ui docs`);
  process.exit(1);
}
console.log(`${pages.length} pages, ${exportedNames().length} exports, ${checkOnly ? 'all generated files current' : 'generated files written'}`);
