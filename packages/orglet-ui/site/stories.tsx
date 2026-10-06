import { useMemo, type ComponentType, type ReactNode } from 'react';

// The stories are written for Storybook, but a story is only data: a component, some args, perhaps a render
// function and a decorator or two. Drawing one takes a few lines, so the site does it itself and never loads
// Storybook's runtime.
type StoryContext = { args: Record<string, unknown> };
type Decorator = (Story: ComponentType, context: StoryContext) => ReactNode;
type PlayContext = { canvasElement: HTMLElement; args: Record<string, unknown> };

type StoryMeta = {
  component?: ComponentType<Record<string, unknown>>;
  args?: Record<string, unknown>;
  decorators?: Decorator[];
  render?: (args: Record<string, unknown>) => ReactNode;
};

type StoryObject = {
  name?: string;
  args?: Record<string, unknown>;
  decorators?: Decorator[];
  render?: (args: Record<string, unknown>) => ReactNode;
  play?: (context: PlayContext) => Promise<void> | void;
};

export type StoryModule = { default: StoryMeta } & Record<string, StoryObject | StoryMeta>;

function storyOf(storyModule: StoryModule, exportName: string): StoryObject | undefined {
  const story = storyModule[exportName];
  return exportName === 'default' ? undefined : (story as StoryObject | undefined);
}

function StoryBody({ meta, story, args }: { meta: StoryMeta; story: StoryObject; args: Record<string, unknown> }) {
  const render = story.render ?? meta.render;
  if (render) return <>{render(args)}</>;
  const Component = meta.component;
  return Component ? <Component {...args} /> : null;
}

/** One story, drawn the way Storybook would: args merged, the render function or the component, decorators around it. */
export function StoryView({ storyModule, exportName }: { storyModule: StoryModule; exportName: string }) {
  // Built once per story: a component made anew on every render would remount, and a story would lose its state
  // each time the page around it redraws.
  const Wrapped = useMemo(() => {
    const meta = storyModule.default;
    const story = storyOf(storyModule, exportName);
    if (!story) return null;
    const args = { ...meta.args, ...story.args };
    const decorators = [...(story.decorators ?? []), ...(meta.decorators ?? [])];
    const Body: ComponentType = () => <StoryBody meta={meta} story={story} args={args} />;
    return decorators.reduce<ComponentType>((Inner, decorator) => () => <>{decorator(Inner, { args })}</>, Body);
  }, [storyModule, exportName]);
  return Wrapped ? <Wrapped /> : null;
}

/** Runs the story's `play` function, which a few stories use to open their menu or dialog. */
export async function playStory(storyModule: StoryModule, exportName: string, canvasElement: HTMLElement): Promise<void> {
  const story = storyOf(storyModule, exportName);
  if (!story?.play) return;
  try {
    await story.play({ canvasElement, args: { ...storyModule.default.args, ...story.args } });
  } catch {
    // A story that cannot reach its opened state still shows its resting one.
  }
}

/** The text of one story in its source file: from its `export const` to the next one. */
export function storySource(fileSource: string, exportName: string): string {
  const start = fileSource.search(new RegExp(`^export const ${exportName}\\b`, 'm'));
  if (start < 0) return '';
  const rest = fileSource.slice(start);
  const next = rest.slice(1).search(/^(\/\*\*|export const |function |const )/m);
  const text = next < 0 ? rest : rest.slice(0, next + 1);
  return text.replace(/\r\n/g, '\n').trimEnd();
}
