import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commands } from '../../apps/desktop/src/shared/contracts';

/**
 * The IPC boundary rejects any command the core does not declare, with "Command không được phép." — which is what
 * the owner saw in the app on 2026-09-20. That error can only mean the renderer asked for a name that does not
 * exist, so it is a mistake that belongs in a failing test rather than in a red banner in front of a person.
 */
const rendererRoot = resolve(__dirname, '../../apps/desktop/src/renderer');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('every command the renderer calls', () => {
  const files = sourceFiles(rendererRoot);

  it('is declared in the contract', () => {
    const declared = new Set(Object.keys(commands));
    const unknown: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/orglet\.call\(\s*'([^']+)'/g)) {
        if (!declared.has(match[1])) unknown.push(`${match[1]} in ${file.slice(rendererRoot.length + 1)}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('is written as a literal, so this check can see it', () => {
    // A name built at runtime would slip past the check above and reach the IPC boundary instead.
    const dynamic: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/orglet\.call\(\s*([^'\s)])/g)) {
        dynamic.push(`${file.slice(rendererRoot.length + 1)}: orglet.call(${match[1]}…`);
      }
    }
    expect(dynamic).toEqual([]);
  });
});
