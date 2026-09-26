import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEPENDENCY_LINKS_VARIABLE, followDependencyLinks, parseDependencyLinks } from './dependency-links';

/**
 * Preloaded (`--require`) into every Node process a workspace command starts while installed dependencies are linked
 * into the copy (COD-271). Each resolved module, and each module that asks, is placed at the path its links lead to
 * inside the granted `node_modules`, so a pnpm package finds the dependencies installed beside it. See
 * `dependency-links.ts` for why the sandbox needs this.
 */
const pairs = parseDependencyLinks(process.env[DEPENDENCY_LINKS_VARIABLE]);

function followed(url: string | undefined): string | undefined {
  if (!url?.startsWith('file:')) return url;
  const file = fileURLToPath(url);
  const destination = followDependencyLinks(file, pairs);
  return destination === file ? url : pathToFileURL(destination).href;
}

if (pairs.length > 0) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, { ...context, parentURL: followed(context.parentURL) });
      return { ...result, url: followed(result.url) ?? result.url };
    },
  });
}
