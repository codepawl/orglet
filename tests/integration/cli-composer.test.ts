import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { StoppedError } from '../../apps/desktop/src/cli/client';
import { type ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { displayWidth, stripAnsi, type ColorMode } from '../../apps/desktop/src/cli/terminal';
import { type SendValue } from '../../apps/desktop/src/cli/protocol';

/** A terminal grid, so assertions see the final screen rather than text already erased by a redraw. */
class Screen {
  row = 0;
  column = 0;
  readonly lines: string[][] = [[]];
  write(text: string): void {
    for (const token of text.match(/\x1b\[[0-9;?]*[A-Za-z~]|[^\x1b]/gu) ?? []) {
      if (token.startsWith('\x1b')) {
        const amount = Number(token.slice(2, -1)) || 1;
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

async function terminal(options: { picker?: boolean; slow?: boolean; slowOpen?: boolean; columns?: number; rows?: number; mode?: ColorMode } = {}) {
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
  const client: ChatClient = {
    list: async () => ({ orglets: [{ name: 'Researcher', provider: 'demo', color: '#4f7fe0' }, { name: 'Kế toán', provider: 'demo', color: '#64b282' }], crews: [] }),
    send: async (to, message, signal) => {
      sent.push(message);
      sentTo.push(to);
      if (options.slow) await new Promise<void>((resolve, reject) => {
        finishSend = resolve;
        signal.addEventListener('abort', () => reject(new StoppedError()), { once: true });
      });
      return response(message);
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
  const running = runInteractive({ input, output, client, mode: options.mode ?? 'none', version: 'test', terminal: true, ...(options.picker ? {} : { to: 'Researcher' }) });
  await pause();
  return {
    screen, input, output, sent, sentTo, opened,
    transcript: () => transcript,
    key: async (text: string | Buffer) => { input.write(text); await pause(); },
    resolve: async () => { finishSend?.(); await pause(); },
    failOpen: async () => { failOpen?.(); await pause(); },
    stop: async () => { input.write('\x04'); await running; },
  };
}

describe('terminal composer', () => {
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
      expect(session.screen.text()).toContain('working · 1 queued · 0s · ▐••▌');
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
      expect(session.screen.text()).toContain('/list  List orglets and crews');
      await session.key('\x1b[B');
      await session.key('\t');
      expect(session.screen.text()).toContain('› /list');
      expect(session.screen.text()).not.toContain('Tab/Enter fill');
      await session.key('\r');
      expect(session.screen.text()).toContain('Orglets');
      await session.key('/op');
      await session.key('\r');
      expect(session.opened).toEqual([]);
      await session.key('\r');
      expect(session.opened).toEqual(['Researcher']);
      await session.key('/');
      await session.key('\x1b');
      expect(session.screen.text()).not.toContain('Tab/Enter fill');
      await session.key('\x03');
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

  it('cancels waiting without losing the draft, and exits immediately with queued work', async () => {
    const session = await terminal({ slow: true });
    await session.key('one');
    await session.key('\r');
    await session.key('draft');
    await session.key('\x03');
    expect(session.screen.text()).toContain('keeps working in the app');
    expect(session.screen.text()).toContain('› draft');
    await session.key('\r');
    await session.key('queued');
    await session.key('\r');
    await session.stop();
    expect(session.sent).toEqual(['one', 'draft']);
  });

  it('retains picker navigation, filtering, Tab and Esc back to the chat', async () => {
    const session = await terminal({ picker: true });
    try {
      await session.key('\x1b[B');
      await session.key('\t');
      expect(session.screen.text()).toContain('Open › Kế toán');
      await session.key('\r');
      expect(session.screen.text()).toContain('ready · ▐••▌ Kế toán · demo');
      await session.key('/to');
      await session.key('\r');
      await session.key('\x1b');
      expect(session.screen.text()).toContain('ready · ▐••▌ Kế toán · demo');
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
