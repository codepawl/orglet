import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const siteFolder = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(siteFolder, '..');
const outputFolder = join(packageRoot, 'site-dist');

// What an agent reads instead of the rendered pages: the same Markdown the site is built from, at stable URLs.
const AGENT_FILES = ['llms.txt', 'llms-full.txt', 'docs', 'skills'];

function agentFiles(): Plugin {
  return {
    name: 'orglet-ui-agent-files',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
        const isAgentFile = AGENT_FILES.some(name => pathname === `/${name}` || pathname.startsWith(`/${name}/`));
        const path = normalize(join(packageRoot, pathname));
        if (!isAgentFile || !path.startsWith(packageRoot) || !/\.(md|txt)$/.test(path) || !existsSync(path)) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(readFileSync(path));
      });
    },
    closeBundle() {
      for (const name of AGENT_FILES) cpSync(join(packageRoot, name), join(outputFolder, name), { recursive: true });
    },
  };
}

// The docs site. It is built from this package's own pages (docs/) and stories (stories/), and reads the kit's
// source directly, so it always shows what the next release ships. Nothing here is part of the published package.
export default defineConfig({
  root: siteFolder,
  plugins: [react(), agentFiles()],
  resolve: { alias: { '@codepawlhq/orglet-ui': join(packageRoot, 'src', 'index.ts') } },
  server: { port: 6007, fs: { allow: [packageRoot] } },
  build: {
    outDir: outputFolder,
    emptyOutDir: true,
    rollupOptions: { input: { index: join(siteFolder, 'index.html'), preview: join(siteFolder, 'preview.html') } },
  },
});
