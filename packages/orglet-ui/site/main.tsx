import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CommandBlock,
  FieldLabel,
  Input,
  Progress,
  RadioGroup,
  Select,
  Skeleton,
  StatusMark,
  SwitchField,
  TabPanel,
  Tabs,
  Toaster,
  ToolbarToggleGroup,
  showToast,
} from '@codepawlhq/orglet-ui';
import '@codepawlhq/orglet-ui/tokens.css';
import '../stories/gallery.css';
import packageManifest from '../package.json';
import {
  componentPages, guides, isFramed, pagesByGroup, sectionsOf, storiesOf, storyFileSource, storyModuleOf,
  type ComponentPage, type Guide, type StoryEntry,
} from './content';
import { highlight } from './Highlight';
import {
  ArrowUpRightIcon, BookIcon, CheckIcon, CodeIcon, CopyIcon, ErrorIcon, EyeIcon, FileTextIcon, GitHubIcon, InfoIcon,
  MenuIcon, MonitorIcon, MoonIcon, PackageIcon, SearchIcon, SunIcon, UserIcon,
} from './icons';
import { Markdown, headingId } from './Markdown';
import { StoryView, storySource, type StoryModule } from './stories';
import './site.css';

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'oui-theme';
const INSTALL_COMMAND = `pnpm add ${packageManifest.name}`;
const REPOSITORY_URL = 'https://github.com/codepawl/orglet/tree/main/packages/orglet-ui';
const PACKAGE_URL = `https://www.npmjs.com/package/${packageManifest.name}`;
const STUDIO_URL = 'https://codepawl.com';
const BASE_FONT_SIZE = 15;

function storedTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function rememberTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A private window may refuse storage: the choice then lasts for this visit.
  }
}

/**
 * How much larger than its smallest size the page's type is right now. The kit's own controls are sized in pixels,
 * so the places that show them (the showcase, the previews) are zoomed by this to keep up with the text.
 */
function useKitZoom(): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const measure = () => {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || BASE_FONT_SIZE;
      // In steps of a twentieth, so dragging the window's edge does not redraw every preview on every pixel.
      const next = Math.max(1, Math.round((rootFontSize / BASE_FONT_SIZE) * 20) / 20);
      setZoom(next);
      document.documentElement.style.setProperty('--site-kit-zoom', String(next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return zoom;
}

function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (next: string) => {
    window.history.pushState(null, '', next);
    setPath(next.split('#')[0]);
    window.scrollTo(0, 0);
  };
  return [path, navigate];
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch {
    showToast('Copying is blocked in this browser', 'error');
  }
}

/** How far the mark's eyes travel towards the pointer, as a share of the mark's own width. */
const LOOK_REACH = 0.045;

/**
 * OUI's mark: the orglet drawn as a component on a canvas. The bubble is an outline with a selection handle on its
 * tight corner, and only the eyes are solid. They blink in the stylesheet and lean towards the pointer from here.
 */
function OuiMark({ className }: { className?: string }) {
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const lookAt = (event: PointerEvent) => {
      const element = mark.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const offsetX = event.clientX - (box.left + box.width / 2);
      const offsetY = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(offsetX, offsetY) || 1;
      const reach = box.width * LOOK_REACH;
      element.style.setProperty('--look-x', `${((offsetX / distance) * reach).toFixed(2)}px`);
      element.style.setProperty('--look-y', `${((offsetY / distance) * reach).toFixed(2)}px`);
    };
    window.addEventListener('pointermove', lookAt);
    return () => window.removeEventListener('pointermove', lookAt);
  }, []);
  return <span ref={mark} className={className ? `oui-mark ${className}` : 'oui-mark'} aria-hidden="true">
    <span className="oui-mark-handle" />
  </span>;
}

function SiteLink({ href, navigate, className, current, children }: {
  href: string;
  navigate: (path: string) => void;
  className?: string;
  current?: boolean;
  children: ReactNode;
}) {
  const isInternal = href.startsWith('/') && !/\.(md|txt)$/.test(href);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isInternal || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} className={className} onClick={onClick} aria-current={current ? 'page' : undefined}>{children}</a>;
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  return <div className="site-code">
    <Button type="button" size="icon" className="site-code-copy" aria-label="Copy code" onClick={() => void copyText(text, 'Code copied')}>
      <CopyIcon size={15} />
    </Button>
    <pre tabIndex={0} aria-label={language ? `${language} example` : 'Example'}><code>{highlight(text)}</code></pre>
  </div>;
}

function Prose({ source, navigate }: { source: string; navigate: (path: string) => void }) {
  return <div className="site-prose">
    <Markdown
      source={source}
      link={(href, label) => <SiteLink href={href} navigate={navigate}>{label}</SiteLink>}
      code={(text, language) => <CodeBlock text={text} language={language} />}
    />
  </div>;
}

const FRAME_BORDER = 2;
// The host serves an HTML file at its name without the extension and redirects the longer address there, which
// would cost every frame a second request. Vite's own server only knows the file name.
const PREVIEW_PATH = import.meta.env.DEV ? '/preview.html' : '/preview';
const FRAME_MINIMUM_HEIGHT = 340;

/** A story that opens a dialog, a menu or a toast, in a frame of its own. A skeleton holds its place until it loads. */
function FramedStory({ story, theme, zoom }: { story: StoryEntry; theme: Theme; zoom: number }) {
  const frameId = useId();
  const minimumHeight = Math.round(FRAME_MINIMUM_HEIGHT * zoom);
  const [height, setHeight] = useState(minimumHeight);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oui-preview-height' || event.data.frame !== frameId) return;
      // The frame's own border is inside its height, so the story needs that much more or it scrolls by two pixels.
      setHeight(Math.max(minimumHeight, Math.min((Number(event.data.height) || 0) + FRAME_BORDER, Math.round(720 * zoom))));
      setLoaded(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId, minimumHeight, zoom]);
  const query = new URLSearchParams({ file: story.file, story: story.exportName, theme, frame: frameId, zoom: String(zoom) });
  return <div className="site-frame" style={{ height }}>
    {!loaded && <Skeleton shape="block" className="site-frame-wait" />}
    <iframe src={`${PREVIEW_PATH}?${query}`} title={`${story.title} preview`} loading="lazy" onLoad={() => setLoaded(true)} />
  </div>;
}

/** One story: what it looks like, and the code that draws it, a tab apart. */
function StoryPreview({ page, story, theme, zoom }: { page: ComponentPage; story: StoryEntry; theme: Theme; zoom: number }) {
  const tabsId = useId();
  const [view, setView] = useState('preview');
  const storyModule = storyModuleOf(story.file) as StoryModule | undefined;
  const source = useMemo(() => storySource(storyFileSource(story.file), story.exportName), [story]);
  const tabs = [
    { id: 'preview', label: 'Preview', icon: <EyeIcon size={15} /> },
    { id: 'code', label: 'Code', icon: <CodeIcon size={15} /> },
  ];
  return <section className="site-story" aria-label={story.title}>
    <header className="site-story-header">
      <h3>{story.title}</h3>
      <Tabs id={tabsId} label={`${story.title}: preview or code`} tabs={tabs} value={view} onChange={setView} />
    </header>
    <TabPanel tabsId={tabsId} tabId="preview" value={view} className="site-story-panel">
      {isFramed(page)
        ? <FramedStory story={story} theme={theme} zoom={zoom} />
        : <div className="site-canvas">{storyModule && <StoryView storyModule={storyModule} exportName={story.exportName} />}</div>}
    </TabPanel>
    <TabPanel tabsId={tabsId} tabId="code" value={view} className="site-story-panel">
      <CodeBlock text={source} language="tsx" />
    </TabPanel>
  </section>;
}

function OnThisPage({ sections }: { sections: string[] }) {
  if (sections.length === 0) return null;
  return <nav className="site-sections" aria-label="On this page">
    <h2>On this page</h2>
    <ul>{sections.map(section => <li key={section}><a href={`#${headingId(section)}`}>{section}</a></li>)}</ul>
  </nav>;
}

/** A type's name starts with a capital and is never called: the import line only lists what code can use. */
function importLine(page: ComponentPage): string {
  const typeNames = /(Props|Labels|Option|Item|Row|Tone|Variant|State|Size|Action|Kind|Tab|Side)$/;
  const values = page.exports.filter(name => name === page.name || !typeNames.test(name));
  // A page with dozens of exports, such as the icons, shows a few: the line is an example, not the list.
  const shown = values.length > 6 ? values.slice(0, 3) : values;
  return `import { ${shown.join(', ')} } from '${packageManifest.name}';`;
}

function ComponentView({ page, theme, zoom, navigate }: { page: ComponentPage; theme: Theme; zoom: number; navigate: (path: string) => void }) {
  const stories = storiesOf(page);
  const markdown = `# ${page.name}\n\n${page.summary}\n\n${page.body}\n`;
  const sections = [...(stories.length > 0 ? ['Examples'] : []), ...sectionsOf(page.body)];
  return <div className="site-doc">
    <article className="site-article">
      <header className="site-article-header">
        <h1>{page.name}</h1>
        <p className="site-lead">{page.summary}</p>
        <div className="site-article-actions">
          <Button type="button" variant="outline" onClick={() => void copyText(markdown, 'Page copied as Markdown')}>
            <CopyIcon size={15} /> Copy page
          </Button>
          <a className="site-quiet-link" href={page.markdownPath}><FileTextIcon size={15} /> View as Markdown</a>
        </div>
      </header>
      <CodeBlock text={importLine(page)} language="tsx" />
      {stories.length > 0 && <>
        <h2 id="examples" className="site-section-title">Examples</h2>
        <div className="site-stories">
          {stories.map(story => <StoryPreview key={`${page.name}-${story.exportName}`} page={page} story={story} theme={theme} zoom={zoom} />)}
        </div>
      </>}
      <Prose source={page.body} navigate={navigate} />
    </article>
    <OnThisPage sections={sections} />
  </div>;
}

function GuideView({ guide, navigate }: { guide: Guide; navigate: (path: string) => void }) {
  return <div className="site-doc">
    <article className="site-article">
      <header className="site-article-header">
        <h1>{guide.title}</h1>
        <p className="site-lead">{guide.summary}</p>
      </header>
      <Prose source={guide.body} navigate={navigate} />
    </article>
    <OnThisPage sections={sectionsOf(guide.body)} />
  </div>;
}

const REVIEWERS = [
  { value: 'mai', label: 'Mai', detail: 'Design' },
  { value: 'quan', label: 'Quân', detail: 'Engineering' },
  { value: 'linh', label: 'Linh', detail: 'Writing' },
];

const CADENCES = [
  { value: 'daily', label: 'Every morning', description: 'A short note at 9:00' },
  { value: 'weekly', label: 'Every Monday', description: 'The week in one page' },
];

/** A small working form, so the first screen shows the kit doing its job instead of describing it. */
function ReportForm() {
  const [name, setName] = useState('Weekly report');
  const [reviewer, setReviewer] = useState('mai');
  const [notify, setNotify] = useState(true);
  const [attach, setAttach] = useState(false);
  const nameId = useId();
  const reviewerId = useId();
  return <form className="site-tile site-tile-form" aria-label="A sample form built with the kit" onSubmit={event => {
    event.preventDefault();
    showToast(`Saved "${name}"`);
  }}>
    <label className="site-field" htmlFor={nameId}>
      <FieldLabel icon={FileTextIcon} required>Name</FieldLabel>
      <Input id={nameId} value={name} onChange={event => setName(event.target.value)} required />
    </label>
    <div className="site-field">
      <span id={reviewerId}><FieldLabel icon={UserIcon}>Reviewer</FieldLabel></span>
      <Select value={reviewer} options={REVIEWERS} onChange={setReviewer} labelledBy={reviewerId} />
    </div>
    <SwitchField checked={notify} onChange={setNotify} description="Every Monday morning">Send it by email</SwitchField>
    <Checkbox checked={attach} onChange={event => setAttach(event.target.checked)}>Attach last week's numbers</Checkbox>
    <div className="site-tile-footer">
      <Button type="button" variant="outline" onClick={() => setName('Weekly report')}>Reset</Button>
      <Button type="submit" variant="primary">Save</Button>
    </div>
  </form>;
}

function RunTile() {
  const tabsId = useId();
  const [view, setView] = useState('run');
  const [cadence, setCadence] = useState('weekly');
  const tabs = [{ id: 'run', label: 'This run' }, { id: 'schedule', label: 'Schedule' }];
  return <div className="site-tile">
    <Tabs id={tabsId} label="Report" tabs={tabs} value={view} onChange={setView} />
    <TabPanel tabsId={tabsId} tabId="run" value={view} className="site-tile-stack">
      <Progress label="Files read" value={8} max={12} valueText="8 of 12 files" />
      <ul className="site-states">
        <li><StatusMark variant="filled" tone="success" label="Done" decorative /> Sources collected <Badge tone="success">Done</Badge></li>
        <li><StatusMark variant="busy" tone="working" label="Working" decorative /> Reading the files <Badge tone="warning">Working</Badge></li>
        <li><StatusMark variant="dashed" label="Waiting" decorative /> Draft <Badge>Waiting</Badge></li>
      </ul>
    </TabPanel>
    <TabPanel tabsId={tabsId} tabId="schedule" value={view} className="site-tile-stack">
      <RadioGroup label="How often" options={CADENCES} value={cadence} onChange={setCadence} />
    </TabPanel>
  </div>;
}

function Showcase() {
  return <div className="site-showcase" role="group" aria-label="Components from the kit, working">
    <ReportForm />
    <div className="site-showcase-column">
      <RunTile />
      <Card title="Research notes" description="Updated a minute ago" actions={<Button type="button" variant="outline">Open</Button>} className="site-tile-card">
        Three sources agree on the launch date. One still needs a second read.
      </Card>
    </div>
  </div>;
}

function HomeView({ navigate }: { navigate: (path: string) => void }) {
  return <article className="site-home">
    <div className="site-hero">
      <OuiMark className="oui-mark-hero" />
      <h1>The interface Orglet is built from.</h1>
      <p className="site-lead">
        OUI is a small set of accessible React components and the tokens they read. Quiet, keyboard-first, themed
        with CSS variables, and documented for people and for coding agents.
      </p>
      <div className="site-hero-actions">
        <SiteLink href="/docs/installation" navigate={navigate} className="site-action site-action-primary">Get started</SiteLink>
        <SiteLink href={`/components/${componentPages[0]?.name ?? ''}`} navigate={navigate} className="site-action">Browse components</SiteLink>
      </div>
      <CommandBlock className="site-install" command={INSTALL_COMMAND} copyLabel="Copy the install command" copyIcon={<CopyIcon size={15} />} onCopy={command => void copyText(command, 'Command copied')} />
    </div>
    <Showcase />
    <div className="site-facts">
      <section>
        <h2>{componentPages.length} pages, one per component</h2>
        <p>Each says when to use the component and when not to, and shows it working in light and dark.</p>
      </section>
      <section>
        <h2>Keyboard and screen readers first</h2>
        <p>Roles, focus return and Escape order are inside the components, and every story is checked with axe.</p>
      </section>
      <section>
        <h2>Written for agents too</h2>
        <p>
          The same pages ship as Markdown, <a href="/llms.txt">llms.txt</a> and a skill, so a coding agent picks the
          right component. <SiteLink href="/docs/agents" navigate={navigate}>How to set it up</SiteLink>
        </p>
      </section>
    </div>
  </article>;
}

function Sidebar({ path, navigate, onNavigate }: { path: string; navigate: (path: string) => void; onNavigate: () => void }) {
  const [filter, setFilter] = useState('');
  const visiblePages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return componentPages;
    return componentPages.filter(page => `${page.name} ${page.exports.join(' ')} ${page.summary}`.toLowerCase().includes(needle));
  }, [filter]);
  const go = (next: string) => {
    navigate(next);
    onNavigate();
  };
  return <nav className="site-sidebar" aria-label="Documentation">
    <div className="site-filter">
      <SearchIcon size={15} />
      <Input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter components" aria-label="Filter components" />
    </div>
    {!filter && <section>
      <h2>Getting started</h2>
      <ul>
        {guides.map(guide => <li key={guide.slug}>
          <SiteLink href={`/docs/${guide.slug}`} navigate={go} current={path === `/docs/${guide.slug}`}>{guide.title}</SiteLink>
        </li>)}
      </ul>
    </section>}
    {pagesByGroup(visiblePages).map(entry => <section key={entry.group}>
      <h2>{entry.group}</h2>
      <ul>
        {entry.pages.map(page => <li key={page.name}>
          <SiteLink href={`/components/${page.name}`} navigate={go} current={path === `/components/${page.name}`}>{page.name}</SiteLink>
        </li>)}
      </ul>
    </section>)}
    {visiblePages.length === 0 && <p className="site-empty">No component matches "{filter}".</p>}
  </nav>;
}

const THEME_ITEMS = [
  { value: 'light', label: 'Light', icon: <SunIcon size={15} /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon size={15} /> },
  { value: 'system', label: 'Follow the system', icon: <MonitorIcon size={15} /> },
];

function NotFound({ navigate }: { navigate: (path: string) => void }) {
  return <article className="site-article">
    <h1>Nothing here</h1>
    <p className="site-lead">This page does not exist. <SiteLink href="/" navigate={navigate}>Back to the start</SiteLink></p>
  </article>;
}

function Header({ path, navigate, theme, onTheme, menuOpen, onMenu }: {
  path: string;
  navigate: (path: string) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  const isDocs = path.startsWith('/docs/');
  const isComponents = path.startsWith('/components/');
  return <header className="site-header">
    <div className="site-header-inner">
      {path !== '/' && <Button type="button" size="icon" className="site-menu-button" aria-label="Show the list of pages" aria-expanded={menuOpen} onClick={onMenu}>
        <MenuIcon size={17} />
      </Button>}
      <SiteLink href="/" navigate={navigate} className="site-brand">
        <OuiMark />
        <span className="site-brand-name">oui</span>
        <span className="site-version">v{packageManifest.version}</span>
      </SiteLink>
      <nav className="site-nav" aria-label="Site">
        <SiteLink href="/docs/installation" navigate={navigate} current={isDocs}><BookIcon />Docs</SiteLink>
        <SiteLink href={`/components/${componentPages[0]?.name ?? ''}`} navigate={navigate} current={isComponents}><PackageIcon />Components</SiteLink>
        <a href={REPOSITORY_URL}><GitHubIcon />GitHub<ArrowUpRightIcon size={12} /></a>
        <a href={PACKAGE_URL} className="site-nav-extra">npm<ArrowUpRightIcon size={12} /></a>
        <a href={STUDIO_URL} className="site-nav-extra">CodePawl</a>
      </nav>
      <ToolbarToggleGroup label="Theme" items={THEME_ITEMS} value={theme} onValueChange={value => onTheme(value as Theme)} />
    </div>
  </header>;
}

function App() {
  const [path, navigate] = usePath();
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const kitZoom = useKitZoom();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    rememberTheme(theme);
  }, [theme]);
  const componentPage = componentPages.find(page => path === `/components/${page.name}`);
  const guide = guides.find(candidate => path === `/docs/${candidate.slug}`);
  useEffect(() => {
    const pageTitle = componentPage?.name ?? guide?.title;
    document.title = pageTitle ? `${pageTitle} · OUI` : 'OUI · The interface Orglet is built from';
  }, [componentPage, guide]);
  const isHome = path === '/';
  return <div className={isHome ? 'site-shell site-shell-home' : 'site-shell'}>
    <Header path={path} navigate={navigate} theme={theme} onTheme={setTheme} menuOpen={menuOpen} onMenu={() => setMenuOpen(open => !open)} />
    {isHome
      ? <main className="site-page"><HomeView navigate={navigate} /></main>
      : <div className={menuOpen ? 'site-body site-menu-open' : 'site-body'}>
        <Sidebar path={path} navigate={navigate} onNavigate={() => setMenuOpen(false)} />
        <main className="site-main">
          {componentPage && <ComponentView key={componentPage.name} page={componentPage} theme={theme} zoom={kitZoom} navigate={navigate} />}
          {guide && <GuideView key={guide.slug} guide={guide} navigate={navigate} />}
          {!componentPage && !guide && <NotFound navigate={navigate} />}
        </main>
      </div>}
    <footer className="site-footer">
      <span>OUI is the UI kit of <a href="https://orglet.codepawl.com">Orglet</a>, made by <a href={STUDIO_URL}>CodePawl</a>.</span>
      <span><a href="/llms.txt">llms.txt</a> · <a href={PACKAGE_URL}>npm</a> · <a href={REPOSITORY_URL}>Source</a></span>
    </footer>
    <Toaster icons={{ success: <CheckIcon size={16} />, error: <ErrorIcon size={16} />, info: <InfoIcon size={16} /> }} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
