import react from '@vitejs/plugin-react';
import type { StorybookConfig } from '@storybook/react-vite';

// The kit's gallery. It lives in this package only: the Electron app never imports it, and the published package
// ships `dist` alone, so none of this reaches an installed application.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  // The kit has no Vite config of its own (tsdown builds it), so the React plugin is added here.
  viteFinal: viteConfig => ({ ...viteConfig, plugins: [...(viteConfig.plugins ?? []), react()] }),
};

export default config;
