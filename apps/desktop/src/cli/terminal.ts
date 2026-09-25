/**
 * Colour and layout for a person at a terminal (COD-236): when to style at all, truecolor or 256-colour escape codes,
 * the width text takes on screen, and word wrapping that keeps styles intact. Hand-written ANSI, no dependencies.
 */

/** `none` prints plain text, exactly what scripts and pipes got before the terminal faces existed. */
export type ColorMode = 'none' | 'ansi256' | 'truecolor';

export type ColorContext = {
  isTTY: boolean;
  environment: NodeJS.ProcessEnv;
  /** `--json` output stays plain whatever the terminal can do. */
  json?: boolean;
  /** What the stream reports through `tty.WriteStream.getColorDepth`, in bits; unknown means truecolor. */
  colorDepth?: number;
};

const TRUECOLOR_DEPTH = 24;

function forcedMode(value: string): ColorMode {
  if (value === '0' || value === 'false') return 'none';
  if (value === '2') return 'ansi256';
  return 'truecolor';
}

/**
 * Whether and how to colour one output stream. `--json` never is. `FORCE_COLOR` wins over the rest, as it does for
 * Node itself (`0` or `false` turns colour off); then `NO_COLOR`, a stream that is not a terminal, and `TERM=dumb` all
 * mean plain text.
 */
export function detectColorMode(context: ColorContext): ColorMode {
  if (context.json) return 'none';
  const forced = context.environment.FORCE_COLOR;
  if (forced !== undefined) return forcedMode(forced.trim().toLowerCase());
  if (context.environment.NO_COLOR) return 'none';
  if (!context.isTTY) return 'none';
  if (context.environment.TERM === 'dumb') return 'none';
  const depth = context.colorDepth ?? TRUECOLOR_DEPTH;
  if (depth >= TRUECOLOR_DEPTH) return 'truecolor';
  return 'ansi256';
}

export type Rgb = { red: number; green: number; blue: number };

/** The face an app older than this command gets, and anything whose colour is missing or malformed. */
export const NEUTRAL_COLOR = '#7b818c';
/** Secondary text: provider names, elapsed seconds, hints. A grey that reads on dark and light backgrounds. */
export const MUTED_COLOR = '#8b919a';
/** Failures the app reports. */
export const ERROR_COLOR = '#d65c73';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export function hexToRgb(hex: string): Rgb {
  const color = isHexColor(hex) ? hex : NEUTRAL_COLOR;
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function toLinear(channel: number): number {
  const value = channel / 255;
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

/** OKLab lightness from 0 to 1, the `l` the app's `eyeColor` reads from the body colour. */
export function oklabLightness(hex: string): number {
  const { red, green, blue } = hexToRgb(hex);
  const linearRed = toLinear(red);
  const linearGreen = toLinear(green);
  const linearBlue = toLinear(blue);
  const long = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue);
  const medium = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue);
  const short = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue);
  return 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
}

/** Above this body lightness the eyes turn dark, the same step as `eyeColor` in renderer/components/mascots.tsx. */
export const LIGHT_BODY_LIGHTNESS = 0.78;
/** oklch(0.98 0 0) and oklch(0.25 0 0), the two eye colours the app mixes. */
export const LIGHT_EYE_COLOR = '#f9f9f9';
export const DARK_EYE_COLOR = '#212121';

export function eyeColorFor(bodyColor: string): string {
  return oklabLightness(bodyColor) > LIGHT_BODY_LIGHTNESS ? DARK_EYE_COLOR : LIGHT_EYE_COLOR;
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function nearestCubeIndex(channel: number): number {
  let best = 0;
  for (let index = 1; index < CUBE_LEVELS.length; index += 1) {
    if (Math.abs(CUBE_LEVELS[index] - channel) < Math.abs(CUBE_LEVELS[best] - channel)) best = index;
  }
  return best;
}

/** The nearest colour of the xterm 256-colour palette: the 6x6x6 cube or the grey ramp, whichever is closer. */
export function rgbToAnsi256(rgb: Rgb): number {
  const redIndex = nearestCubeIndex(rgb.red);
  const greenIndex = nearestCubeIndex(rgb.green);
  const blueIndex = nearestCubeIndex(rgb.blue);
  const cubeDistance = (CUBE_LEVELS[redIndex] - rgb.red) ** 2 + (CUBE_LEVELS[greenIndex] - rgb.green) ** 2 + (CUBE_LEVELS[blueIndex] - rgb.blue) ** 2;
  const average = (rgb.red + rgb.green + rgb.blue) / 3;
  const greyStep = Math.max(0, Math.min(23, Math.round((average - 8) / 10)));
  const grey = 8 + greyStep * 10;
  const greyDistance = (grey - rgb.red) ** 2 + (grey - rgb.green) ** 2 + (grey - rgb.blue) ** 2;
  if (greyDistance < cubeDistance) return 232 + greyStep;
  return 16 + 36 * redIndex + 6 * greenIndex + blueIndex;
}

export type Style = { foreground?: string; background?: string; bold?: boolean; underline?: boolean };

function colorCode(layer: '38' | '48', hex: string, mode: ColorMode): string {
  const rgb = hexToRgb(hex);
  if (mode === 'ansi256') return `${layer};5;${rgbToAnsi256(rgb)}`;
  return `${layer};2;${rgb.red};${rgb.green};${rgb.blue}`;
}

/** Wraps text in one SGR sequence and a reset; plain text when the mode is `none` or the style is empty. */
export function paint(text: string, style: Style, mode: ColorMode): string {
  if (mode === 'none' || text === '') return text;
  const codes: string[] = [];
  if (style.bold) codes.push('1');
  if (style.underline) codes.push('4');
  if (style.foreground) codes.push(colorCode('38', style.foreground, mode));
  if (style.background) codes.push(colorCode('48', style.background, mode));
  if (codes.length === 0) return text;
  return `\x1b[${codes.join(';')}m${text}\x1b[0m`;
}

export function muted(text: string, mode: ColorMode): string {
  return paint(text, { foreground: MUTED_COLOR }, mode);
}

/** Cursor and screen control. Windows Terminal, PowerShell and cmd on Windows 10 and later all understand these. */
export const ANSI = {
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  clearBelow: '\x1b[J',
  clearScreen: '\x1b[2J\x1b[3J\x1b[H',
  up: (lines: number) => (lines > 0 ? `\x1b[${lines}A` : ''),
  right: (columns: number) => (columns > 0 ? `\x1b[${columns}C` : ''),
};

const ESCAPE_SEQUENCE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '');
}

const ZERO_WIDTH = /^[\p{Mn}\p{Me}​-‏︀-️]$/u;
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

function characterWidth(character: string): number {
  if (ZERO_WIDTH.test(character)) return 0;
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint < 0x20) return 0;
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 2 : 1;
}

/** Columns the text takes on screen: escape codes and combining marks take none, CJK and emoji take two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of stripAnsi(text)) width += characterWidth(character);
  return width;
}

/** Cuts plain text to at most `width` columns, ending with an ellipsis when something was cut. */
export function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  if (width <= 1) return width === 1 ? '…' : '';
  let result = '';
  let used = 0;
  for (const character of text) {
    const characterColumns = characterWidth(character);
    if (used + characterColumns > width - 1) break;
    result += character;
    used += characterColumns;
  }
  return `${result}…`;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** A run of text in one style; the unit the Markdown renderer produces and `wrapSegments` lays out. */
export type Segment = { text: string; style?: Style };

/**
 * What wrapping breaks between: a run of spaces, or a word. A word can hold several styled runs with nothing between
 * them, such as "(" and the URL of a link, so a line never breaks inside it.
 */
type Word = { runs: Segment[]; space: boolean };

function wordWidth(word: Word): number {
  return word.runs.reduce((total, run) => total + displayWidth(run.text), 0);
}

function wordsOf(segments: readonly Segment[]): Word[] {
  const words: Word[] = [];
  for (const segment of segments) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (part === '') continue;
      const space = /^\s+$/.test(part);
      const last = words[words.length - 1];
      if (!space && last && !last.space) last.runs.push({ text: part, style: segment.style });
      else words.push({ runs: [{ text: part, style: segment.style }], space });
    }
  }
  return words;
}

/** Splits a word longer than a whole line into pieces that fit, keeping each character's style. */
function splitLongWord(word: Word, width: number): Word[] {
  const pieces: Word[] = [];
  let current: Word = { runs: [], space: false };
  for (const run of word.runs) {
    for (const character of run.text) {
      if (wordWidth(current) + displayWidth(character) > width && current.runs.length > 0) {
        pieces.push(current);
        current = { runs: [], space: false };
      }
      const last = current.runs[current.runs.length - 1];
      if (last && last.style === run.style) last.text += character;
      else current.runs.push({ text: character, style: run.style });
    }
  }
  if (current.runs.length > 0) pieces.push(current);
  return pieces;
}

function sameStyle(first: Style | undefined, second: Style | undefined): boolean {
  return JSON.stringify(first ?? {}) === JSON.stringify(second ?? {});
}

/** Paints a line's words, joining neighbouring runs of the same style into one escape sequence. */
function paintWords(words: readonly Word[], mode: ColorMode): string {
  const runs: Segment[] = [];
  for (const run of words.flatMap(word => word.runs)) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.style, run.style)) last.text += run.text;
    else runs.push({ text: run.text, style: run.style });
  }
  return runs.map(run => (run.style ? paint(run.text, run.style, mode) : run.text)).join('');
}

export type WrapOptions = { width: number; mode: ColorMode; firstPrefix?: string; restPrefix?: string };

/**
 * Lays styled text out in lines of at most `width` columns, breaking at spaces. `firstPrefix` starts the first line
 * and `restPrefix` the others (a list bullet and its hanging indent); both count towards the width.
 */
export function wrapSegments(segments: readonly Segment[], options: WrapOptions): string[] {
  const firstPrefix = options.firstPrefix ?? '';
  const restPrefix = options.restPrefix ?? firstPrefix;
  const lines: string[] = [];
  let prefix = firstPrefix;
  let available = Math.max(1, options.width - displayWidth(prefix));
  let current: Word[] = [];
  let used = 0;
  let pendingSpace: Word | undefined;
  const finishLine = () => {
    lines.push(prefix + paintWords(current, options.mode));
    prefix = restPrefix;
    available = Math.max(1, options.width - displayWidth(prefix));
    current = [];
    used = 0;
    pendingSpace = undefined;
  };
  for (const word of wordsOf(segments)) {
    if (word.space) {
      // Several spaces or a tab between words print as one space, in the style of the run they came from.
      if (current.length > 0) pendingSpace = { runs: [{ text: ' ', style: word.runs[0].style }], space: true };
      continue;
    }
    const pieces = wordWidth(word) > available ? splitLongWord(word, available) : [word];
    for (const piece of pieces) {
      const pieceWidth = wordWidth(piece);
      const spaceWidth = pendingSpace ? 1 : 0;
      if (current.length > 0 && used + spaceWidth + pieceWidth > available) finishLine();
      if (pendingSpace && current.length > 0) {
        current.push(pendingSpace);
        used += 1;
      }
      pendingSpace = undefined;
      current.push(piece);
      used += pieceWidth;
    }
  }
  if (current.length > 0 || lines.length === 0) finishLine();
  return lines;
}
