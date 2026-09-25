import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppRefusal, type ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { StoppedError } from '../../apps/desktop/src/cli/client';
import { FACE_HEIGHT, FACE_WIDTH, faceCells, miniFaceCells, renderFace, renderMiniFace, WAITING_FRAMES } from '../../apps/desktop/src/cli/faces';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { parseInline, renderMarkdown } from '../../apps/desktop/src/cli/markdown';
import { chosenEntry, createPicker, entriesFromList, findChat, moveSelection, renderPickerLines, setFilter, visibleEntries } from '../../apps/desktop/src/cli/picker';
import { styledList, styledStatus } from '../../apps/desktop/src/cli/pretty';
import type { ListValue, ReadValue, SendValue } from '../../apps/desktop/src/cli/protocol';
import { runCli } from '../../apps/desktop/src/cli/run';
import { completeSlash, parseSlash } from '../../apps/desktop/src/cli/slash';
import { DARK_EYE_COLOR, detectColorMode, displayWidth, eyeColorFor, LIGHT_EYE_COLOR, NEUTRAL_COLOR, paint, stripAnsi, truncate, wrapSegments } from '../../apps/desktop/src/cli/terminal';
import { chatsOf, CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { mascotIds } from '../../apps/desktop/src/renderer/components/mascots';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';
import { defaultAvatarColor, MASCOT_IDS } from '../../apps/desktop/src/shared/mascot-suggest';

const BLUE = '#4f7fe0';
const PURPLE = '#a764c9';
const GREEN = '#3f9a68';
const SNOW = '#f4f1ea';

const list: ListValue = {
  orglets: [
    { name: 'Researcher', provider: 'demo', color: BLUE },
    { name: 'Writer', provider: 'openai', model: 'gpt-5', color: PURPLE },
    { name: 'Kế toán', provider: 'anthropic', color: GREEN },
  ],
  crews: [{ name: 'Review crew', lead: 'Writer', members: ['Researcher', 'Kế toán'], colors: [BLUE, GREEN, PURPLE] }],
};

describe('orglet faces', () => {
  it('draws the logo bubble in the orglet colour with two white eyes high and right of centre', () => {
    const cells = faceCells(BLUE, 'open');
    expect(cells).toHaveLength(FACE_HEIGHT);
    expect(cells.every(row => row.length === FACE_WIDTH)).toBe(true);
    // Round top corners: the first row starts empty, then a lower half block.
    expect(cells[0][0]).toEqual({ character: ' ' });
    expect(cells[0][1]).toEqual({ character: '▄', foreground: BLUE });
    // The eyes are the second text row, columns 4 and 6 of 0..9, with body between and around them.
    const eyeColumns = cells[1].flatMap((cell, column) => (cell.background === LIGHT_EYE_COLOR ? [column] : []));
    expect(eyeColumns).toEqual([4, 6]);
    expect(cells[1][5].background).toBe(BLUE);
    // No mouth: every cell below the eyes is body or empty.
    expect(cells.slice(2).flat().every(cell => cell.background === undefined || cell.background === BLUE)).toBe(true);
    // The bottom left corner is square (the bubble's tail); the bottom right is round.
    expect(cells[4][0]).toEqual({ character: ' ', background: BLUE });
    expect(cells[4][8]).toEqual({ character: '▀', foreground: BLUE });
    expect(cells[4][9]).toEqual({ character: ' ' });
  });

  it('turns the eyes dark on a very light body, as the app does', () => {
    expect(eyeColorFor(SNOW)).toBe(DARK_EYE_COLOR);
    expect(eyeColorFor('#ffffff')).toBe(DARK_EYE_COLOR);
    expect(eyeColorFor(BLUE)).toBe(LIGHT_EYE_COLOR);
    expect(eyeColorFor('#7b818c')).toBe(LIGHT_EYE_COLOR);
    expect(faceCells(SNOW, 'open')[1][4].background).toBe(DARK_EYE_COLOR);
    expect(miniFaceCells(SNOW)[1].foreground).toBe(DARK_EYE_COLOR);
  });

  it('moves only the eyes between frames', () => {
    const eyesOf = (frame: Parameters<typeof faceCells>[1]) => faceCells(BLUE, frame)[1].flatMap((cell, column) => (cell.background !== BLUE && cell.background ? [column] : []));
    expect(eyesOf('left')).toEqual([3, 5]);
    expect(eyesOf('right')).toEqual([5, 7]);
    expect(faceCells(BLUE, 'blink')[1][4]).toMatchObject({ character: '─', foreground: LIGHT_EYE_COLOR, background: BLUE });
    expect(faceCells(BLUE, 'happy')[1][6]).toMatchObject({ character: '^', foreground: LIGHT_EYE_COLOR, background: BLUE });
    const bodyRows = (frame: Parameters<typeof faceCells>[1]) => JSON.stringify([0, 2, 3, 4].map(row => faceCells(BLUE, frame)[row]));
    for (const frame of ['blink', 'left', 'right', 'happy'] as const) expect(bodyRows(frame)).toBe(bodyRows('open'));
    expect(WAITING_FRAMES).toContain('blink');
    expect(WAITING_FRAMES).toContain('left');
    expect(WAITING_FRAMES).toContain('right');
  });

  it('draws the one-row face and falls back to a neutral colour', () => {
    expect(miniFaceCells(BLUE).map(cell => cell.character).join('')).toBe('▐••▌');
    expect(miniFaceCells(BLUE, 'happy').map(cell => cell.character).join('')).toBe('▐^^▌');
    expect(miniFaceCells(undefined)[0].foreground).toBe(NEUTRAL_COLOR);
    expect(faceCells('not a colour', 'open')[2][0].background).toBe(NEUTRAL_COLOR);
    expect(renderMiniFace(BLUE, 'truecolor')).toContain('\x1b[38;2;79;127;224m▐');
    expect(renderFace(BLUE, 'open', 'ansi256').join('')).toMatch(/\x1b\[48;5;\d+m/);
    expect(stripAnsi(renderFace(BLUE, 'open', 'truecolor')[0])).toBe(' ▄      ▄ ');
  });
});

describe('orglet colour rules', () => {
  it('colours only a terminal without NO_COLOR or TERM=dumb, never --json, and FORCE_COLOR wins', () => {
    expect(detectColorMode({ isTTY: true, environment: {} })).toBe('truecolor');
    expect(detectColorMode({ isTTY: true, environment: {}, colorDepth: 8 })).toBe('ansi256');
    expect(detectColorMode({ isTTY: false, environment: {} })).toBe('none');
    expect(detectColorMode({ isTTY: true, environment: { NO_COLOR: '1' } })).toBe('none');
    expect(detectColorMode({ isTTY: true, environment: { TERM: 'dumb' } })).toBe('none');
    expect(detectColorMode({ isTTY: true, environment: {}, json: true })).toBe('none');
    expect(detectColorMode({ isTTY: false, environment: { FORCE_COLOR: '1' } })).toBe('truecolor');
    expect(detectColorMode({ isTTY: false, environment: { FORCE_COLOR: '', NO_COLOR: '1' } })).toBe('truecolor');
    expect(detectColorMode({ isTTY: false, environment: { FORCE_COLOR: '2' } })).toBe('ansi256');
    expect(detectColorMode({ isTTY: true, environment: { FORCE_COLOR: '0' } })).toBe('none');
    expect(detectColorMode({ isTTY: false, environment: { FORCE_COLOR: '1' }, json: true })).toBe('none');
    expect(paint('text', { bold: true }, 'none')).toBe('text');
  });

  it('measures what the text takes on screen', () => {
    expect(displayWidth('\x1b[1mbold\x1b[0m')).toBe(4);
    expect(displayWidth('Kế toán')).toBe(7);
    expect(displayWidth('Ké')).toBe(2);
    expect(displayWidth('日本')).toBe(4);
    expect(truncate('Researcher', 6)).toBe('Resea…');
  });
});

describe('orglet light Markdown', () => {
  const plain = (text: string, width = 40) => renderMarkdown(text, { width, mode: 'none' });

  it('renders headings, bold, inline code and links as readable text', () => {
    expect(plain('# Title')).toEqual(['Title']);
    expect(plain('Some **bold** and `code`.')).toEqual(['Some bold and code.']);
    expect(plain('See [the site](https://orglet.codepawl.com).', 60)).toEqual(['See the site (https://orglet.codepawl.com).']);
    // A narrow line breaks before the bracket, never between it and the URL.
    expect(plain('See [the site](https://orglet.codepawl.com).')).toEqual(['See the site', '(https://orglet.codepawl.com).']);
    expect(plain('<https://x.y> and [https://x.y](https://x.y)')).toEqual(['<https://x.y> and https://x.y']);
    expect(parseInline('**a `b`**')).toEqual([{ text: 'a ', style: { bold: true } }, { text: 'b', style: { bold: true, foreground: '#d9a05b' } }]);
  });

  it('keeps fenced code verbatim and indented, and wraps lists with a hanging indent', () => {
    expect(plain('```ts\nconst  x = 1;   // spaces kept\n```')).toEqual(['  const  x = 1;   // spaces kept']);
    expect(plain('- one two three four', 12)).toEqual(['• one two', '  three four']);
    expect(plain('1. first\n  - nested')).toEqual(['1. first', '  • nested']);
    expect(plain('> quoted')).toEqual(['│ quoted']);
    expect(plain('\n\nfirst\n\n\n\nsecond\n\n')).toEqual(['first', '', 'second']);
    expect(renderMarkdown('text', { width: 40, mode: 'none', indent: '  ' })).toEqual(['  text']);
  });

  it('wraps to the width and styles in colour', () => {
    expect(plain('alpha beta gamma delta', 11)).toEqual(['alpha beta', 'gamma delta']);
    expect(wrapSegments([{ text: 'abcdefghij' }], { width: 4, mode: 'none' })).toEqual(['abcd', 'efgh', 'ij']);
    const colored = renderMarkdown('**bold** text', { width: 40, mode: 'truecolor' });
    expect(colored[0]).toBe('\x1b[1mbold\x1b[0m text');
    for (const line of renderMarkdown('word '.repeat(40), { width: 30, mode: 'truecolor', indent: '  ' })) expect(displayWidth(line)).toBeLessThanOrEqual(30);
  });
});

describe('orglet chat slash commands', () => {
  it('parses each command, ignoring case', () => {
    expect(parseSlash('/to Review crew')).toEqual({ kind: 'to', name: 'Review crew' });
    expect(parseSlash('/to')).toEqual({ kind: 'to' });
    expect(parseSlash('/LIST')).toEqual({ kind: 'list' });
    expect(parseSlash('/read')).toEqual({ kind: 'read' });
    expect(parseSlash('/open')).toEqual({ kind: 'open' });
    expect(parseSlash('/clear')).toEqual({ kind: 'clear' });
    expect(parseSlash('/help')).toEqual({ kind: 'help' });
    expect(parseSlash('/quit')).toEqual({ kind: 'exit' });
    expect(parseSlash('/nope x')).toEqual({ kind: 'unknown', command: '/nope' });
  });

  it('completes commands and chat names', () => {
    const names = ['Researcher', 'Review crew', 'Writer'];
    expect(completeSlash('/l', names)).toEqual([['/list'], '/l']);
    expect(completeSlash('/', names)[0]).toEqual(['/to ', '/list', '/read', '/open', '/clear', '/help', '/exit']);
    expect(completeSlash('/t', names)).toEqual([['/to '], '/t']);
    expect(completeSlash('/to re', names)).toEqual([['/to Researcher', '/to Review crew'], '/to re']);
    expect(completeSlash('/TO wr', names)).toEqual([['/to Writer'], '/TO wr']);
    expect(completeSlash('hello', names)).toEqual([[], 'hello']);
    expect(completeSlash('/list x', names)).toEqual([[], '/list x']);
  });
});

describe('orglet chat picker', () => {
  const entries = entriesFromList(list);

  it('builds entries with faces, and neutral faces for an app that sends no colours', () => {
    expect(entries.map(entry => [entry.name, entry.detail, entry.colors])).toEqual([
      ['Researcher', 'demo', [BLUE]],
      ['Writer', 'openai/gpt-5', [PURPLE]],
      ['Kế toán', 'anthropic', [GREEN]],
      ['Review crew', 'crew · lead Writer', [BLUE, GREEN, PURPLE]],
    ]);
    expect(entries[3].color).toBe(PURPLE);
    const older = entriesFromList({ orglets: [{ name: 'Researcher', provider: 'demo' }], crews: [{ name: 'Crew', lead: 'Researcher', members: ['Researcher', 'Ghost'] }] });
    expect(older.map(entry => entry.colors)).toEqual([[NEUTRAL_COLOR], [NEUTRAL_COLOR, NEUTRAL_COLOR]]);
  });

  it('filters by name ignoring case and diacritics, best fit first, and moves and chooses', () => {
    let state = createPicker(entries);
    expect(visibleEntries(state)).toHaveLength(4);
    state = setFilter(state, 'ke');
    expect(visibleEntries(state).map(entry => entry.name)).toEqual(['Kế toán']);
    state = setFilter(state, 'r');
    // Names starting with it first (Researcher, Review crew), then names containing it (Writer, Review crew's lead is not matched).
    expect(visibleEntries(state).map(entry => entry.name)).toEqual(['Researcher', 'Review crew', 'Writer']);
    state = moveSelection(state, 1);
    expect(chosenEntry(state)?.name).toBe('Review crew');
    state = moveSelection(state, 2);
    expect(chosenEntry(state)?.name).toBe('Researcher');
    state = moveSelection(state, -1);
    expect(chosenEntry(state)?.name).toBe('Writer');
    state = setFilter(state, 'wri');
    expect(state.selected).toBe(0);
    expect(chosenEntry(state)?.name).toBe('Writer');
    expect(chosenEntry(setFilter(state, 'zzz'))).toBeUndefined();
  });

  it('finds a chat by exact name or a unique start, like the app', () => {
    expect(findChat(entries, 'writer')).toEqual({ entry: entries[1] });
    expect(findChat(entries, 'rev')).toEqual({ entry: entries[3] });
    expect(findChat(entries, 're')).toEqual({ candidates: [entries[0], entries[3]] });
    expect(findChat(entries, 'nobody')).toEqual({ candidates: [] });
  });

  it('draws the list with a marker, a window around the selection and a hint', () => {
    const lines = renderPickerLines(createPicker(entries), { width: 80, mode: 'none', maxRows: 2 }).map(stripAnsi);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^› Researcher\s+demo$/);
    expect(lines[2]).toContain('2 more');
    expect(renderPickerLines(setFilter(createPicker(entries), 'zzz'), { width: 80, mode: 'none', maxRows: 4 }).map(stripAnsi)[0]).toContain('Nothing matches "zzz"');
  });
});

describe('orglet one-shot commands in colour', () => {
  it('draws faces in list and status', () => {
    const colored = styledList(list, { mode: 'truecolor', width: 80 });
    expect(stripAnsi(colored).split('\n')).toEqual([
      'Orglets',
      '  ▐••▌ Researcher  demo',
      '  ▐••▌ Writer      openai/gpt-5',
      '  ▐••▌ Kế toán     anthropic',
      '',
      'Crews',
      '  ▐••▌▐••▌▐••▌ Review crew  lead Writer  Researcher, Kế toán',
    ]);
    expect(colored).toContain('\x1b[38;2;167;100;201m▐');
    const status = styledStatus({ version: '1.0.0', orglets: 2, crews: 0, running: 1, colors: [BLUE, PURPLE] }, 'truecolor');
    expect(stripAnsi(status)).toBe('▐••▌▐••▌  Orglet 1.0.0 is running.\n2 orglets, 0 crews, 1 chat working.');
  });

  it('keeps pipes plain and needs a terminal for chat', async () => {
    const printed: string[] = [];
    const errors: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => errors.push(text) };
    expect(await runCli(['chat'], output, {})).toBe(2);
    expect(errors.pop()).toContain('needs a terminal');
    expect(await runCli(['chat', '--json'], output, {})).toBe(2);
    expect(await runCli([], output, {})).toBe(2);
    expect(errors.pop()).toContain('No command given.');
  });
});

/** A fake app for the interactive session: one answer per message, a crew answers from two orglets. */
function fakeClient(options: { stopSend?: boolean } = {}) {
  const sent: { to: string; message: string }[] = [];
  const answerFor = (to: string, message: string): SendValue => {
    const crew = to === 'Review crew';
    const chat = crew ? { kind: 'team' as const, id: 't', name: to, color: PURPLE } : { kind: 'worker' as const, id: 'w', name: to, color: BLUE };
    const answers = crew
      ? [{ name: 'Researcher', text: 'Two sources.', createdAt: '1', color: BLUE }, { name: 'Writer', text: `Crew says: ${message}`, createdAt: '2', color: PURPLE }]
      : [{ name: to, text: `You said **${message}**`, createdAt: '1', color: BLUE }];
    return { chat, taskId: 'task', waited: true, finished: true, status: 'completed', answers, errors: [] };
  };
  const client: ChatClient = {
    list: async () => list,
    send: async (to, message) => {
      sent.push({ to, message });
      if (options.stopSend) throw new StoppedError();
      return answerFor(to, message);
    },
    read: async to => {
      if (to === 'Kế toán') throw new AppRefusal('Chưa có cuộc trò chuyện với Kế toán.', 'not_found');
      const value = answerFor(to, 'earlier');
      return { chat: value.chat, taskId: value.taskId, status: 'completed', answers: value.answers } satisfies ReadValue;
    },
    open: async to => ({ chat: { kind: 'worker', id: 'w', name: to } }),
  };
  return { client, sent };
}

/** Runs a session over a script of typed lines and returns its exit code and everything it printed. */
async function session(script: string, options: { to?: string; stopSend?: boolean; mode?: 'none' | 'truecolor' } = {}) {
  const input = new PassThrough();
  let transcript = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      transcript += chunk.toString();
      callback();
    },
  });
  const fake = fakeClient(options);
  const running = runInteractive({ input, output, client: fake.client, mode: options.mode ?? 'none', version: '9.9.9', terminal: false, ...(options.to ? { to: options.to } : {}) });
  input.end(script);
  const code = await running;
  return { code, transcript, sent: fake.sent };
}

describe('orglet chat session', () => {
  it('sends a message, prints the answer and leaves on /exit', async () => {
    const result = await session('hello\n/exit\nnever sent\n', { to: 'res' });
    expect(result.code).toBe(0);
    expect(result.sent).toEqual([{ to: 'Researcher', message: 'hello' }]);
    const lines = result.transcript.split('\n');
    expect(lines[0]).toBe('Orglet 9.9.9');
    expect(lines[1]).toBe('Researcher  demo');
    expect(result.transcript).toContain('› hello\nResearcher · 0s\n  You said hello\n\n› /exit\n');
    expect(result.transcript).not.toContain('never sent');
  });

  it('picks a chat by typing, switches with /to, reads, opens, lists and explains', async () => {
    const result = await session('wri\nhi\n/to rev\nall good?\n/read\n/to Kế\n/read\n/open\n/list\n/help\n/bogus\n/exit\n');
    expect(result.code).toBe(0);
    expect(result.sent).toEqual([{ to: 'Writer', message: 'hi' }, { to: 'Review crew', message: 'all good?' }]);
    const transcript = result.transcript;
    expect(transcript).toContain('Open › wri\nWriter  openai/gpt-5\n');
    expect(transcript).toContain('Review crew  crew · lead Writer');
    // A crew answer prints under each member's name.
    expect(transcript).toContain('Researcher · 0s\n  Two sources.\n\nWriter\n  Crew says: all good?');
    expect(transcript).toContain('› /read\nResearcher\n  Two sources.\n\nWriter\n  Crew says: earlier');
    expect(transcript).toContain('Chưa có cuộc trò chuyện với Kế toán.');
    expect(transcript).toContain('Opened the chat with Kế toán in the app.');
    expect(transcript).toContain('Crews\n  Review crew  lead Writer  Researcher, Kế toán');
    expect(transcript).toContain('/to <name>');
    expect(transcript).toContain('Unknown command /bogus.');
  });

  it('says the orglet keeps working when waiting stops, and ends with the input', async () => {
    const result = await session('hello\n', { to: 'Writer', stopSend: true });
    expect(result.code).toBe(0);
    expect(result.transcript).toContain('Stopped waiting. Writer keeps working in the app');
  });

  it('opens the picker on a name that fits nothing and draws faces in colour', async () => {
    const result = await session('zzz\nres\nhey\n', { to: 'Nobody', mode: 'truecolor' });
    expect(result.sent).toEqual([{ to: 'Researcher', message: 'hey' }]);
    const plain = stripAnsi(result.transcript);
    expect(plain).toContain('Nothing matches "zzz".');
    expect(plain).toContain('▐^^▌ Researcher · 0s');
    // The chat header is the big face with the name beside it.
    expect(plain).toMatch(/ ▄      ▄ \n.{10} {3}Researcher\n.{10} {3}demo\n/);
    expect(result.transcript).toContain('\x1b[1;38;2;79;127;224mResearcher');
  });
});

describe('orglet colours from the app', () => {
  it('uses the same default face colour as the app avatar', () => {
    expect(mascotIds).toEqual([...MASCOT_IDS]);
    expect(defaultAvatarColor({ id: 'a', name: 'Researcher', avatar: { color: '#123456' } })).toBe('#123456');
    expect(defaultAvatarColor({ id: 'a', name: 'Researcher', avatar: { mascot: 'finance' } })).toBe(GREEN);
    expect(defaultAvatarColor({ id: 'a', name: 'Researcher' })).toBe(BLUE);
    expect(defaultAvatarColor({ id: 'a', name: 'Minh', description: 'Kế toán trưởng' })).toBe(GREEN);
  });

  it('sends colours with list, status and every chat', async () => {
    const workers = [
      { id: 'w1', name: 'Researcher', provider: 'demo' },
      { id: 'w2', name: 'Writer', provider: 'openai', modelId: 'gpt-5', avatar: { color: '#abcdef' } },
    ];
    const teams = [{ id: 't1', name: 'Crew', memberIds: ['w1'], synthesizerId: 'w2' }];
    const workspace = { workers, teams, tasks: [] } as unknown as Workspace;
    const operations = new CliOperations({ request: async () => workspace, version: () => '1', open: () => undefined, translate: message => message });
    expect(await operations.list()).toEqual({
      orglets: [{ name: 'Researcher', provider: 'demo', color: BLUE }, { name: 'Writer', provider: 'openai', model: 'gpt-5', color: '#abcdef' }],
      crews: [{ name: 'Crew', lead: 'Writer', members: ['Researcher'], colors: [BLUE, '#abcdef'] }],
    });
    expect((await operations.status()).colors).toEqual([BLUE, '#abcdef']);
    expect(chatsOf(workspace)).toEqual([
      { kind: 'worker', id: 'w1', name: 'Researcher', color: BLUE },
      { kind: 'worker', id: 'w2', name: 'Writer', color: '#abcdef' },
      { kind: 'team', id: 't1', name: 'Crew', color: '#abcdef', colors: [BLUE, '#abcdef'] },
    ]);
  });
});
