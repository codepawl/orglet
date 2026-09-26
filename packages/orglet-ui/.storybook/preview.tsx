import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/styles/tokens.css';
import './preview.css';
import '../stories/gallery.css';

type ThemeName = 'light' | 'dark' | 'system';

/**
 * The kit picks its palette from `data-theme` on the root element, the same switch an application flips, so the
 * toolbar sets exactly that and nothing else. A story that looks wrong in one theme looks wrong in an app too.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? 'light') as ThemeName;
  document.documentElement.dataset.theme = theme;
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'The data-theme on the root element',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    // Accessibility is checked on every story; a violation is a failure, not a hint.
    a11y: { test: 'error' },
  },
};

export default preview;
