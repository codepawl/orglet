import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { resolveOsxNotarize, resolveOsxSign } from './forge.macos';

// Ship only the Vite build plus DuckDB's native addon tree. pnpm installs the
// current platform's optional bindings; listing every OS here means a Mac make
// keeps darwin-arm64/x64 and a Windows make keeps win32, without pulling extras.
const included = [
  '/.vite',
  '/package.json',
  '/node_modules/@duckdb/node-api',
  '/node_modules/@duckdb/node-bindings',
  '/node_modules/@duckdb/node-bindings-win32-x64',
  '/node_modules/@duckdb/node-bindings-win32-arm64',
  '/node_modules/@duckdb/node-bindings-darwin-arm64',
  '/node_modules/@duckdb/node-bindings-darwin-x64',
  '/node_modules/detect-libc',
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/*.{node,dll,dylib,so}' },
    executableName: 'Orglet',
    appBundleId: 'com.codepawl.orglet',
    // Developer ID sign when APPLE_SIGNING_ENABLED=true (CI after P12 import).
    // Notarize only when Apple ID or App Store Connect API key env is complete.
    osxSign: resolveOsxSign(),
    osxNotarize: resolveOsxNotarize(),
    // Regenerate with: node_modules/electron/dist/electron.exe scripts/build-icon.cjs
    icon: 'apps/desktop/assets/icon',
    // Vite's default ignores all node_modules, including external native dependencies.
    ignore: path => {
      const normalized = path.replaceAll('\\', '/');
      return normalized !== '' && !included.some(root => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`));
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['win32', 'darwin']),
    new MakerSquirrel({ name: 'orglet', setupIcon: 'apps/desktop/assets/icon.ico' }),
  ],
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
