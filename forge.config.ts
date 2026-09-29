import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { resolveOsxNotarize, resolveOsxSign } from './forge.macos';
import { assertPackageSigned, resolveSquirrelSign, resolveWindowsCertificate, resolveWindowsSign } from './forge.windows';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
  // Both libc flavours: pnpm installs the one the build machine uses, and glibc and musl
  // builds of the same distribution need different addons.
  '/node_modules/@duckdb/node-bindings-linux-x64',
  '/node_modules/@duckdb/node-bindings-linux-x64-musl',
  '/node_modules/@duckdb/node-bindings-linux-arm64',
  '/node_modules/@duckdb/node-bindings-linux-arm64-musl',
  '/node_modules/detect-libc',
  // The browser host drives Chrome or Edge through it (COD-261). It has no dependencies of its own and no telemetry.
  '/node_modules/playwright-core',
  // Tacet's runtime (COD-303): ONNX Runtime's addon and the JavaScript API it implements. Its install-time helpers
  // (adm-zip, global-agent) only fetch the Linux CUDA provider and are not needed to run.
  '/node_modules/onnxruntime-node',
  '/node_modules/onnxruntime-common',
];

// onnxruntime-node ships every platform's binaries (about 300 MB); a build keeps only its own platform and architecture.
// Tacet runs on the CPU provider, which loads without DirectML (measured, COD-303), so the 38 MB of DirectML and its
// shader compiler stay out too.
const onnxBinaries = '/node_modules/onnxruntime-node/bin/napi-v6/';
const directMlFiles = ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll'];
function unusedOnnxBinary(path: string): boolean {
  if (!path.startsWith(onnxBinaries)) return false;
  const [platform, arch, file] = path.slice(onnxBinaries.length).split('/');
  if (platform !== process.platform) return true;
  if (arch !== undefined && arch !== process.arch) return true;
  return file !== undefined && directMlFiles.includes(file);
}

/** `ORGLET_UPDATE_TEST_BUILD=1` makes a build that proves the updater end to end; see docs/windows-release-gates.md. */
const updateTestBuild = process.env.ORGLET_UPDATE_TEST_BUILD === '1';

const config: ForgeConfig = {
  hooks: {
    generateAssets: async () => {
      execFileSync(process.execPath, [join(__dirname, 'scripts/build-workspace-native.mjs')], { windowsHide: true, stdio: 'inherit' });
    },
    postPackage: async (_config, packageResult) => {
      if (packageResult.platform === 'win32' && resolveWindowsCertificate()) {
        assertPackageSigned(packageResult.outputPaths);
      }
    },
  },
  packagerConfig: {
    extraResource: [
      ...(process.platform === 'win32' && process.arch === 'x64' ? [
        join(__dirname, 'node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe'),
        join(__dirname, 'node_modules/@microsoft/mxc-sdk/LICENSE.md'),
        join(__dirname, '.vite/build/workspace-helper.cjs'),
        join(__dirname, '.vite/build/workspace-dependency-hooks.cjs'),
        join(__dirname, 'out/native-tools/WorkspaceIntegrate.exe'),
      ] : []),
      // The `orglet` terminal command (COD-234): the script, and resources/bin with its cmd and sh launchers.
      join(__dirname, '.vite/build/orglet-cli.cjs'),
      join(__dirname, 'apps/desktop/bin'),
    ],
    asar: { unpack: '**/*.{node,dll,dylib,so}' },
    executableName: 'Orglet',
    appBundleId: 'com.codepawl.orglet',
    // Developer ID sign when APPLE_SIGNING_ENABLED=true (CI after P12 import).
    // Notarize only when Apple ID or App Store Connect API key env is complete.
    osxSign: resolveOsxSign(),
    osxNotarize: resolveOsxNotarize(),
    // Certum sign when WINDOWS_SIGNING_ENABLED=true (CI after SimplySign Desktop has logged in).
    windowsSign: resolveWindowsSign(),
    // Regenerate with: node_modules/electron/dist/electron.exe scripts/build-icon.cjs
    icon: 'apps/desktop/assets/icon',
    // Vite's default ignores all node_modules, including external native dependencies.
    ignore: path => {
      const normalized = path.replaceAll('\\', '/');
      if (unusedOnnxBinary(normalized)) return true;
      return normalized !== '' && !included.some(root => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`));
    },
  },
  rebuildConfig: {},
  makers: [
    // Linux ships as a ZIP for now: no deb or AppImage until someone is actually running it.
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
    // An update test build (COD-304) installs as its own Squirrel app, in %LOCALAPPDATA%\orgletupdtest, beside Orglet.
    new MakerSquirrel({ name: updateTestBuild ? 'orgletupdtest' : 'orglet', setupIcon: 'apps/desktop/assets/icon.ico', signWithParams: resolveSquirrelSign() }),
  ],
  plugins: [new VitePlugin({
    build: [
      { entry: 'apps/desktop/src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'apps/desktop/src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      { entry: 'apps/desktop/src/core/entry.ts', config: 'vite.core.config.ts' },
      { entry: 'apps/desktop/src/core/tools/pdf-text-worker.ts', config: 'vite.pdf-text.config.ts' },
      { entry: 'apps/desktop/src/core/decisions/worker.ts', config: 'vite.decisions.config.ts' },
      { entry: 'apps/desktop/src/profiler/entry.ts', config: 'vite.profiler.config.ts' },
      { entry: 'apps/desktop/src/browser/entry.ts', config: 'vite.browser.config.ts' },
      { entry: 'apps/desktop/src/core/tools/workspace-helper.ts', config: 'vite.workspace.config.ts' },
      { entry: 'apps/desktop/src/core/tools/dependency-hooks.ts', config: 'vite.dependency-hooks.config.ts' },
      { entry: 'apps/desktop/src/cli/main.ts', config: 'vite.cli.config.ts' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
