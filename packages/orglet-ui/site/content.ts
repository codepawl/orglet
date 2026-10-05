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
  const storyModule = storyModules[`../stories/${source.file}.stories.tsx`];
  if (!storyModule) return [];
  return Object.entries(storyModule)
    .filter(([exportName]) => exportName !== 'default' && source.pattern.test(exportName))
    .map(([exportName, story]) => ({ file: source.file, exportName, title: story?.name ?? readableName(exportName) }));
}
