import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The README's rules for a component's stylesheet, checked on every one so a new component cannot quietly break them.
const componentsFolder = join(__dirname, '../src/components');
const stylesheets = readdirSync(componentsFolder)
  .filter(file => file.endsWith('.css'))
  .map(file => ({ file, css: readFileSync(join(componentsFolder, file), 'utf8') }));
const tokens = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf8');

function withoutComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('component stylesheets', () => {
  it('exist for every component', () => {
    const components = readdirSync(componentsFolder).filter(file => file.endsWith('.tsx'));
    expect(stylesheets.map(sheet => sheet.file).sort()).toEqual(components.map(file => file.replace('.tsx', '.css')).sort());
  });

  it.each(stylesheets)('$file names every class and keyframe with org-', ({ css }) => {
    const code = withoutComments(css);
    const classNames = Array.from(code.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), match => match[1]);
    const keyframes = Array.from(code.matchAll(/@keyframes\s+([\w-]+)/g), match => match[1]);
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames.filter(name => !name.startsWith('org-'))).toEqual([]);
    expect(keyframes.filter(name => !name.startsWith('org-'))).toEqual([]);
  });

  it.each(stylesheets)('$file stops its own animation under reduced motion', ({ css }) => {
    const code = withoutComments(css);
    if (!/\banimation\s*:/.test(code)) return;
    const reducedMotion = code.slice(code.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotion).toMatch(/animation:\s*none/);
  });

  it.each(stylesheets)('$file times its transitions with the motion tokens', ({ css }) => {
    const transitions = Array.from(withoutComments(css).matchAll(/transition:\s*([^;]+);/g), match => match[1]);
    for (const transition of transitions) {
      expect(transition).toMatch(/var\(--org-motion-/);
    }
  });
});

describe('tokens', () => {
  it('flatten every duration under reduced motion', () => {
    const durations = Array.from(tokens.matchAll(/(--org-motion-[\w-]+):/g), match => match[1]);
    const reducedMotion = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(durations.length).toBeGreaterThan(0);
    for (const duration of new Set(durations)) {
      expect(reducedMotion).toContain(`${duration}: 0ms`);
    }
  });
});
