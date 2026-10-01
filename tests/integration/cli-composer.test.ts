import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { StoppedError } from '../../apps/desktop/src/cli/client';
import { type ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { displayWidth, stripAnsi, type ColorMode } from '../../apps/desktop/src/cli/terminal';
import { type CliProgressFrame, type ListValue, type SendValue } from '../../apps/desktop/src/cli/protocol';
import type { ManagementCatalog, ManagementClient } from '../../apps/desktop/src/cli/management';

/** A terminal grid, so assertions see the final screen rather than text already erased by a redraw. */
class Screen {
  row = 0;
  column = 0;
  readonly lines: string[][] = [[]];
  write(text: string): void {
    for (const token of text.match(/\x1b\[[0-9;?]*[A-Za-z~]|[^\x1b]/gu) ?? []) {
      if (token.startsWith('\x1b')) {
        const amount = Number(token.slice(2, -1)) || 1;
        if (token.endsWith('H')) {
          const [row, column] = token.slice(2, -1).split(';').map(Number);
          this.row = Math.max(0, (row || 1) - 1);
          this.column = Math.max(0, (column || 1) - 1);
        }
        if (token.endsWith('A')) this.row = Math.max(0, this.row - amount);
        if (token.endsWith('C')) this.column += amount;
        if (token.endsWith('K')) this.lines[this.row] = [];
        if (token.endsWith('J')) {
          this.lines[this.row] ??= [];
          this.lines[this.row].length = this.column;
          this.lines.splice(this.row + 1);
        }
        continue;
      }
      if (token === '\r') this.column = 0;
      else if (token === '\n') this.row += 1;
      else {
        this.lines[this.row] ??= [];
        if (displayWidth(token) === 0) {
          const previous = this.column - 1;
          this.lines[this.row][previous] = (this.lines[this.row][previous] ?? '') + token;
          continue;
        }
        this.lines[this.row][this.column] = token;
        this.column += displayWidth(token);
      }
    }
  }
  text(): string {
    return this.lines.map(line => Array.from(line, character => character ?? ' ').join('')).join('\n');
  }
}

const pause = () => new Promise(resolve => setTimeout(resolve, 45));
const response = (message: string): SendValue => ({
  chat: { kind: 'worker', id: 'worker', name: 'Researcher' }, taskId: 'task', status: 'completed',
  waited: true, finished: true, answers: [{ name: 'Researcher', text: `Answer: ${message}`, createdAt: '1' }], errors: [],
});

async function terminal(options: { picker?: boolean; slow?: boolean; slowOpen?: boolean; columns?: number; rows?: number; mode?: ColorMode; list?: ListValue; reply?: string; management?: ManagementClient } = {}) {
  const screen = new Screen();
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(raw: boolean) { this.isRaw = raw; } });
  let transcript = '';
  const output = Object.assign(new Writable({ write(chunk, _encoding, callback) {
    transcript += chunk.toString();
    screen.write(chunk.toString());
    callback();
  } }), { isTTY: true, columns: options.columns ?? 80, rows: options.rows ?? 24 });
  const sent: string[] = [];
  const sentTo: string[] = [];
  const opened: string[] = [];
  let finishSend: (() => void) | undefined;
  let failOpen: (() => void) | undefined;
  let updateProgress: ((frame: CliProgressFrame) => void) | undefined;
  const client: ChatClient = {
    ...(options.management ? { management: options.management } : {}),
    list: async () => options.list ?? ({ orglets: [{ name: 'Researcher', provider: 'codex', model: 'configured-model', billing: 'CLI account', color: '#4f7fe0' }, { name: 'Kế toán', provider: 'codex', model: 'configured-model', color: '#64b282' }], crews: [] }),
    send: async (to, message, signal, progress) => {
      updateProgress = progress;
      sent.push(message);
      sentTo.push(to);
      if (options.slow) await new Promise<void>((resolve, reject) => {
        finishSend = resolve;
        signal.addEventListener('abort', () => reject(new StoppedError()), { once: true });
      });
      const value = response(message);
      if (options.reply) value.answers[0].text = options.reply;
      return value;
    },
    read: async () => ({ chat: response('').chat, taskId: 'task', status: 'completed', answers: response('earlier').answers }),
    open: async name => {
      opened.push(name);
      if (options.slowOpen) {
        await new Promise<void>((_resolve, reject) => {
          failOpen = () => reject(new Error('Could not open the desktop.'));
        });
      }
      return { chat: response('').chat };
    },
  };
  const running = runInteractive({ input, output, client, mode: options.mode ?? 'none', version: 'test', directory: 'C:/work/project', terminal: true, ...(options.picker ? {} : { to: 'Researcher' }) });
  await pause();
  return {
    screen, input, output, sent, sentTo, opened,
    transcript: () => transcript,
    key: async (text: string | Buffer) => { input.write(text); await pause(); },
    resolve: async () => { finishSend?.(); await pause(); },
    failOpen: async () => { failOpen?.(); await pause(); },
    progress: async (frame: CliProgressFrame) => { updateProgress?.(frame); await pause(); },
    stop: async () => { input.end(); await running; },
  };
}

describe('terminal composer', () => {
  it.each([80, 120])('spreads picker shortcuts across %s columns', async columns => {
    const session = await terminal({ picker: true, columns });
    try {
      const lines = session.screen.text().split('\n');
      const navigation = lines.find(line => line.includes('↑↓ move'))!;
      const management = lines.find(line => line.includes('Ctrl+N create'))!;
      expect(navigation).toMatch(/move\s{3,}type to filter/);
      expect(navigation.trimEnd()).toMatch(/Ctrl\+C exit$/);
      expect(displayWidth(navigation)).toBe(columns - 1);
      expect(management).toMatch(/create\s{3,}← selected item menu/);
      expect(displayWidth(management)).toBe(columns - 1);
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('wraps shortcut groups in a narrow terminal without hiding the selection', async () => {
    const session = await terminal({ picker: true, columns: 32, rows: 24 });
    try {
      const screen = session.screen.text();
      for (const hint of ['↑↓ move', 'type to filter', 'Enter opens', 'Ctrl+C exit', 'Ctrl+N create', '← selected item menu']) {
        expect(screen).toContain(hint);
      }
      expect(screen).toContain('› ▐••▌ Researcher');
      expect(session.screen.lines.length).toBeLessThan(24);
      for (const line of screen.split('\n')) {
        expect(displayWidth(line)).toBeLessThan(32);
      }
    } finally {
      await session.stop();
    }
  });

  function managementFixture() {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    const crewId = '33333333-3333-4333-8333-333333333333';
    const skillId = '44444444-4444-4444-8444-444444444444';
    const list: ListValue = {
      orglets: [
        { name: 'Researcher', provider: 'codex', model: 'configured-model', color: '#4f7fe0' },
        { name: 'Kế toán', provider: 'codex', model: 'another-model', color: '#3f9a68' },
      ],
      crews: [{ name: 'Review crew', members: ['Kế toán'], lead: 'Researcher' }],
    };
    const catalog: ManagementCatalog = {
      orglets: [workerId, otherId].map((id, index) => ({ id, revision: 1, config: {
        name: list.orglets[index].name, provider: 'codex', modelId: list.orglets[index].model,
        skillId, instructions: 'Review the supplied files.', avatar: { color: list.orglets[index].color },
      } })),
      crews: [{ id: crewId, revision: 1, config: { name: 'Review crew', memberIds: [otherId], synthesizerId: workerId, workflow: 'parallel', monthlyBudgetMicros: 1000000, instructions: 'Review together.' } }],
      skills: [{ id: skillId, name: 'Review' }], providers: [{ id: 'codex', name: 'Codex' }],
    };
    const saved: { id: string; name: string }[] = [];
    const deleted: string[] = [];
    const management: ManagementClient = {
      catalog: async () => catalog,
      saveOrglet: async (config, target) => {
        const index = catalog.orglets.findIndex(entry => entry.id === target?.id);
        if (index < 0) throw new Error('This fixture edits existing orglets only.');
        const orglet = catalog.orglets[index];
        Object.assign(orglet.config, config);
        orglet.revision += 1;
        list.orglets[index].name = orglet.config.name;
        saved.push({ id: orglet.id, name: orglet.config.name });
        return { kind: 'worker', id: orglet.id, name: orglet.config.name, revision: orglet.revision };
      },
      saveCrew: async () => { throw new Error('Unexpected crew mutation'); },
      delete: async (_kind, target) => {
        deleted.push(target.id);
        throw new Error('Unexpected deletion');
      },
    };
    return { list, catalog, management, saved, deleted, otherId };
  }

  it('shows per-entity icons and model details without changing the command inserted by Tab', async () => {
    const fixture = managementFixture();
    const session = await terminal(fixture);
    try {
      await session.key('/edit ');
      const screen = session.screen.text();
      expect(screen).toContain('▐••▌ Researcher');
      expect(screen).toContain('codex/configured-model');
      expect(screen).toContain('▦ Review crew');
      expect(screen).toContain('crew · lead Researcher');
      expect(screen).not.toContain('Edit configuration; without a name');
      await session.key('\x1b[B');
      await session.key('\t');
      expect(session.screen.text()).toContain('› /edit Kế toán');
      await session.key('\r');
      expect(session.screen.text()).toContain('▐••▌ Edit orglet · Kế toán');
      expect(session.screen.text()).toContain('Codex · another-model');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it.each([[80, 24], [32, 10]])('opens the highlighted filtered orglet menu and preserves selection at %s × %s', async (columns, rows) => {
    const fixture = managementFixture();
    const session = await terminal({ ...fixture, picker: true, columns, rows });
    try {
      await session.key('Kế');
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('Manage orglet');
      expect(session.screen.text()).toContain('Edit configuration');
      await session.key('\x1b[B');
      await session.key('\r');
      expect(session.screen.text()).toContain('Type Kế toán to delete');
      await session.key('\r');
      expect(fixture.deleted).toEqual([]);
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› Kế');
      expect(session.screen.text()).toContain('1/2');
      await session.key('\x1b[D');
      await session.key('\r');
      expect(session.screen.text()).toContain('Edit orglet');
      await session.key('Name');
      await session.key('\r');
      await session.key('\x15');
      await session.key('Kế toán edited');
      await session.key('\r');
      await session.key('Save');
      await session.key('\r');
      expect(fixture.saved).toEqual([{ id: fixture.otherId, name: 'Kế toán edited' }]);
      expect(session.sent).toEqual([]);
      expect(session.screen.text()).toContain('Kế toán edited');
      for (const line of session.screen.text().split('\n')) {
        expect(displayWidth(line)).toBeLessThan(columns);
      }
    } finally {
      await session.stop();
    }
  });

  it('opens the selected crew menu with group icon and retains its row after cancel', async () => {
    const fixture = managementFixture();
    const session = await terminal({ ...fixture, picker: true });
    try {
      await session.key('\x1b[A');
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('▦ Manage channel · Review crew');
      expect(session.screen.text()).toContain('Lead: Researcher');
      await session.key('\x1b[B');
      await session.key('\r');
      expect(session.screen.text()).toContain('Type Review crew to delete');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› ▦    Review crew');
      await session.key('\x1b[D');
      await session.key('\r');
      expect(session.screen.text()).toContain('▦ Edit channel · Review crew');
      expect(fixture.deleted).toEqual([]);
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('opens Ctrl+N creation choices without replacing a draft or an unsaved form', async () => {
    const fixture = managementFixture();
    const session = await terminal(fixture);
    try {
      await session.key('valuable draft');
      await session.key('\x0e');
      expect(session.screen.text()).toContain('Create orglet or channel');
      await session.key('\x1b[B');
      await session.key('\r');
      expect(session.screen.text()).toContain('Create channel');
      await session.key('Name');
      await session.key('\r');
      await session.key('Unsaved crew');
      await session.key('\x0e');
      expect(session.screen.text()).toContain('Unsaved crew');
      await session.key('\x1b');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('valuable draft');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('holds queued messages while the Ctrl+N form is open and resumes on cancel', async () => {
    const fixture = managementFixture();
    const session = await terminal({ ...fixture, slow: true });
    try {
      await session.key('first');
      await session.key('\r');
      await session.key('second');
      await session.key('\r');
      await session.key('draft after queue');
      await session.key('\x0e');
      expect(session.screen.text()).toContain('Create orglet or channel');
      await session.resolve();
      expect(session.sent).toEqual(['first']);
      await session.key('\x1b');
      expect(session.sent).toEqual(['first', 'second']);
      expect(session.sentTo).toEqual(['Researcher', 'Researcher']);
      expect(session.screen.text()).toContain('draft after queue');
      await session.resolve();
    } finally {
      await session.resolve();
      await session.stop();
    }
  });

  it('cancels a pending configuration load and ignores its late reply without sending input', async () => {
    const fixture = managementFixture();
    let resolveCatalog: (() => void) | undefined;
    let reads = 0;
    const session = await terminal({ ...fixture, management: { ...fixture.management, catalog: async () => {
      reads += 1;
      if (reads === 1) await new Promise<void>(resolve => { resolveCatalog = resolve; });
      return fixture.catalog;
    } } });
    try {
      await session.key('keep this draft');
      await session.key('\x0e');
      await session.key('\x0e');
      expect(reads).toBe(1);
      expect(session.screen.text()).toContain('Opening configuration');
      await session.key('\r');
      expect(session.sent).toEqual([]);
      await session.key('\x1b');
      resolveCatalog?.();
      await pause();
      expect(session.screen.text()).not.toContain('Create orglet or channel');
      expect(session.screen.text()).toContain('keep this draft');
      await session.key('\x0e');
      expect(reads).toBe(2);
      expect(session.screen.text()).toContain('Create orglet or channel');
    } finally {
      resolveCatalog?.();
      await session.stop();
    }
  });

  it('keeps the current chat when editing or deleting another entry and restores a canceled picker draft', async () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    const skillId = '33333333-3333-4333-8333-333333333333';
    const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'codex' }, { name: 'Other', provider: 'codex' }], crews: [] };
    const catalog: ManagementCatalog = {
      orglets: [workerId, otherId].map((id, index) => ({ id, revision: 1, config: { name: list.orglets[index].name, provider: 'codex', skillId, instructions: 'Review' } })),
      crews: [], skills: [], providers: [{ id: 'codex', name: 'Codex' }],
    };
    const session = await terminal({ list, management: {
      catalog: async () => catalog,
      saveOrglet: async config => {
        list.orglets[1].name = config.name!;
        catalog.orglets[1].config.name = config.name!;
        catalog.orglets[1].revision += 1;
        return { kind: 'worker', id: otherId, name: config.name!, revision: 2 };
      }, saveCrew: async () => { throw new Error('Not a crew'); },
      delete: async (kind, target, confirmName) => {
        list.orglets.pop();
        catalog.orglets.pop();
        return { kind, id: target.id, name: confirmName, revision: target.revision, deleted: true };
      },
    } });
    try {
      await session.key('/edit Other'); await session.key('\r');
      await session.key('Name'); await session.key('\r');
      await session.key('\x15'); await session.key('Edited other'); await session.key('\r');
      await session.key('Save'); await session.key('\r');
      expect(session.screen.text()).toContain('Researcher');
      await session.key('/delete Edited other'); await session.key('\r');
      await session.key('Edited other'); await session.key('\r');
      expect(session.screen.text()).toContain('Researcher');
      expect(session.screen.text()).not.toContain('Search orglets');
      await session.key('valuable draft');
      await session.key('\x10');
      await session.key('/new'); await session.key('\r');
      await session.key('\x1b'); await session.key('\x1b');
      expect(session.screen.text()).toContain('› valuable draft');
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });
  it('updates a renamed current chat before resuming messages held behind its editor', async () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const skillId = '22222222-2222-4222-8222-222222222222';
    const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'codex' }], crews: [] };
    const session = await terminal({ slow: true, list, management: {
      catalog: async () => ({ orglets: [{ id: workerId, revision: 1, config: { name: 'Researcher', provider: 'codex', skillId, instructions: 'Review' } }], crews: [], skills: [{ id: skillId, name: 'Research' }], providers: [{ id: 'codex', name: 'Codex' }] }),
      saveOrglet: async config => {
        list.orglets[0].name = config.name!;
        return { kind: 'worker', id: workerId, name: config.name!, revision: 2 };
      }, saveCrew: async () => { throw new Error('Not a crew'); }, delete: async () => { throw new Error('Not deleting'); },
    } });
    try {
      await session.key('first message'); await session.key('\r');
      await session.key('/edit'); await session.key('\r');
      await session.key('held message'); await session.key('\r');
      await session.resolve();
      await session.key('Name'); await session.key('\r');
      await session.key('\x15'); await session.key('Renamed'); await session.key('\r');
      await session.key('Save'); await session.key('\r');
      expect(session.sent).toEqual(['first message', 'held message']);
      expect(session.sentTo).toEqual(['Researcher', 'Renamed']);
      await session.resolve();
      expect(session.screen.text()).toContain('Saved orglet Renamed.');
    } finally { await session.stop(); }
  });

  it('keeps locally queued messages safe when the current chat is selected for deletion', async () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const skillId = '22222222-2222-4222-8222-222222222222';
    let deletes = 0;
    const session = await terminal({ slow: true, management: {
      catalog: async () => ({ orglets: [{ id: workerId, revision: 1, config: { name: 'Researcher', provider: 'codex', skillId, instructions: 'Review' } }], crews: [], skills: [], providers: [{ id: 'codex', name: 'Codex' }] }),
      saveOrglet: async () => { throw new Error('Not saving'); }, saveCrew: async () => { throw new Error('Not saving'); },
      delete: async () => { deletes += 1; return { kind: 'worker', id: workerId, name: 'Researcher', revision: 1, deleted: true }; },
    } });
    try {
      await session.key('first message'); await session.key('\r');
      await session.key('/delete'); await session.key('\r');
      await session.key('held message'); await session.key('\r');
      await session.resolve();
      await session.key('Researcher'); await session.key('\r');
      expect(deletes).toBe(0);
      expect(session.screen.text()).toContain('This terminal has queued');
      await session.key('\x1b');
      expect(session.sentTo).toEqual(['Researcher', 'Researcher']);
      await session.resolve();
    } finally { await session.stop(); }
  });

  it('saves a crew through the raw keyboard form with members, lead and limits', async () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const skillId = '22222222-2222-4222-8222-222222222222';
    const crewId = '33333333-3333-4333-8333-333333333333';
    const saved: unknown[] = [];
    const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'codex' }], crews: [] };
    const session = await terminal({ picker: true, list, management: {
      catalog: async () => ({ orglets: [{ id: workerId, revision: 1, config: { name: 'Researcher', provider: 'codex', skillId, instructions: 'Review' } }], crews: [], skills: [], providers: [{ id: 'codex', name: 'Codex' }] }),
      saveOrglet: async () => { throw new Error('Not an orglet'); },
      saveCrew: async config => {
        saved.push(config);
        list.crews.push({ name: config.name!, lead: 'Researcher', members: ['Researcher'] });
        return { kind: 'team', id: crewId, name: config.name!, revision: 1 };
      }, delete: async () => { throw new Error('Not deleting'); },
    } });
    try {
      await session.key('/new crew'); await session.key('\r');
      await session.key('Name'); await session.key('\r');
      await session.key('Review crew'); await session.key('\r');
      await session.key('Instructions'); await session.key('\r');
      await session.key('Review together'); await session.key('\r');
      await session.key('Members'); await session.key('\r');
      await session.key('\r');
      await session.key('Done'); await session.key('\r');
      await session.key('Save'); await session.key('\r');
      expect(saved).toEqual([{ name: 'Review crew', instructions: 'Review together', memberIds: [workerId], synthesizerId: workerId, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 }]);
      expect(session.sent).toEqual([]);
      expect(session.screen.text()).toContain('Saved channel Review crew.');
    } finally { await session.stop(); }
  });

  it('creates and edits in forms, never sends field values as messages, and cancels deletion with Esc', async () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const skillId = '22222222-2222-4222-8222-222222222222';
    const catalog: ManagementCatalog = {
      orglets: [{ id: workerId, revision: 1, config: { name: 'Researcher', provider: 'codex', modelId: 'configured-model', instructions: 'Research the supplied work.', skillId } }],
      crews: [], skills: [{ id: skillId, name: 'Research' }], providers: [{ id: 'codex', name: 'Codex' }],
    };
    const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'codex', model: 'configured-model' }], crews: [] };
    const saved: unknown[] = [];
    const removed: unknown[] = [];
    const session = await terminal({ picker: true, list, management: {
      catalog: async () => catalog,
      saveOrglet: async (config, target) => {
        saved.push({ config, target });
        list.orglets[0].name = config.name!;
        catalog.orglets[0].config.name = config.name!;
        catalog.orglets[0].revision += 1;
        return { kind: 'worker', id: workerId, name: config.name!, revision: catalog.orglets[0].revision };
      },
      saveCrew: async () => { throw new Error('Unexpected crew save'); },
      delete: async (kind, target, confirmName) => {
        removed.push({ kind, target, confirmName });
        return { kind, id: target.id, name: confirmName, revision: target.revision, deleted: true };
      },
    } });
    try {
      await session.key('/new orglet');
      expect(session.screen.text()).toContain('Create an orglet or channel in this terminal');
      await session.key('\r');
      expect(session.screen.text()).toContain('Create orglet');
      await session.key('Name');
      await session.key('\r');
      await session.key('Terminal worker');
      await session.key('\r');
      await session.key('Instructions');
      await session.key('\r');
      await session.key('Work on the supplied files.');
      await session.key('\r');
      await session.key('Save');
      await session.key('\r');
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ config: { name: 'Terminal worker', provider: 'codex', instructions: 'Work on the supplied files.' } });
      expect(session.sent).toEqual([]);
      expect(session.screen.text()).toContain('Saved orglet Terminal worker.');
      await session.key('/edit');
      await session.key('\r');
      expect(session.screen.text()).toContain('Edit orglet · Terminal worker');
      await session.key('Connection');
      await session.key('\r');
      await session.key('\r');
      await session.key('\x1b');
      await session.key('/delete');
      await session.key('\r');
      expect(session.screen.text()).toContain('Type Terminal worker to delete');
      await session.key('\r');
      expect(removed).toEqual([]);
      expect(session.screen.text()).toContain('name must match exactly');
      await session.key('\x1b');
      expect(session.screen.text()).not.toContain('Delete orglet');
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });

  it.each([[80, 24], [32, 10]])('keeps the configuration selection and input visible at %s × %s', async (columns, rows) => {
    const session = await terminal({ columns, rows, picker: true, management: {
      catalog: async () => ({ orglets: [], crews: [], skills: [], providers: [{ id: 'codex', name: 'Codex' }] }),
      saveOrglet: async () => { throw new Error('Not saved'); }, saveCrew: async () => { throw new Error('Not saved'); }, delete: async () => { throw new Error('Not deleted'); },
    } });
    try {
      await session.key('/new crew');
      await session.key('\r');
      await session.key('Save');
      expect(session.screen.text()).toContain('› Save');
      expect(session.screen.lines.length).toBeLessThan(rows);
      expect(session.screen.lines.every(line => line.length < columns)).toBe(true);
      await session.key('\x1b');
      expect(session.screen.text()).toContain('Orglets');
    } finally { await session.stop(); }
  });
  it('updates chronological steps above the draft, collapses finished details, and preserves the draft on disclosure and resize', async () => {
    const session = await terminal({ slow: true, mode: 'truecolor' });
    const startedAt = '2026-09-28T10:00:00.000Z';
    const thinking = { id: 'model:1', runId: 'run', taskId: 'task', kind: 'model' as const, state: 'running' as const,
      label: 'thinking', name: 'Researcher', startedAt, updatedAt: startedAt, detail: 'Public summary details' };
    try {
      await session.key('check notes');
      await session.key('\r');
      await session.key('unsent draft');
      await session.progress({ type: 'progress', taskId: 'task', steps: [thinking], omitted: 0 });
      expect(session.screen.text()).toContain('00:00 ● Thinking…');
      expect(session.screen.text()).toContain('› unsent draft');
      const finished = { ...thinking, state: 'completed' as const, updatedAt: '2026-09-28T10:00:02.000Z' };
      const tool = { ...thinking, id: 'read', kind: 'tool' as const, label: 'workspace_read', detail: 'notes.txt', startedAt: '2026-09-28T10:00:02.000Z' };
      await session.progress({ type: 'progress', taskId: 'task', steps: [finished, tool], omitted: 0 });
      expect(session.screen.text()).toMatch(/00:00 ▸ Model responded\n00:02 ● Read file · notes.txt/);
      expect(session.screen.text()).not.toContain('Public summary details');
      await session.key('\x0f');
      expect(session.screen.text()).toContain('Public summary details');
      expect(session.screen.text()).toContain('› unsent draft');
      session.output.columns = 32;
      session.output.rows = 10;
      session.output.emit('resize');
      await pause();
      expect(session.screen.text()).toContain('› unsent draft');
      expect(session.screen.lines.length).toBeLessThanOrEqual(9);
      expect(session.screen.lines.every(line => displayWidth(line.join('')) <= 32)).toBe(true);
      await session.resolve();
      expect(session.screen.text()).toContain('› unsent draft');
      expect(session.sent).toEqual(['check notes']);
    } finally {
      await session.stop();
    }
  });

  it('puts search guidance inside the empty input and separates orglets from channels', async () => {
    const session = await terminal({ picker: true, list: {
      orglets: [{ name: 'Researcher', provider: 'codex' }, { name: 'Writer', provider: 'codex' }],
      crews: [{ name: 'Review crew', lead: 'Writer', members: ['Researcher'] }],
    } });
    try {
      const screen = session.screen.text();
      expect(screen).toContain('› Search orglets or channels…');
      expect(screen).not.toContain('Open ›');
      expect(session.screen.column).toBe(2);
      expect(screen).toMatch(/  \[ Orglets · 2 \]\n› ▐••▌ Researcher[^\n]*\n  ▐••▌ Writer[^\n]*\n\n  \[ Channels · 1 ]\n  ▦\s+Review crew/);
      await session.key('review');
      expect(session.screen.text()).toContain('› review');
      expect(session.screen.text()).not.toContain('Search orglets or channels');
      expect(session.screen.text()).not.toContain('[ Orglets');
      expect(session.screen.text()).toContain('[ Channels · 1 ]');
      await session.key('\x15');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      await session.key('review');
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglet test · Review crew');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('keeps the selected crew and its heading visible in a short picker viewport', async () => {
    const session = await terminal({ picker: true, columns: 32, rows: 10, list: {
      orglets: Array.from({ length: 6 }, (_, index) => ({ name: `Orglet ${index + 1}`, provider: 'codex' })),
      crews: [{ name: 'Review crew', lead: 'Orglet 1', members: ['Orglet 2'] }],
    } });
    try {
      await session.key('\x1b[A');
      expect(session.screen.text()).toContain('[ Channels · 1 ]');
      expect(session.screen.text()).toContain('› ▦    Review crew');
      expect(session.screen.lines.length).toBeLessThanOrEqual(9);
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglet test · Review crew');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('keeps a single product header and separates turns from the composer between two rules', async () => {
    const session = await terminal({ mode: 'truecolor' });
    try {
      await session.key('hello');
      await session.key('\r');
      const screen = session.screen.text();
      expect(screen).toContain('Orglet test · Researcher');
      expect(screen).toContain('configured-model · codex');
      expect(screen).toContain('CLI account');
      expect(screen).toContain('C:/work/project');
      expect(screen).toContain('You › hello');
      expect(screen).toContain('Researcher · 0s');
      expect(screen).toContain('Answer: hello');
      expect(screen.match(/─{20,}/g)).toHaveLength(2);
      expect(screen).not.toContain('▐^^▌');
      expect(screen.match(/Orglet test/g)).toHaveLength(1);
      expect(session.screen.lines).toHaveLength(23);
      expect(session.screen.text().split('\n').at(-2)).toContain('message · ready');
    } finally {
      await session.stop();
    }
  });

  it('expands saved answer details, scrolls history and opens agents without losing the draft', async () => {
    const reply = Array.from({ length: 24 }, (_, index) => `Detail ${index + 1}`).join('\n');
    const session = await terminal({ reply });
    try {
      await session.key('long reply');
      await session.key('\r');
      expect(session.screen.text()).toContain('more lines · Ctrl+O expands');
      expect(session.screen.text()).not.toContain('Detail 24');
      await session.key('unsent draft');
      await session.key('\x0f');
      expect(session.screen.text()).toContain('Detail 24');
      expect(session.screen.text()).toContain('› unsent draft');
      await session.key('\x1b[5~');
      expect(session.screen.text()).not.toContain('Detail 24');
      await session.key('\x07');
      expect(session.screen.text()).toContain('Agents · Researcher');
      expect(session.screen.text()).toContain('Plan tier: not reported');
      expect(session.screen.text()).toContain('Thinking effort: provider default');
      expect(session.screen.text()).toContain('› unsent draft');
      await session.key('\x1b');
      expect(session.screen.text()).not.toContain('Agents · Researcher');
      expect(session.screen.text()).toContain('› unsent draft');
      expect(session.sent).toEqual(['long reply']);
    } finally {
      await session.stop();
    }
  });

  it('uses Left for the chat picker only with an empty draft and keeps each chat transcript separate', async () => {
    const session = await terminal();
    try {
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      expect(session.screen.text()).not.toContain('Agents · Researcher');
      await session.key('\x1b');
      await session.key('hello');
      await session.key('\x1b[D');
      await session.key('X');
      expect(session.screen.text()).toContain('› hellXo');
      expect(session.screen.text()).not.toContain('Agents · Researcher');
      await session.key('\r');
      expect(session.screen.text()).toContain('Answer: hellXo');
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      expect(session.screen.text()).not.toContain('Answer: hellXo');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('Answer: hellXo');
      await session.key('/to Kế toán');
      await session.key('\r');
      expect(session.screen.text()).not.toContain('Answer: hellXo');
      await session.key('/to Researcher');
      await session.key('\r');
      expect(session.screen.text()).toContain('Answer: hellXo');
    } finally {
      await session.stop();
    }
  });

  it('uses queue and undo shortcuts during a wait and refuses to overwrite an unsent draft', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('queued');
      await session.key('\r');
      await session.key('\x11');
      expect(session.screen.text()).toContain('1. queued');
      await session.key('keep this');
      await session.key('\x1a');
      expect(session.screen.text()).toContain('› keep this');
      expect(session.screen.text()).toContain('1 queued');
      await session.key('\x15');
      await session.key('\x1a');
      expect(session.screen.text()).toContain('› queued');
      expect(session.sent).toEqual(['active']);
      await session.resolve();
      expect(session.sent).toEqual(['active']);
    } finally {
      await session.stop();
    }
  });

  it('keeps an unsent draft when the chat picker is dismissed or another chat is opened', async () => {
    const session = await terminal();
    try {
      await session.key('keep my draft');
      await session.key('\x10');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› keep my draft');
      await session.key('\x10');
      await session.key('Kế toán');
      await session.key('\r');
      expect(session.screen.text()).not.toContain('keep my draft');
      await session.key('\x10');
      await session.key('Researcher');
      await session.key('\r');
      expect(session.screen.text()).toContain('› keep my draft');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it.each([false, true])('refuses Demo sends, including a crew with a Demo member (%s)', async crew => {
    const list: ListValue = {
      orglets: [{ name: 'Researcher', provider: crew ? 'codex' : 'demo' }, { name: 'Sample', provider: 'demo' }],
      crews: crew ? [{ name: 'Review', lead: 'Researcher', members: ['Sample'] }] : [],
    };
    const session = await terminal({ list });
    try {
      if (crew) {
        await session.key('/to Review');
        await session.key('\r');
      }
      await session.key('real answer please');
      await session.key('\r');
      expect(session.sent).toEqual([]);
      expect(session.screen.text()).toContain('Nothing was sent: this chat uses Demo.');
    } finally {
      await session.stop();
    }
  });

  it.each([4, 5, 6, 8, 10, 24])('bounds the coloured viewport and multiline cursor within %s rows after resize', async rows => {
    const session = await terminal({ mode: 'truecolor', columns: 40, rows });
    try {
      await session.key('\x1b[200~' + 'Kế toán 日本\n'.repeat(20) + '\x1b[201~');
      expect(session.screen.lines.length).toBeLessThan(rows);
      expect(session.screen.row).toBeLessThan(rows);
      expect(session.screen.text()).not.toContain('[38;');
      session.output.columns = 32;
      session.output.emit('resize');
      expect(session.screen.lines.length).toBeLessThan(rows);
      expect(session.screen.text()).not.toContain('[38;');
      expect(session.sent).toEqual([]);
    } finally {
      await session.stop();
    }
  });

  it('shows the local queue and restores its last multiline item for editing without stopping the active turn', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('first queued');
      await session.key('\r');
      await session.key('\x1b[200~Kế toán\n日本\x1b[201~');
      await session.key('\r');
      await session.key('/queue');
      await session.key('\r');
      expect(session.screen.text()).toContain('Waiting in this terminal (2)');
      expect(session.screen.text()).toContain('1. first queued');
      expect(session.screen.text()).toContain('2. Kế toán 日 本');
      await session.key('/undo');
      await session.key('\r');
      expect(session.screen.text()).toContain('› Kế toán\n  日 本');
      expect(session.screen.text()).toContain('1 queued');
      expect(session.screen.text()).toContain('working');
      expect(session.sent).toEqual(['active']);
      await session.key(' edited');
      await session.key('\r');
      await session.resolve();
      expect(session.sent).toEqual(['active', 'first queued']);
      await session.resolve();
      expect(session.sent).toEqual(['active', 'first queued', 'Kế toán\n日本 edited']);
      await session.resolve();
    } finally {
      await session.stop();
    }
  });

  it('opens the active chat and shows help immediately while queued chat switches retain their order', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('/to Kế toán');
      await session.key('\r');
      await session.key('next chat');
      await session.key('\r');
      await session.key('/open');
      await session.key('\r');
      expect(session.opened).toEqual(['Researcher']);
      await session.key('/help');
      await session.key('\r');
      expect(session.screen.text()).toContain('/queue');
      expect(session.screen.text()).toContain('/undo');
      expect(session.screen.text()).toContain('2 queued');
      await session.key('/clear');
      await session.key('\r');
      expect(session.screen.text()).toContain('working');
      await session.key('/queue');
      await session.key('\r');
      expect(session.screen.text()).toContain('1. /to Kế toán');
      expect(session.screen.text()).toContain('2. next chat');
      await session.resolve();
      expect(session.sentTo).toEqual(['Researcher', 'Kế toán']);
      await session.resolve();
    } finally {
      await session.stop();
    }
  });

  it('reports an empty queue without cancelling a sent turn, and bounds queue previews in a narrow terminal', async () => {
    const session = await terminal({ slow: true, columns: 32, rows: 10 });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('/queue');
      await session.key('\r');
      expect(session.screen.text()).toContain('Nothing is waiting in this');
      await session.key('/undo');
      await session.key('\r');
      expect(session.screen.text()).toContain('No queued items to edit.');
      expect(session.screen.text()).toContain('working');
      const longMessage = 'Kế toán 日本 '.repeat(20);
      await session.key(longMessage);
      await session.key('\r');
      await session.key('/queue');
      await session.key('\r');
      // Screen.text adds placeholder cells after wide characters; measure the emitted row itself.
      const preview = stripAnsi(session.transcript()).split(/\r?\n/).find(line => line.startsWith('1. '));
      expect(preview).toBeDefined();
      expect(displayWidth(preview!)).toBeLessThan(32);
      expect(session.sent).toEqual(['active']);
      await session.key('/undo');
      await session.key('\r');
      await session.key('\r');
      await session.resolve();
      expect(session.sent).toEqual(['active', longMessage.trim()]);
      await session.resolve();
    } finally {
      await session.stop();
    }
  });

  it('keeps a new draft and the active wait intact when an immediate desktop-open request fails later', async () => {
    const session = await terminal({ slow: true, slowOpen: true });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('/open');
      await session.key('\r');
      expect(session.opened).toEqual(['Researcher']);
      await session.key('unsent draft');
      await session.failOpen();
      expect(session.screen.text()).toContain('Could not open the desktop.');
      expect(session.screen.text()).toContain('› unsent draft');
      expect(session.screen.text()).toContain('working');
      expect(session.sent).toEqual(['active']);
    } finally {
      await session.stop();
    }
  });

  it.each(['truecolor', 'ansi256'] as const)('renders a compact %s queue status without broken colour controls', async mode => {
    const session = await terminal({ slow: true, columns: 32, rows: 10, mode });
    try {
      await session.key('active');
      await session.key('\r');
      await session.key('pending');
      await session.key('\r');
      expect(session.screen.text()).toContain('queue · working · 1 queued');
      expect(session.screen.text()).not.toContain('[38;');
      await session.resolve();
      await session.resolve();
      expect(session.screen.text()).toContain('ready');
    } finally {
      await session.stop();
    }
  });

  it('keeps split bracketed paste in one draft and sends only on the next Enter', async () => {
    const session = await terminal();
    try {
      await session.key('\x1b[20');
      await session.key('0~first\r\n/exit\r\nKế toán 日本');
      await session.key('\x1b[201');
      await session.key('~');
      expect(session.sent).toEqual([]);
      expect(session.screen.text()).toContain('first\n  /exit\n  Kế toán 日 本');
      await session.key('\r');
      expect(session.sent).toEqual(['first\n/exit\nKế toán 日本']);
    } finally { await session.stop(); }
    expect(session.input.isRaw).toBe(false);
    expect(session.input.listenerCount('data')).toBe(0);
    expect(session.transcript()).toContain('\x1b[?2004l');
  });

  it('protects unframed Windows paste bursts, including newlines split across chunks', async () => {
    const session = await terminal();
    try {
      session.input.write('alpha\r');
      session.input.write('beta\n');
      session.input.write('/open');
      await pause();
      expect(session.sent).toEqual([]);
      expect(session.opened).toEqual([]);
      await session.key('\r');
      expect(session.sent).toEqual(['alpha\nbeta\n/open']);
    } finally { await session.stop(); }
  });

  it('sends multiline slash text as a message and neutralizes pasted terminal controls', async () => {
    const session = await terminal();
    try {
      await session.key('\x1b[200~/open\n\x1b[2J\x03notes\x1b[201~');
      await session.key('\r');
      expect(session.sent).toEqual(['/open\nnotes']);
      expect(session.opened).toEqual([]);
      await session.key('\x1b[200~/exit\n\x1b[201~');
      await session.key('\r');
      expect(session.sent).toEqual(['/open\nnotes', '/exit']);
    } finally { await session.stop(); }
  });

  it('edits multiple lines and Unicode graphemes, with history restoring an unsent draft', async () => {
    const session = await terminal();
    try {
      await session.key('first');
      await session.key('\x0a');
      await session.key('Ke\u0302\u0301 🙂');
      await session.key('\x7f');
      await session.key('\r');
      expect(session.sent).toEqual(['first\nKe\u0302\u0301']);
      await session.key('draft');
      await session.key('\x1b[A');
      expect(session.screen.text()).toContain('› first\n  Kế');
      await session.key('\x1b[B');
      expect(session.screen.text()).toContain('› draft');
    } finally { await session.stop(); }
  });

  it('shows slash descriptions, navigates, fills with Tab/Enter, and dismisses with Esc', async () => {
    const session = await terminal();
    try {
      await session.key('/');
      expect(session.screen.text()).toContain('/list  List orglets and channels');
      await session.key('\x1b[B');
      await session.key('\t');
      expect(session.screen.text()).toContain('› /list');
      expect(session.screen.text()).not.toContain('Tab/Enter fill');
      await session.key('\r');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      expect(session.screen.text()).toContain('Researcher');
      await session.key('\r');
      await session.key('/op');
      await session.key('\r');
      expect(session.opened).toEqual([]);
      await session.key('\r');
      expect(session.opened).toEqual(['Researcher']);
      await session.key('/');
      await session.key('\x1b');
      expect(session.screen.text()).not.toContain('Tab/Enter fill');
      await session.key('\x15');
      expect(session.screen.text()).toContain('› ');
    } finally { await session.stop(); }
  });

  it('keeps the draft and local queue visible during an answer and after it redraws', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('one');
      await session.key('\r');
      await session.key('two');
      expect(session.screen.text()).toContain('› two');
      expect(session.screen.text()).toContain('working');
      await session.key('\r');
      await session.key('unsent draft');
      expect(session.screen.text()).toContain('1 queued');
      await session.resolve();
      expect(session.sent).toEqual(['one', 'two']);
      expect(session.screen.text()).toContain('› unsent draft');
      await session.resolve();
      expect(session.screen.text()).toContain('ready');
      expect(session.screen.text()).toContain('› unsent draft');
    } finally { await session.stop(); }
  });

  it('arms exit with Ctrl+C and restores the draft on Enter, Esc or ordinary typing', async () => {
    const session = await terminal();
    try {
      await session.key('unsent draft');
      await session.key('\x03');
      expect(session.screen.text()).toContain('Ctrl+C again to exit');
      expect(session.screen.text()).not.toContain('[y/N]');
      expect(session.screen.text()).not.toMatch(/─{20,}/);
      await session.key('\r');
      expect(session.screen.text()).toContain('› unsent draft');
      expect(session.screen.text().match(/─{20,}/g)).toHaveLength(2);
      expect(session.sent).toEqual([]);
      await session.key('\x03');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› unsent draft');
      await session.key('\x03');
      await session.key('y');
      expect(session.screen.text()).toContain('› unsent drafty');
      expect(session.input.isRaw).toBe(true);
    } finally { await session.stop(); }
  });

  it('pauses queue dispatch during confirmation and resumes it after staying', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('one');
      await session.key('\r');
      await session.key('queued');
      await session.key('\r');
      await session.key('draft');
      await session.key('\x03');
      expect(session.screen.text()).toContain('Ctrl+C again to exit');
      await session.resolve();
      expect(session.sent).toEqual(['one']);
      await session.key('\x1b');
      expect(session.sent).toEqual(['one', 'queued']);
      expect(session.screen.text()).toContain('› draft');
    } finally { await session.stop(); }
  });

  it('exits after the second Ctrl+C while waiting and drops queued work without sending it', async () => {
    const session = await terminal({ slow: true });
    try {
      await session.key('one');
      await session.key('\r');
      await session.key('queued');
      await session.key('\r');
      await session.key('\x03');
      expect(session.input.isRaw).toBe(true);
      await session.key('\x03');
      expect(session.input.isRaw).toBe(false);
      expect(session.sent).toEqual(['one']);
      expect(session.transcript()).toContain('\x1b[?1049l');
    } finally { await session.stop(); }
  });

  it('does not treat pasted Ctrl+C as exit and resets confirmation when pasting', async () => {
    const session = await terminal();
    try {
      await session.key('draft');
      await session.key('\x03');
      await session.key('\x1b[200~\x03\x03safe\x1b[201~');
      expect(session.screen.text()).toContain('› draftsafe');
      await session.key('\x03');
      expect(session.screen.text()).toContain('Ctrl+C again to exit');
      expect(session.input.isRaw).toBe(true);
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› draftsafe');
    } finally { await session.stop(); }
  });

  it('accepts two Ctrl+C keypresses arriving in one raw input chunk', async () => {
    const session = await terminal();
    try {
      await session.key('\x03\x03');
      expect(session.input.isRaw).toBe(false);
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });

  it('restores the picker filter after declining exit without opening a chat', async () => {
    const session = await terminal({ picker: true });
    try {
      await session.key('Kế');
      await session.key('\x03');
      expect(session.screen.text()).toContain('Ctrl+C again to exit');
      expect(session.input.isRaw).toBe(true);
      await session.key('\x1b');
      expect(session.screen.text()).toContain('› Kế');
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglet test · Kế toán');
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });

  it.each([4, 5, 10])('keeps exit confirmation visible in a %i-row terminal', async rows => {
    const session = await terminal({ columns: 24, rows });
    try {
      await session.key('draft');
      await session.key('\x03');
      expect(session.screen.text()).toContain('Ctrl+C again to exit');
      expect(session.screen.lines.length).toBeLessThan(rows);
      await session.key('\n');
      expect(session.screen.text()).toContain('› draft');
      await session.key('\x03');
      await session.key('\x03');
      expect(session.input.isRaw).toBe(false);
    } finally { await session.stop(); }
  });

  it.each(['Ctrl+D', '/exit'])('still leaves a busy chat immediately with %s outside confirmation', async exit => {
    const session = await terminal({ slow: true });
    try {
      await session.key('one');
      await session.key('\r');
      await session.key('queued');
      await session.key('\r');
      if (exit === 'Ctrl+D') await session.key('\x04');
      else {
        await session.key('/exit');
        await session.key('\r');
      }
      expect(session.input.isRaw).toBe(false);
      expect(session.sent).toEqual(['one']);
      expect(session.transcript()).toContain('\x1b[?1049l');
    } finally { await session.stop(); }
  });

  it.each(['none', 'truecolor'] as const)('shows orglet mascots and a crew group icon in %s mode and opens a crew with arrow keys', async mode => {
    const session = await terminal({ mode, list: {
      orglets: [{ name: 'Researcher', provider: 'codex', model: 'configured-model', color: '#4f7fe0' }, { name: 'Writer', provider: 'codex', model: 'configured-model', color: '#64b282' }],
      crews: [{ name: 'Review crew', lead: 'Researcher', members: ['Researcher', 'Writer'] }],
    } });
    try {
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('▐••▌ Researcher');
      expect(session.screen.text()).toContain('▐••▌ Writer');
      expect(session.screen.text()).toContain('▦    Review crew');
      expect(session.screen.text()).not.toContain('▐••▌ Review crew');
      await session.key('\x1b[B');
      await session.key('\x1b[B');
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglet test · Review crew');
      await session.key('\x07');
      expect(session.screen.text()).toContain('▐••▌ Researcher');
      expect(session.screen.text()).toContain('▐••▌ Writer');
      await session.key('\x1b[D');
      expect(session.screen.text()).toContain('› Search orglets or channels…');
      expect(session.screen.text()).not.toContain('Agents · Review crew');
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });

  it('retains picker navigation, filtering, Tab and Esc back to the chat', async () => {
    const session = await terminal({ picker: true });
    try {
      await session.key('\x1b[B');
      await session.key('\t');
      expect(session.screen.text()).toContain('› Kế toán');
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglet test · Kế toán');
      expect(session.screen.text()).toContain('configured-model · codex');
      await session.key('/to');
      await session.key('\r');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('Orglet test · Kế toán');
      expect(session.screen.text()).toContain('message · ready');
    } finally { await session.stop(); }
  });

  it('bounds multiline redraws to a small terminal and responds to resize', async () => {
    const session = await terminal({ columns: 24, rows: 8 });
    try {
      await session.key(`\x1b[200~${'Kế toán 日本\n'.repeat(20)}tail\x1b[201~`);
      const redraw = stripAnsi(session.transcript().slice(session.transcript().lastIndexOf('\x1b[2K')));
      expect(displayWidth(redraw.replace(/[\r\n]/g, ''))).toBeLessThanOrEqual(24);
      expect(session.screen.text()).toContain('tail');
      session.output.columns = 40;
      session.output.emit('resize');
      expect(session.screen.text()).toContain('Ctrl+J newline');
      expect(session.sent).toEqual([]);
    } finally { await session.stop(); }
  });
});
