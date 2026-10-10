import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_PARITY, COMMAND_PARITY, elevatedKeys, heldActionScope, type Parity } from '../../apps/desktop/src/cli/parity';
import { HELD_ACTIONS, type HeldAction } from '../../apps/desktop/src/cli/held-protocol';
import { commands } from '../../apps/desktop/src/shared/contracts';

const SOURCE_FOLDER = join(__dirname, '../../apps/desktop/src');

/** The method names of the window's `Bridge`, read from its interface: it has no runtime value outside the preload. */
function bridgeMethodNames(): string[] {
  const source = readFileSync(join(SOURCE_FOLDER, 'shared/contracts.ts'), 'utf8');
  const start = source.indexOf('export interface Bridge {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}([A-Za-z]\w*)[<(]/gm)].map(match => match[1]);
}

/** Everything the terminal's main-side files say, to find the core commands they send. */
function terminalSource(): string {
  const mainFolder = join(SOURCE_FOLDER, 'main');
  return readdirSync(mainFolder)
    .filter(file => /^cli-.*\.ts$/.test(file))
    .map(file => readFileSync(join(mainFolder, file), 'utf8'))
    .join('\n');
}

function isQuotedIn(source: string, name: string): boolean {
  return source.includes(`'${name}'`) || source.includes(`"${name}"`);
}

function sentCommand(entry: Parity, key: string): string {
  return entry.status === 'reached' && entry.through ? entry.through : key;
}

describe('the parity table of the orglet terminal command', () => {
  const commandKeys = Object.keys(commands);
  const bridgeKeys = bridgeMethodNames();

  it('reads the Bridge methods it is about', () => {
    expect(bridgeKeys.length).toBeGreaterThan(50);
    expect(bridgeKeys).toContain('call');
    expect(bridgeKeys).toContain('onBrowserLive');
  });

  it('gives every core command exactly one answer, and no answer to one that is gone', () => {
    const answered = Object.keys(COMMAND_PARITY);
    expect(commandKeys.filter(key => !answered.includes(key))).toEqual([]);
    expect(answered.filter(key => !commandKeys.includes(key))).toEqual([]);
  });

  it('gives every Bridge method exactly one answer, and no answer to one that is gone', () => {
    const answered = Object.keys(BRIDGE_PARITY);
    expect(bridgeKeys.filter(key => !answered.includes(key))).toEqual([]);
    expect(answered.filter(key => !bridgeKeys.includes(key))).toEqual([]);
  });

  it('says reached only for a command a terminal file sends, and never leaves a sent command as something else', () => {
    const source = terminalSource();
    const claimedButNotSent: string[] = [];
    const sentButNotClaimed: string[] = [];
    for (const [key, entry] of Object.entries(COMMAND_PARITY)) {
      const sent = isQuotedIn(source, sentCommand(entry, key));
      if (entry.status === 'reached' && !sent) claimedButNotSent.push(key);
      if (entry.status === 'elevated' && !sent) claimedButNotSent.push(key);
      if (entry.status !== 'reached' && entry.status !== 'elevated' && sent) sentButNotClaimed.push(key);
    }
    expect(claimedButNotSent).toEqual([]);
    expect(sentButNotClaimed).toEqual([]);
  });

  it('gives each answer the words it needs: a command for reached, a reason for the others', () => {
    for (const entry of [...Object.values(COMMAND_PARITY), ...Object.values(BRIDGE_PARITY)]) {
      if (entry.status === 'reached' || entry.status === 'elevated') expect(entry.command).toMatch(/^orglet\b/);
      else expect(entry.reason.length).toBeGreaterThan(5);
    }
  });

  it('keeps a held answer off the terminal: nothing held is sent by a terminal file', () => {
    const source = terminalSource();
    const held = Object.entries(COMMAND_PARITY).filter(([, entry]) => entry.status === 'held').map(([key]) => key);
    expect(held.filter(key => isQuotedIn(source, key))).toEqual([]);
  });

  it('derives the operations that need an elevation from the table: every elevated key belongs to a held action, and the reverse', () => {
    const fromActions = Object.values(HELD_ACTIONS).flatMap(action => action.keys).sort();
    expect(elevatedKeys().sort()).toEqual(fromActions);
  });

  it('gives every held action the scope its keys say, and never a scope above decisions in stage B', () => {
    for (const action of Object.keys(HELD_ACTIONS) as HeldAction[]) {
      expect(heldActionScope(action)).toBe('decisions');
    }
  });

  it('counts the four answers, so a change of the table shows in review', () => {
    const count = (status: Parity['status']) => Object.values(COMMAND_PARITY).filter(entry => entry.status === status).length;
    expect(count('reached') + count('elevated') + count('window-only') + count('held')).toBe(commandKeys.length);
    expect(Object.values(BRIDGE_PARITY).filter(entry => entry.status === 'reached')).toEqual([]);
  });
});
