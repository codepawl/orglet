// What the site shows, read from the package itself: the component pages, the guides and the stories.
export type ComponentPage = { name: string; exports: string[]; group: string; summary: string; body: string; markdownPath: string };
export type Guide = { slug: string; title: string; summary: string; body: string };
export type StoryEntry = { file: string; exportName: string; title: string };

export const GROUP_ORDER = ['Actions', 'Forms', 'Navigation', 'Overlays', 'Feedback', 'Display', 'Utilities'];
const GUIDE_ORDER = ['installation', 'theming', 'agents'];

// A page whose stories sit in a file with another name, and which of that file's stories are its own.
const STORY_SOURCES: Record<string, { file: string; pattern: RegExp }> = {
  Drawer: { file: 'Dialog', pattern: /^Drawer/ },
  Confirm: { file: 'Dialog', pattern: /^Confirm/ },
  DialogOverlay: { file: 'Dialog', pattern: /^Overlay/ },
};

const componentSources = import.meta.glob('../docs/components/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const guideSources = import.meta.glob('../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const storyModules = import.meta.glob('../stories/*.stories.tsx', { eager: true }) as Record<string, Record<string, { name?: string }>>;
// A module lists its exports alphabetically; the source keeps the order the stories were written in.
const storySources = import.meta.glob('../stories/*.stories.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function splitFrontmatter(source: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, '\n'));
  if (!match) return { fields: {}, body: source };
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { fields, body: match[2].trim() };
}

function fileStem(path: string): string {
  return path.split('/').pop()!.replace(/\.stories\.tsx$|\.md$/, '');
}

export const componentPages: ComponentPage[] = Object.entries(componentSources)
  .map(([path, source]) => {
    const { fields, body } = splitFrontmatter(source);
    return {
      name: fields.name,
      exports: fields.exports.split(',').map(name => name.trim()),
      group: fields.group,
      summary: fields.summary,
      body,
      markdownPath: `/docs/components/${fileStem(path)}.md`,
    };
  })
  .sort((first, second) => first.name.localeCompare(second.name));

export const guides: Guide[] = GUIDE_ORDER
  .map(slug => {
    const source = guideSources[`../docs/${slug}.md`];
    if (!source) return null;
    const { fields, body } = splitFrontmatter(source);
    return { slug, title: fields.title, summary: fields.summary, body };
  })
  .filter((guide): guide is Guide => guide !== null);

export function pagesByGroup(pages: ComponentPage[]): { group: string; pages: ComponentPage[] }[] {
  return GROUP_ORDER
    .map(group => ({ group, pages: pages.filter(page => page.group === group) }))
    .filter(entry => entry.pages.length > 0);
}

function readableName(exportName: string): string {
  return exportName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, first => first.toUpperCase()).replace(/ (\w)/g, (_, letter: string) => ` ${letter.toLowerCase()}`);
}

export function storiesOf(page: ComponentPage): StoryEntry[] {
  const source = STORY_SOURCES[page.name] ?? { file: page.name, pattern: /./ };
  const path = `../stories/${source.file}.stories.tsx`;
  const storyModule = storyModules[path];
  if (!storyModule) return [];
  const writtenOrder = [...(storySources[path] ?? '').matchAll(/^export const (\w+)/gm)].map(match => match[1]);
  return writtenOrder
    .filter(exportName => exportName in storyModule && source.pattern.test(exportName))
    .map(exportName => ({ file: source.file, exportName, title: storyModule[exportName]?.name ?? readableName(exportName) }));
}

/** The story file as a module, for drawing a story straight into the page. */
export function storyModuleOf(file: string): Record<string, unknown> | undefined {
  return storyModules[`../stories/${file}.stories.tsx`];
}

/** The story file's own text, for showing a story's code beside it. */
export function storyFileSource(file: string): string {
  return storySources[`../stories/${file}.stories.tsx`] ?? '';
}

// Pages whose stories open a dialog, a menu or a toast. Those are shown in a frame of their own; the rest are
// drawn straight into the page, which costs nothing to load.
const FRAMED_PAGES = [
  'AnchoredPopover', 'Confirm', 'DialogOverlay', 'Drawer', 'InfoTip', 'ReactionBar', 'RowMenu', 'Select',
  'TabbedDialog', 'Toaster', 'Tooltip', 'Viewer',
];

export function isFramed(page: ComponentPage): boolean {
  return FRAMED_PAGES.includes(page.name);
}

/** The headings of a page's body, for the list of sections beside it. */
export function sectionsOf(body: string): string[] {
  return [...body.matchAll(/^## (.+)$/gm)].map(match => match[1]);
}
