import type { CliChat } from '../cli/protocol';
import { CliFailure, matchChat } from './cli-operations';

/**
 * What a start of Orglet.exe asks for beyond opening the window (COD-246): files from Explorer's Send to menu, or an
 * `orglet://` link. Both arrive as command-line arguments, at a cold start or in the second instance the
 * single-instance lock turns away. Everything here is checked before the window hears of it, and nothing a link can
 * say changes a setting, grants anything, deletes or sends: a link only opens a chat and fills its message box.
 */

/** The first argument the Send to shortcut passes. Explorer appends the selected paths after it. */
export const SEND_TO_FLAG = '--orglet-send-to';

export const LINK_SCHEME = 'orglet';

/** Longer than any link a person would write by hand, far shorter than what could stall the window. */
export const MAX_LINK_LENGTH = 8192;

/** The most text a link may put in the message box. */
export const MAX_PREFILL_LENGTH = 4000;

export const MAX_NAME_LENGTH = 200;

/** Explorer's command line stops near 32,000 characters, so this is only a guard against a crafted start. */
export const MAX_SENT_PATHS = 500;

export type OrgletLink =
  | { action: 'chat'; target: string }
  | { action: 'new'; target: string; text: string };

export type LaunchRequest =
  | { kind: 'send-to'; paths: string[] }
  | { kind: 'link'; link: OrgletLink }
  /** A link that cannot be followed; `message` is a Vietnamese source string for a calm notice. */
  | { kind: 'refused'; message: string };

export const LINK_NOT_UNDERSTOOD = 'Orglet không hiểu liên kết này.';
export const LINK_TOO_LONG = 'Liên kết dài quá nên Orglet bỏ qua.';
export const LINK_TEXT_TOO_LONG = 'Nội dung điền sẵn trong liên kết dài hơn 4.000 ký tự nên Orglet bỏ qua.';
export const LINK_BAD_NAME = 'Liên kết không ghi rõ Tí hay hội nào.';

type LinkResult = { ok: true; link: OrgletLink } | { ok: false; message: string };

function refused(message: string): LinkResult {
  return { ok: false, message };
}

function isSwitch(argument: string): boolean {
  return argument.startsWith('-');
}

function isLinkArgument(argument: string): boolean {
  return argument.toLowerCase().startsWith(`${LINK_SCHEME}:`);
}

/**
 * The paths after the Send to flag. Anything that looks like a switch is dropped: Chromium adds some of its own to a
 * second instance's arguments, and the `--` the shortcut puts before the paths is one too.
 */
function sentPaths(argv: readonly string[], flagIndex: number): string[] {
  const after = argv.slice(flagIndex + 1);
  const paths = after.filter(argument => argument.trim() !== '' && !isSwitch(argument));
  return paths.slice(0, MAX_SENT_PATHS);
}

/** What this start asks for, or undefined for an ordinary start. `argv[0]` is the executable and is never read. */
export function parseLaunchArguments(argv: readonly string[]): LaunchRequest | undefined {
  const flagIndex = argv.findIndex((argument, index) => index > 0 && argument.toLowerCase() === SEND_TO_FLAG);
  if (flagIndex > 0) {
    const paths = sentPaths(argv, flagIndex);
    if (paths.length === 0) return undefined;
    return { kind: 'send-to', paths };
  }
  const link = argv.find((argument, index) => index > 0 && isLinkArgument(argument));
  if (!link) return undefined;
  const parsed = parseOrgletLink(link);
  if (!parsed.ok) return { kind: 'refused', message: parsed.message };
  return { kind: 'link', link: parsed.link };
}

/** Control characters, and the ones that reorder text on screen, have no place in a name or a message. */
const HIDDEN_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** The text a link puts in the message box: its line breaks kept, hidden characters taken out. */
export function cleanPrefill(text: string): string {
  const unixLines = text.replace(/\r\n?/g, '\n');
  return unixLines.replace(HIDDEN_CHARACTERS, '');
}

function cleanName(value: string | null): string | undefined {
  if (value === null) return undefined;
  const name = value.trim();
  if (name === '' || name.length > MAX_NAME_LENGTH) return undefined;
  const withoutHidden = name.replace(HIDDEN_CHARACTERS, '');
  if (withoutHidden !== name || name.includes('\n') || name.includes('\t')) return undefined;
  return name;
}

/**
 * The route of a link: `orglet://chat/Researcher` has the host `chat` and the path `/Researcher`, while a link
 * written without the slashes (`orglet:chat/Researcher`) has everything in the path. Each part is decoded once.
 */
function routeOf(url: URL): string[] | undefined {
  const parts = [url.host, ...url.pathname.split('/')].filter(part => part !== '');
  try {
    return parts.map(part => decodeURIComponent(part));
  } catch {
    return undefined;
  }
}

/** Reads one `orglet://` link. It must name something to open; anything else is refused with a reason. */
export function parseOrgletLink(raw: string): LinkResult {
  if (raw.length > MAX_LINK_LENGTH) return refused(LINK_TOO_LONG);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refused(LINK_NOT_UNDERSTOOD);
  }
  if (url.protocol.toLowerCase() !== `${LINK_SCHEME}:`) return refused(LINK_NOT_UNDERSTOOD);
  if (url.username || url.password || url.port) return refused(LINK_NOT_UNDERSTOOD);
  const route = routeOf(url);
  if (!route || route.length === 0) return refused(LINK_NOT_UNDERSTOOD);
  const action = route[0].toLowerCase();
  if (action === 'chat') return chatLink(route.slice(1));
  if (action === 'new') return newChatLink(route.slice(1), url.searchParams);
  return refused(LINK_NOT_UNDERSTOOD);
}

function chatLink(rest: readonly string[]): LinkResult {
  const target = cleanName(rest.join('/'));
  if (!target) return refused(LINK_BAD_NAME);
  return { ok: true, link: { action: 'chat', target } };
}

function newChatLink(rest: readonly string[], parameters: URLSearchParams): LinkResult {
  if (rest.length > 0) return refused(LINK_NOT_UNDERSTOOD);
  const target = cleanName(parameters.get('to'));
  if (!target) return refused(LINK_BAD_NAME);
  const text = cleanPrefill(parameters.get('text') ?? '');
  if (text.length > MAX_PREFILL_LENGTH) return refused(LINK_TEXT_TOO_LONG);
  return { ok: true, link: { action: 'new', target, text } };
}

/**
 * The chat a link names: an orglet's or crew's id, then its name the way `orglet --to` matches one (exact, then a
 * unique start). An unknown or ambiguous name gives the same Vietnamese message the terminal command prints.
 */
export function resolveLinkChat(target: string, chats: readonly CliChat[]): { ok: true; chat: CliChat } | { ok: false; message: string } {
  const byId = chats.find(chat => chat.id === target);
  if (byId) return { ok: true, chat: byId };
  try {
    return { ok: true, chat: matchChat(target, chats) };
  } catch (error) {
    if (error instanceof CliFailure) return { ok: false, message: error.message };
    throw error;
  }
}
