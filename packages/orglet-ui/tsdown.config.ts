import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  // One output file per source module, so each component keeps its own stylesheet beside it and an application that
  // imports one component does not pull in the styles of the others.
  unbundle: true,
  fixedExtension: false,
  dts: true,
  // A component's `import './Switch.css'` stays in the emitted file as a side effect, and the stylesheet is copied
  // beside it unchanged. Run through a CSS pipeline it came out reordered and without its comments. The type
  // declarations leave the import out: a `.d.ts` that imports a stylesheet fails to resolve for TypeScript users.
  deps: { neverBundle: [/\.css$/], dts: { neverBundle: [] } },
  copy: [
    { from: 'src/components/*.css', to: 'dist/components' },
    // Not imported by any component: an application imports it once, as `@codepawl/orglet-ui/tokens.css`.
    { from: 'src/styles/tokens.css', to: 'dist' },
  ],
});
