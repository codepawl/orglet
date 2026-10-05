import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/tokens.css';
import '../.storybook/preview.css';
import '../stories/gallery.css';
import './preview.css';
import { StoryView, playStory, type StoryModule } from './stories';

// One story, alone in a frame, for the stories that open a dialog, a menu or a toast: a frame keeps their portals,
// focus traps and Escape handling to itself, so a page can show several at once. Everything else is drawn straight
// into the page (see StoryPreview in main.tsx).
const storyModules = import.meta.glob('../stories/*.stories.tsx');
const parameters = new URLSearchParams(window.location.search);
const fileName = parameters.get('file') ?? '';
const storyName = parameters.get('story') ?? '';
const frameId = parameters.get('frame') ?? '';
document.documentElement.dataset.theme = parameters.get('theme') ?? 'light';
// The page that frames this story grows its type on a wide screen and asks the story to grow with it.
document.body.style.zoom = String(Math.min(Math.max(Number(parameters.get('zoom')) || 1, 1), 2));

function reportHeight(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  window.parent.postMessage({ type: 'oui-preview-height', frame: frameId, height }, window.location.origin);
}

function Frame({ storyModule }: { storyModule: StoryModule }) {
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Once by hand: a tab that is not on screen runs no resize observers, and its frames would keep their first size.
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.documentElement);
    if (canvas.current) void playStory(storyModule, storyName, canvas.current);
    return () => observer.disconnect();
  }, [storyModule]);
  return <div ref={canvas}><StoryView storyModule={storyModule} exportName={storyName} /></div>;
}

async function showStory(): Promise<void> {
  const loadModule = storyModules[`../stories/${fileName}.stories.tsx`];
  const root = createRoot(document.getElementById('root')!);
  if (!loadModule) {
    root.render(<p className="gallery-note">No such story file.</p>);
    return;
  }
  const storyModule = await loadModule() as StoryModule;
  root.render(storyName in storyModule ? <Frame storyModule={storyModule} /> : <p className="gallery-note">No such story.</p>);
}

void showStory();
