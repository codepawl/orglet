import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/*.{node,dll}' }, executableName: 'Orglet',
    // Regenerate with: node_modules/electron/dist/electron.exe scripts/build-icon.cjs
    icon: 'apps/desktop/assets/icon',
    // Vite's default ignores all node_modules, including external native dependencies.
    ignore: path => {
      const normalized = path.replaceAll('\\', '/');
      const included = ['/.vite', '/package.json', '/node_modules/@duckdb/node-api', '/node_modules/@duckdb/node-bindings', '/node_modules/@duckdb/node-bindings-win32-x64', '/node_modules/detect-libc'];
      return normalized !== '' && !included.some(root => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`));
    },
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['win32']), new MakerSquirrel({ name: 'orglet', setupIcon: 'apps/desktop/assets/icon.ico' })],
  plugins: [new VitePlugin({
    build: [
      { entry: 'apps/desktop/src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'apps/desktop/src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      { entry: 'apps/desktop/src/core/entry.ts', config: 'vite.core.config.ts' },
      { entry: 'apps/desktop/src/profiler/entry.ts', config: 'vite.profiler.config.ts' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
