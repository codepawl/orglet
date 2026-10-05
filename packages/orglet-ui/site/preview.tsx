import { composeStories } from '@storybook/react-vite';
import { useEffect, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/tokens.css';
import '../.storybook/preview.css';
import '../stories/gallery.css';
import './preview.css';

// One story, alone in a frame. A frame keeps a story's dialogs, portals, focus traps and Escape handling to itself,
// so a page can show several of them at once.
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
  window.parent.postMessage({ type: 'orglet-ui-preview-height', frame: frameId, height }, window.location.origin);
}

function Frame({ Story }: { Story: ComponentType }) {
  useEffect(() => {
    // Once by hand: a tab that is not on screen runs no resize observers, and its frames would keep their first size.
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return <Story />;
}

async function showStory(): Promise<void> {
  const loadModule = storyModules[`../stories/${fileName}.stories.tsx`];
  const root = createRoot(document.getElementById('root')!);
  if (!loadModule) {
    root.render(<p className="gallery-note">No such story file.</p>);
    return;
  }
  const stories = composeStories(await loadModule() as Parameters<typeof composeStories>[0]) as Record<string, ComponentType>;
  const Story = stories[storyName];
  root.render(Story ? <Frame Story={Story} /> : <p className="gallery-note">No such story.</p>);
}

void showStory();
