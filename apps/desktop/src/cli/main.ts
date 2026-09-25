import { fstatSync, openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import { EXIT_CODES } from './protocol';
import { runCli, type InteractiveTerminal, type Output, type StatusTerminal } from './run';
import { detectColorMode, type ColorMode } from './terminal';

/** The bundled `orglet-cli.cjs` starts here; `run.ts` holds everything the tests exercise. */

const DEFAULT_COLUMNS = 80;
const CONSOLE_INPUT = '\\\\.\\CONIN$';

/** Whether standard input is a device rather than a pipe or a file someone redirected into the command. */
function standardInputIsDevice(): boolean {
  try {
    return fstatSync(0).isCharacterDevice();
  } catch {
    // No usable standard input at all.
    return true;
  }
}

type TerminalInput = { stream: NodeJS.ReadStream | ReadStream; opened: boolean };

/** Orglet.exe run as Node by the `orglet` shim on Windows, where standard input and Ctrl+C behave differently. */
const ELECTRON_ON_WINDOWS = process.platform === 'win32' && Boolean(process.versions.electron);

/**
 * Standard input as a terminal. Electron's Node mode on Windows reattaches only standard output and error to the
 * console, so standard input is an empty device even in a terminal. There the console's own input is opened instead;
 * a pipe or a file on standard input is left alone.
 */
function terminalInput(): TerminalInput | undefined {
  if (process.stdin.isTTY) return { stream: process.stdin, opened: false };
  const watched = process.stdout.isTTY || process.stderr.isTTY;
  if (!ELECTRON_ON_WINDOWS || !watched || !standardInputIsDevice()) return undefined;
  try {
    return { stream: new ReadStream(openSync(CONSOLE_INPUT, 'r+')), opened: true };
  } catch {
    return undefined;
  }
}

/**
 * Electron's Node mode on Windows never hands Ctrl+C to a SIGINT handler: the process just ends, with the waiting face
 * still drawn and the cursor hidden. There, while `send` waits, the console is read raw so Ctrl+C arrives as a key and
 * stops the wait the way SIGINT does elsewhere. Returns what undoes it.
 */
function consoleInterrupt(input: TerminalInput | undefined, interrupt: () => void): (() => () => void) | undefined {
  if (!ELECTRON_ON_WINDOWS || !input) return undefined;
  const stream = input.stream;
  return () => {
    const onData = (chunk: Buffer | string) => {
      if (String(chunk).includes('\x03')) interrupt();
    };
    stream.setRawMode(true);
    stream.on('data', onData);
    return () => {
      stream.off('data', onData);
      stream.setRawMode(false);
      stream.pause();
    };
  };
}

function colorModeOf(stream: NodeJS.WriteStream, environment: NodeJS.ProcessEnv): ColorMode {
  const isTTY = Boolean(stream.isTTY);
  const colorDepth = isTTY && typeof stream.getColorDepth === 'function' ? stream.getColorDepth(environment) : undefined;
  return detectColorMode({ isTTY, environment, ...(colorDepth === undefined ? {} : { colorDepth }) });
}

/** Standard error, when a person watches it in colour, for the face `send` shows while it waits. */
function statusTerminal(environment: NodeJS.ProcessEnv): StatusTerminal | undefined {
  if (!process.stderr.isTTY) return undefined;
  const mode = colorModeOf(process.stderr, environment);
  if (mode === 'none') return undefined;
  return { write: text => process.stderr.write(text), mode, columns: () => process.stderr.columns ?? DEFAULT_COLUMNS };
}

async function main(): Promise<void> {
  const environment = process.env;
  const stdoutMode = colorModeOf(process.stdout, environment);
  const input = terminalInput();
  // The first Ctrl+C stops waiting and lets the command say what keeps running in the app; a second one quits at once.
  const controller = new AbortController();
  const interrupt = () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  };
  process.on('SIGINT', interrupt);
  const status = statusTerminal(environment);
  const catchInterrupt = consoleInterrupt(input, interrupt);
  const output: Output = {
    stdout: text => process.stdout.write(`${text}\n`),
    stderr: text => process.stderr.write(`${text}\n`),
    stdoutMode,
    columns: process.stdout.columns ?? DEFAULT_COLUMNS,
    ...(status ? { statusTerminal: { ...status, ...(catchInterrupt ? { catchInterrupt } : {}) } } : {}),
  };
  const chatInput = process.stdout.isTTY ? input : undefined;
  const terminal: InteractiveTerminal | undefined = chatInput ? { input: chatInput.stream, output: process.stdout, mode: stdoutMode } : undefined;
  try {
    process.exitCode = await runCli(process.argv.slice(2), output, environment, process.cwd(), { ...(terminal ? { terminal } : {}), signal: controller.signal });
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_CODES.failure;
  } finally {
    // The console input this command opened itself would otherwise keep it running.
    if (input?.opened) input.stream.destroy();
  }
}

void main();
