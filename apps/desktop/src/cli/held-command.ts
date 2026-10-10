import { createInterface } from 'node:readline';
import { AppRefusal } from './chat-client';
import { UnreachableError } from './client';
import { createHeldClient, type HeldClient, type WaitingTarget } from './held-client';
import type { HeldBody, WaitingCard } from './held-protocol';
import type { InteractiveInput, InteractiveOutput } from './interactive';
import { EXIT_CODES } from './protocol';
import { t } from './text';
import { UsageError } from './arguments';
import type { ElevationScope } from '../shared/terminal-access';

/**
 * `orglet unlock`, `approve`, `reconcile`, `test` and `install-update` (docs/cli-held-actions-design.md). A held command
 * needs a person at the keyboard: with no terminal on both ends it exits 2 before it sends anything. The code is read
 * from the terminal only, never from an argument, an environment variable, a pipe or a file.
 */

export const HELD_COMMANDS = ['unlock', 'approve', 'reconcile', 'test', 'install-update'] as const;
export type HeldCommandName = typeof HELD_COMMANDS[number];

export function isHeldCommand(argumentList: readonly string[]): boolean {
  return HELD_COMMANDS.includes(argumentList[0] as HeldCommandName);
}

export const HELD_HELP = [
  t('Các lệnh cần bạn mở khóa bằng mã hiện trong cửa sổ Orglet (chỉ chạy khi có terminal):'),
  '  orglet unlock',
  '      ' + t('mở chat đã mở khóa để trả lời các thẻ đang chờ'),
  '  orglet approve [--to <name> | --chat <id>] [--card <id>] [<choice>]',
  '      ' + t('không có lựa chọn thì chỉ in thẻ; thiếu --to và --chat thì in thẻ của app'),
  '  orglet reconcile <id> <USD> dashboard|invoice',
  '  orglet test mcp <name> | web-search | decision-model',
  '  orglet install-update',
].join('\n');

export type HeldTerminal = { input: InteractiveInput; output: InteractiveOutput };

export type Printer = { stdout: (text: string) => void; stderr: (text: string) => void };

export function noTerminalMessage(): string {
  return t('Lệnh này cần một người ngồi ở terminal để gõ mã hiện trong cửa sổ Orglet. Nó không chạy trong script hay khi đầu vào hoặc đầu ra bị chuyển hướng.');
}

/** One line from the terminal, with the prompt shown. Resolves undefined when the person closes the input or presses Ctrl+C. */
export function readLineFromTerminal(terminal: HeldTerminal, prompt: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const lines = createInterface({ input: terminal.input, output: terminal.output, terminal: true });
    let answered = false;
    lines.question(prompt, answer => {
      answered = true;
      lines.close();
      resolve(answer);
    });
    lines.on('close', () => {
      if (!answered) resolve(undefined);
    });
  });
}

/** How a pairing reads the code: from a prompt on the terminal in a one-shot command, from the session's own input in the chat. */
export type CodeReader = (prompt: string) => Promise<string | undefined>;

const MAX_CODE_TRIES = 5;

/**
 * Asks the app for a code, tells the person where to look, reads what they type and sends it. Returns false when the
 * person gave up or the app refused; the reason has been printed.
 */
export async function pairWithTerminal(held: HeldClient, scope: ElevationScope, operation: HeldBody | undefined, readCode: CodeReader, print: Printer): Promise<boolean> {
  let started;
  try {
    started = await held.startPairing(scope, operation);
  } catch (error) {
    print.stderr(error instanceof AppRefusal ? error.message : String(error));
    return false;
  }
  print.stdout(t('Orglet đang hiện một mã trong cửa sổ của nó. Gõ mã đó ở đây để cho phép. Mã hết hạn sau {0} giây.', started.expiresInSeconds));
  for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt += 1) {
    const typed = await readCode(t('Mã trong cửa sổ Orglet: '));
    if (!typed?.trim()) {
      await held.cancelPairing(started.pairingId).catch(() => undefined);
      print.stderr(t('Đã hủy, không mở khóa.'));
      return false;
    }
    try {
      await held.finishPairing(started.pairingId, typed);
      return true;
    } catch (error) {
      if (!(error instanceof AppRefusal)) throw error;
      print.stderr(error.message);
      if (error.code !== 'invalid') return false;
    }
  }
  return false;
}

export function shortCardId(cardId: string): string {
  return cardId.slice(0, 8);
}

/** The card as the window shows it, then the choices and how to pick one. */
export function formatCard(card: WaitingCard, command: string): string {
  const lines = [`${card.title}  [${shortCardId(card.cardId)}]`, ...card.facts.map(fact => `  ${fact}`)];
  for (const choice of card.choices) lines.push(`  ${choice.key}: ${choice.label}  ->  ${command} ${choice.key}`);
  return lines.join('\n');
}

type ApproveArguments = { target: WaitingTarget; card?: string; choice?: string };

function takeValue(argumentList: readonly string[], index: number, option: string): string {
  const value = argumentList[index + 1];
  if (value === undefined) throw new UsageError(t('{0} cần một giá trị.', option));
  return value;
}

function parseApprove(argumentList: readonly string[]): ApproveArguments {
  const parsed: ApproveArguments = { target: {} };
  const positionals: string[] = [];
  for (let index = 1; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === '--to') parsed.target.to = takeValue(argumentList, index++, argument);
    else if (argument === '--chat') parsed.target.chat = takeValue(argumentList, index++, argument).replace(/^#/, '');
    else if (argument === '--card') parsed.card = takeValue(argumentList, index++, argument);
    else if (argument.startsWith('-')) throw new UsageError(t('Không có tùy chọn {0} cho orglet approve.', argument));
    else positionals.push(argument);
  }
  if (parsed.target.to && parsed.target.chat) throw new UsageError(t('orglet approve nhận --to hoặc --chat, không nhận cả hai.'));
  if (positionals.length > 1) throw new UsageError(t('orglet approve chỉ nhận một lựa chọn.'));
  if (positionals[0]) parsed.choice = positionals[0];
  return parsed;
}

function parseUsdMicros(text: string): number {
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(text)) throw new UsageError(t('Số tiền USD không hợp lệ: {0}.', text));
  return Math.round(Number(text) * 1_000_000);
}

/** The body a one-shot command other than `approve` sends, or a usage error. */
function directBody(command: HeldCommandName, argumentList: readonly string[]): HeldBody {
  if (command === 'install-update') return { action: 'install-update' };
  if (command === 'test') {
    const what = argumentList[1];
    if (what === 'web-search' || what === 'decision-model') return { action: 'test', what };
    if (what === 'mcp' && argumentList[2]) return { action: 'test', what, server: argumentList[2] };
    throw new UsageError(t('Gõ orglet test mcp <tên>, web-search hoặc decision-model.'));
  }
  const [, reservation, usd, source] = argumentList;
  if (!reservation || !usd || (source !== 'dashboard' && source !== 'invoice')) throw new UsageError(t('Gõ orglet reconcile <mã> <USD> dashboard|invoice.'));
  return { action: 'budget', cardId: reservation.replace(/^#/, ''), amountMicros: parseUsdMicros(usd), source: source === 'dashboard' ? 'provider_dashboard' : 'invoice' };
}

function pickCard(cards: readonly WaitingCard[], prefix: string | undefined): WaitingCard | 'none' | 'several' {
  const matching = prefix ? cards.filter(card => card.cardId.startsWith(prefix)) : cards;
  if (matching.length === 0) return 'none';
  return matching.length === 1 ? matching[0] : 'several';
}

/** Prints the card(s) a chat or the app waits on; with a choice, answers it. Returns the exit code. */
async function approve(held: HeldClient, parsed: ApproveArguments, terminal: HeldTerminal, print: Printer): Promise<number> {
  const target = parsed.target.to || parsed.target.chat ? parsed.target : {};
  const cards = await held.waiting(target);
  const command = `orglet approve ${target.to ? `--to "${target.to}"` : target.chat ? `--chat ${target.chat}` : ''}`.trimEnd();
  const picked = pickCard(cards, parsed.card);
  if (picked === 'none') {
    print.stderr(t('Không có thẻ nào đang chờ ở đây.'));
    return EXIT_CODES.failure;
  }
  if (picked === 'several') {
    for (const card of cards) print.stdout(`${formatCard(card, `${command} --card ${shortCardId(card.cardId)}`)}\n`);
    print.stderr(t('Có nhiều thẻ. Chọn một bằng --card <mã>.'));
    return EXIT_CODES.usage;
  }
  const chosen = parsed.choice ? picked.choices.find(choice => choice.key === parsed.choice) : undefined;
  if (!chosen) {
    print.stdout(formatCard(picked, `${command} --card ${shortCardId(picked.cardId)}`));
    if (parsed.choice) print.stderr(t('Thẻ này không có lựa chọn "{0}".', parsed.choice));
    return parsed.choice ? EXIT_CODES.usage : EXIT_CODES.ok;
  }
  print.stdout(formatCard({ ...picked, choices: [] }, command));
  return runPairedAction(held, chosen.request, terminal, print);
}

/** Pairs for exactly this operation, sends it, and forgets the key. */
async function runPairedAction(held: HeldClient, body: HeldBody, terminal: HeldTerminal, print: Printer): Promise<number> {
  try {
    const paired = await pairWithTerminal(held, 'one', body, prompt => readLineFromTerminal(terminal, prompt), print);
    if (!paired) return EXIT_CODES.failure;
    const done = await held.act(body);
    print.stdout(t('Xong: {0}', done.summary));
    return EXIT_CODES.ok;
  } catch (error) {
    if (error instanceof AppRefusal) {
      print.stderr(error.message);
      return EXIT_CODES.failure;
    }
    throw error;
  } finally {
    held.forget();
  }
}

export type HeldRun = {
  argumentList: readonly string[];
  print: Printer;
  userData: string;
  executable: string | undefined;
  /** Only present when standard input and output both are a terminal. */
  terminal: HeldTerminal | undefined;
  /** `orglet unlock` hands the unlocked client to the chat. */
  openUnlockedChat?: (held: HeldClient) => Promise<number>;
};

/** Runs a held command as a one-shot. Never sends anything before it knows there is a person at a terminal. */
export async function runHeldCommand(run: HeldRun): Promise<number> {
  const command = run.argumentList[0] as HeldCommandName;
  if (run.argumentList.includes('--help')) {
    run.print.stdout(HELD_HELP);
    return EXIT_CODES.ok;
  }
  let parsed: ApproveArguments | undefined;
  let body: HeldBody | undefined;
  try {
    if (command === 'approve') parsed = parseApprove(run.argumentList);
    else if (command !== 'unlock') body = directBody(command, run.argumentList);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    run.print.stderr(`${error.message}\n${t('Chạy "orglet unlock --help" để xem cách dùng.')}`);
    return EXIT_CODES.usage;
  }
  if (!run.terminal || !run.terminal.input.isTTY || !run.terminal.output.isTTY) {
    run.print.stderr(noTerminalMessage());
    return EXIT_CODES.usage;
  }
  const held = createHeldClient(run.userData, run.executable);
  try {
    if (command === 'approve') return await approve(held, parsed!, run.terminal, run.print);
    if (body) return await runPairedAction(held, body, run.terminal, run.print);
    const readCode = (prompt: string) => readLineFromTerminal(run.terminal!, prompt);
    if (!await pairWithTerminal(held, 'decisions', undefined, readCode, run.print)) return EXIT_CODES.failure;
    return run.openUnlockedChat ? await run.openUnlockedChat(held) : EXIT_CODES.ok;
  } catch (error) {
    if (error instanceof UnreachableError) {
      run.print.stderr(t('Orglet không chạy: {0}', error.message));
      return EXIT_CODES.unreachable;
    }
    throw error;
  } finally {
    held.forget();
  }
}
