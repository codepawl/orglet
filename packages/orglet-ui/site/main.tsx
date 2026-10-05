import { Check, CircleAlert, Copy, FileText, Info, Menu, Monitor, Moon, Search, Sun, UserRound } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Checkbox,
  CommandBlock,
  FieldLabel,
  Input,
  Select,
  StatusMark,
  SwitchField,
  Toaster,
  ToolbarToggleGroup,
  showToast,
} from '@codepawlhq/orglet-ui';
import '@codepawlhq/orglet-ui/tokens.css';
import packageManifest from '../package.json';
import { componentPages, guides, pagesByGroup, storiesOf, type ComponentPage, type Guide, type StoryEntry } from './content';
import { Markdown } from './Markdown';
import './site.css';

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'orglet-ui-theme';
const INSTALL_COMMAND = `pnpm add ${packageManifest.name}`;
const REPOSITORY_URL = 'https://github.com/codepawl/orglet/tree/main/packages/orglet-ui';
const PACKAGE_URL = `https://www.npmjs.com/package/${packageManifest.name}`;

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
      <Copy size={15} aria-hidden />
    </Button>
    <pre tabIndex={0} aria-label={language ? `${language} example` : 'Example'}><code>{text}</code></pre>
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

function StoryFrame({ story, theme, minimumHeight }: { story: StoryEntry; theme: Theme; minimumHeight: number }) {
  const frameId = useId();
  const [height, setHeight] = useState(minimumHeight);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'orglet-ui-preview-height' || event.data.frame !== frameId) return;
      setHeight(Math.max(minimumHeight, Math.min(Number(event.data.height) || 0, 720)));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId, minimumHeight]);
  const query = new URLSearchParams({ file: story.file, story: story.exportName, theme, frame: frameId });
  return <figure className="site-story">
    <figcaption>{story.title}</figcaption>
    <iframe src={`/preview.html?${query}`} title={`${story.title} preview`} loading="lazy" style={{ height }} />
  </figure>;
}

// A frame is as tall as its story, but a story that opens a menu or a dialog needs room for it inside the frame.
const OPENS_A_PANEL = ['Select', 'RowMenu', 'InfoTip', 'Tooltip', 'AnchoredPopover', 'ReactionBar', 'ColorPicker'];

function minimumFrameHeight(page: ComponentPage): number {
  if (page.group === 'Overlays' && !OPENS_A_PANEL.includes(page.name)) return 480;
  if (page.name === 'Toaster') return 320;
  return OPENS_A_PANEL.includes(page.name) ? 340 : 96;
}

function ComponentView({ page, theme, navigate }: { page: ComponentPage; theme: Theme; navigate: (path: string) => void }) {
  const stories = storiesOf(page);
  const minimumHeight = minimumFrameHeight(page);
  const markdown = `# ${page.name}\n\n${page.summary}\n\n${page.body}\n`;
  return <article className="site-article">
    <header className="site-article-header">
      <div>
        <h1>{page.name}</h1>
        <p className="site-lead">{page.summary}</p>
      </div>
      <div className="site-article-actions">
        <Button type="button" variant="outline" onClick={() => void copyText(markdown, 'Page copied as Markdown')}>
          <Copy size={15} aria-hidden /> Copy page
        </Button>
        <a className="site-quiet-link" href={page.markdownPath}><FileText size={15} aria-hidden /> View as Markdown</a>
      </div>
    </header>
    {stories.length > 0 && <section aria-label="Previews" className="site-stories">
      {stories.map(story => <StoryFrame key={`${page.name}-${story.exportName}`} story={story} theme={theme} minimumHeight={minimumHeight} />)}
    </section>}
    <Prose source={page.body} navigate={navigate} />
  </article>;
}

function GuideView({ guide, navigate }: { guide: Guide; navigate: (path: string) => void }) {
  return <article className="site-article">
    <header className="site-article-header">
      <div>
        <h1>{guide.title}</h1>
        <p className="site-lead">{guide.summary}</p>
      </div>
    </header>
    <Prose source={guide.body} navigate={navigate} />
  </article>;
}

const REVIEWERS = [
  { value: 'mai', label: 'Mai', detail: 'Design' },
  { value: 'quan', label: 'Quân', detail: 'Engineering' },
  { value: 'linh', label: 'Linh', detail: 'Writing' },
];

/** A small working form, so the first screen shows the kit doing its job instead of describing it. */
function Sample() {
  const [name, setName] = useState('Weekly report');
  const [reviewer, setReviewer] = useState('mai');
  const [notify, setNotify] = useState(true);
  const [attach, setAttach] = useState(false);
  const nameId = useId();
  const reviewerId = useId();
  return <form className="site-sample" aria-label="A sample form built with the kit" onSubmit={event => {
    event.preventDefault();
    showToast(`Saved "${name}"`);
  }}>
    <label className="site-sample-field" htmlFor={nameId}>
      <FieldLabel icon={FileText} required>Name</FieldLabel>
      <Input id={nameId} value={name} onChange={event => setName(event.target.value)} required />
    </label>
    <div className="site-sample-field">
      <span id={reviewerId}><FieldLabel icon={UserRound}>Reviewer</FieldLabel></span>
      <Select value={reviewer} options={REVIEWERS} onChange={setReviewer} labelledBy={reviewerId} />
    </div>
    <SwitchField checked={notify} onChange={setNotify} description="Every Monday morning">Send it by email</SwitchField>
    <Checkbox checked={attach} onChange={event => setAttach(event.target.checked)}>Attach last week's numbers</Checkbox>
    <div className="site-sample-footer">
      <span className="site-sample-state"><StatusMark variant="filled" tone="success" label="Ready" decorative /> Ready to send</span>
      <Button type="button" variant="outline" onClick={() => setName('Weekly report')}>Reset</Button>
      <Button type="submit" variant="primary">Save</Button>
    </div>
  </form>;
}

function HomeView({ navigate }: { navigate: (path: string) => void }) {
  return <article className="site-article site-home">
    <div className="site-hero">
      <div className="site-hero-text">
        <h1>Orglet UI</h1>
        <p className="site-lead">
          A small set of accessible React components and the tokens they read. It is the interface Orglet is built
          from: quiet, keyboard-first, themed with CSS variables.
        </p>
        <CommandBlock command={INSTALL_COMMAND} copyLabel="Copy the install command" onCopy={command => void copyText(command, 'Command copied')} />
        <div className="site-hero-actions">
          <SiteLink href="/docs/installation" navigate={navigate} className="site-action site-action-primary">Get started</SiteLink>
          <SiteLink href={`/components/${componentPages[0]?.name ?? ''}`} navigate={navigate} className="site-action">Browse components</SiteLink>
        </div>
      </div>
      <Sample />
    </div>
    <div className="site-facts">
      <section>
        <h2>{componentPages.length} components, one page each</h2>
        <p>Every page says when to use the component, when not to, and shows it working in light and dark.</p>
      </section>
      <section>
        <h2>Keyboard and screen readers first</h2>
        <p>Roles, focus return and Escape order are inside the components, and every one is checked with axe.</p>
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
      <Search size={15} aria-hidden />
      <Input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter components" aria-label="Filter components" />
    </div>
    {!filter && <section>
      <h2>Getting started</h2>
      <ul>
        <li><SiteLink href="/" navigate={go} current={path === '/'}>Introduction</SiteLink></li>
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
  { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden /> },
  { value: 'system', label: 'Follow the system', icon: <Monitor size={15} aria-hidden /> },
];

function NotFound({ navigate }: { navigate: (path: string) => void }) {
  return <article className="site-article">
    <h1>Nothing here</h1>
    <p className="site-lead">This page does not exist. <SiteLink href="/" navigate={navigate}>Back to the introduction</SiteLink></p>
  </article>;
}

function App() {
  const [path, navigate] = usePath();
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    rememberTheme(theme);
  }, [theme]);
  const componentPage = componentPages.find(page => path === `/components/${page.name}`);
  const guide = guides.find(candidate => path === `/docs/${candidate.slug}`);
  useEffect(() => {
    const pageTitle = componentPage?.name ?? guide?.title;
    document.title = pageTitle ? `${pageTitle} · Orglet UI` : 'Orglet UI';
  }, [componentPage, guide]);
  return <div className="site-shell">
    <header className="site-topbar">
      <Button type="button" size="icon" className="site-menu-button" aria-label="Show the list of pages" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
        <Menu size={17} aria-hidden />
      </Button>
      <SiteLink href="/" navigate={navigate} className="site-wordmark">Orglet UI</SiteLink>
      <span className="site-version">v{packageManifest.version}</span>
      <div className="site-topbar-end">
        <a className="site-quiet-link" href={PACKAGE_URL}>npm</a>
        <a className="site-quiet-link" href={REPOSITORY_URL}>GitHub</a>
        <ToolbarToggleGroup label="Theme" items={THEME_ITEMS} value={theme} onValueChange={value => setTheme(value as Theme)} />
      </div>
    </header>
    <div className={menuOpen ? 'site-body site-menu-open' : 'site-body'}>
      <Sidebar path={path} navigate={navigate} onNavigate={() => setMenuOpen(false)} />
      <main className="site-main">
        {path === '/' && <HomeView navigate={navigate} />}
        {componentPage && <ComponentView key={componentPage.name} page={componentPage} theme={theme} navigate={navigate} />}
        {guide && <GuideView guide={guide} navigate={navigate} />}
        {path !== '/' && !componentPage && !guide && <NotFound navigate={navigate} />}
      </main>
    </div>
    <Toaster icons={{ success: <Check size={16} aria-hidden />, error: <CircleAlert size={16} aria-hidden />, info: <Info size={16} aria-hidden /> }} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
