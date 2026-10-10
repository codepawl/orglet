import { readFileSync, statSync } from 'node:fs';
import { UsageError } from './arguments';
import type { HeldBody } from './held-protocol';
import { parseMcpImportNamingSecrets, type McpNamedSecret } from '../shared/mcp';
import { t } from './text';

/**
 * `orglet grant …`, `orglet connect <provider>` and `orglet disconnect <provider>` (docs/cli-held-actions-design.md,
 * stages C and D): what the person types becomes one held body. A body never carries a secret; the one that needs a key
 * says so in `secretPrompt`, and the caller reads the key from the terminal with echo off after the pairing.
 */

export const SETUP_COMMANDS = ['grant', 'connect', 'disconnect'] as const;

/** `secretPrompt` is one key; `mcpSecrets` are the values a server file names, each typed after the pairing with echo off. */
export type SetupRequest = { body: HeldBody; secretPrompt?: string; mcpSecrets?: McpNamedSecret[] };

type Options = { positionals: string[]; to?: string; chat?: string; confirm?: string; profile?: string; mode?: string; lists: Record<string, string[]>; flags: Set<string> };

const VALUE_OPTIONS = new Set(['--to', '--chat', '--confirm', '--profile', '--mode']);
/** Options that may repeat, each repeat adding one value. */
const LIST_OPTIONS = new Set(['--allow', '--block', '--remove', '--add']);
const FLAG_OPTIONS = new Set(['--edit', '--run', '--cancel']);
const MAX_SERVER_FILE_BYTES = 1024 * 1024;

export const SETUP_HELP = [
  t('Cấp quyền và lưu khóa từ terminal, mỗi lệnh cần mã hiện trong cửa sổ Orglet (chỉ chạy khi có terminal):'),
  '  orglet grant tools (--to <name> | --chat <id>) <capability…>',
  '  orglet grant folder (--to <name> | --chat <id>) <path> [--edit | --run]',
  '  orglet grant folder-level (--to <name> | --chat <id>) read|edit|run',
  '  orglet grant folder-revoke (--to <name> | --chat <id>)',
  '  orglet grant schedule-folder watch|work <path> [--edit | --run]',
  '  orglet grant file-revoke <source id>',
  '  orglet grant mcp-enable <server> on|off',
  '  orglet grant mcp (--to <name> | --chat <id>) <server> [<tool>] allow|deny',
  '  orglet grant mcp-remove <server> | mcp-sign-in <server> [--cancel]',
  '  orglet grant limit (--to <name> | --chat <id>) <USD>',
  '  orglet grant space-tools <space> [<capability…>]',
  '  orglet grant decision-model off | <connection>:<model>…',
  '  orglet grant analytics|cli-path|send-to on|off',
  '  orglet grant backup <path>',
  '  orglet grant sync --confirm "<account name>" [merge|replace]',
  '  orglet grant browser-profile clear|delete <profile> --confirm "<profile name>"',
  '  orglet grant harness add <harness> <label> | remove|select|sign-in|sign-out <harness> <account> | cancel <harness>',
  '  orglet grant browser (--to <name> | --chat <id>) [--profile <name>] [--mode none|read|act] [--allow <site>…] [--block <site>…] [--remove <site>…]',
  '  orglet grant desktop (--to <name> | --chat <id>) [--mode none|read|act] [--add <program>…] [--remove <program>…]',
  '  orglet grant mcp-save <file.json> | mcp-import <file.json>      ' + t('tệp chỉ nêu tên bí mật; giá trị gõ ở terminal, không hiện'),
  '  orglet grant account sign-in|sign-out|cancel|reopen',
  '  orglet grant custom save <name> <base url> | delete <name>',
  '  orglet connect <provider>        ' + t('hỏi khóa, không hiện khi gõ'),
  '  orglet connect search <provider>',
  '  orglet disconnect <provider> | disconnect search <provider>',
].join('\n');

export function isSetupCommand(argumentList: readonly string[]): boolean {
  return (SETUP_COMMANDS as readonly string[]).includes(argumentList[0]);
}

function readOptions(argumentList: readonly string[]): Options {
  const options: Options = { positionals: [], lists: {}, flags: new Set() };
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (VALUE_OPTIONS.has(argument) || LIST_OPTIONS.has(argument)) {
      const value = argumentList[index + 1];
      if (value === undefined) throw new UsageError(t('{0} cần một giá trị.', argument));
      index += 1;
      if (argument === '--to') options.to = value;
      else if (argument === '--chat') options.chat = value.replace(/^#/, '');
      else if (argument === '--profile') options.profile = value;
      else if (argument === '--mode') options.mode = value;
      else if (LIST_OPTIONS.has(argument)) options.lists[argument] = [...(options.lists[argument] ?? []), value];
      else options.confirm = value;
    } else if (FLAG_OPTIONS.has(argument)) {
      options.flags.add(argument);
    } else if (argument.startsWith('--')) {
      throw new UsageError(t('Không có tùy chọn {0}.', argument));
    } else {
      options.positionals.push(argument);
    }
  }
  return options;
}

function chatFields(options: Options): { to?: string; chat?: string } {
  if ((options.to === undefined) === (options.chat === undefined)) throw new UsageError(t('Gõ --to <tên> hoặc --chat <mã>, chỉ một trong hai.'));
  return options.to !== undefined ? { to: options.to } : { chat: options.chat };
}

function permissionsOf(options: Options): ('read' | 'write' | 'execute')[] {
  if (options.flags.has('--run')) return ['read', 'write', 'execute'];
  return options.flags.has('--edit') ? ['read', 'write'] : ['read'];
}

function levelOf(word: string | undefined): ('read' | 'write' | 'execute')[] {
  if (word === 'read') return ['read'];
  if (word === 'edit') return ['read', 'write'];
  if (word === 'run') return ['read', 'write', 'execute'];
  throw new UsageError(t('Mức phải là read, edit hoặc run.'));
}

function needed(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(t('Thiếu {0}.', what));
  return value;
}

function onOff(word: string | undefined): boolean {
  if (word === 'on') return true;
  if (word === 'off') return false;
  throw new UsageError(t('Gõ on hoặc off.'));
}

function usdMicros(text: string | undefined): number {
  if (!text || !/^\d{1,5}(\.\d{1,6})?$/.test(text)) throw new UsageError(t('Số tiền USD không hợp lệ: {0}.', text ?? ''));
  return Math.round(Number(text) * 1_000_000);
}

function connectionBody(command: 'connect' | 'disconnect', positionals: string[]): SetupRequest {
  const forSearch = positionals[0] === 'search';
  const provider = needed(forSearch ? positionals[1] : positionals[0], t('tên nhà cung cấp'));
  if (command === 'disconnect') return { body: forSearch ? { action: 'search-key-remove', provider } : { action: 'disconnect', provider } };
  return {
    body: forSearch ? { action: 'search-key', provider } : { action: 'connect', provider },
    secretPrompt: t('Khóa của {0} (không hiện khi gõ): ', provider),
  };
}

function harnessBody(options: Options): HeldBody {
  const [, change, harness, third] = options.positionals;
  if (change === 'add') return { action: 'harness', change, harness: needed(harness, t('tên harness')), label: needed(third, t('tên tài khoản mới')) };
  if (change === 'cancel') return { action: 'harness', change, harness: needed(harness, t('tên harness')) };
  if (change === 'remove' || change === 'select' || change === 'sign-in' || change === 'sign-out') {
    return { action: 'harness', change, harness: needed(harness, t('tên harness')), account: needed(third, t('tên tài khoản')) };
  }
  throw new UsageError(t('Gõ orglet grant harness add, remove, select, sign-in, sign-out hoặc cancel.'));
}

function grantBody(options: Options): HeldBody {
  const [verb, first, second, third] = options.positionals;
  switch (verb) {
    case 'tools': return { action: 'tools', ...chatFields(options), capabilities: options.positionals.slice(1) };
    case 'folder': return { action: 'folder', ...chatFields(options), path: needed(first, t('đường dẫn thư mục')), permissions: permissionsOf(options) };
    case 'folder-level': return { action: 'folder-level', ...chatFields(options), permissions: levelOf(first) };
    case 'folder-revoke': return { action: 'folder-revoke', ...chatFields(options) };
    case 'schedule-folder':
      if (first !== 'watch' && first !== 'work') throw new UsageError(t('Gõ watch hoặc work.'));
      return { action: 'schedule-folder', kind: first, path: needed(second, t('đường dẫn thư mục')), permissions: first === 'watch' ? ['read'] : permissionsOf(options) };
    case 'file-revoke': return { action: 'file-revoke', sourceId: needed(first, t('mã tệp')) };
    case 'mcp-enable': return { action: 'mcp-enable', server: needed(first, t('tên máy chủ MCP')), enabled: onOff(second) };
    case 'mcp': {
      const answer = options.positionals.at(-1);
      if (answer !== 'allow' && answer !== 'deny') throw new UsageError(t('Kết thúc bằng allow hoặc deny.'));
      const tool = options.positionals.length === 4 ? second : undefined;
      return { action: 'mcp-grant', ...chatFields(options), server: needed(first, t('tên máy chủ MCP')), ...(tool ? { tool } : {}), allowed: answer === 'allow' };
    }
    case 'mcp-remove': return { action: 'mcp-remove', server: needed(first, t('tên máy chủ MCP')) };
    case 'mcp-sign-in': return { action: 'mcp-sign-in', server: needed(first, t('tên máy chủ MCP')), ...(options.flags.has('--cancel') ? { cancel: true } : {}) };
    case 'limit': return { action: 'limit', ...chatFields(options), budgetMicros: usdMicros(first) };
    case 'space-tools': return { action: 'space-tools', space: needed(first, t('tên không gian')), capabilities: options.positionals.slice(2) };
    case 'decision-model': return { action: 'decision-model', entries: first === 'off' ? [] : options.positionals.slice(1).map(decisionEntry) };
    case 'analytics':
    case 'cli-path':
    case 'send-to': return { action: 'switch', what: verb, enabled: onOff(first) };
    case 'backup': return { action: 'backup', path: needed(first, t('đường dẫn tệp')) };
    case 'sync': return { action: 'sync', confirm: needed(options.confirm, t('--confirm "<tên tài khoản>"')), ...(first === 'merge' || first === 'replace' ? { choice: first } : {}) };
    case 'browser-profile':
      if (first !== 'clear' && first !== 'delete') throw new UsageError(t('Gõ clear hoặc delete.'));
      return { action: 'browser-profile', change: first, profile: needed(second, t('tên hồ sơ')), confirm: needed(options.confirm, t('--confirm "<tên hồ sơ>"')) };
    case 'harness': return harnessBody(options);
    case 'account':
      if (first !== 'sign-in' && first !== 'sign-out' && first !== 'cancel' && first !== 'reopen') throw new UsageError(t('Gõ sign-in, sign-out, cancel hoặc reopen.'));
      return { action: 'account', change: first };
    case 'browser': return browserBody(options);
    case 'desktop': return desktopBody(options);
    case 'custom':
      if (first === 'delete') return { action: 'custom-connection', change: 'delete', name: needed(second, t('tên kết nối')) };
      if (first === 'save') return { action: 'custom-connection', change: 'save', name: needed(second, t('tên kết nối')), baseUrl: needed(third, t('địa chỉ gốc')) };
      throw new UsageError(t('Gõ orglet grant custom save <tên> <địa chỉ> hoặc delete <tên>.'));
    default: throw new UsageError(t('Gõ "orglet grant --help" để xem các việc có thể cấp.'));
  }
}

function modeOf(word: string | undefined): 'none' | 'read' | 'act' | undefined {
  if (word === undefined) return undefined;
  if (word === 'none' || word === 'read' || word === 'act') return word;
  throw new UsageError(t('--mode phải là none, read hoặc act.'));
}

function listed(options: Options, name: string): { [key: string]: string[] } {
  const values = options.lists[name];
  return values?.length ? { [name.slice(2)]: values } : {};
}

function hasList(options: Options, names: readonly string[]): boolean {
  return names.some(name => (options.lists[name]?.length ?? 0) > 0);
}

function browserBody(options: Options): HeldBody {
  if (options.profile === undefined && options.mode === undefined && !hasList(options, ['--allow', '--block', '--remove'])) {
    throw new UsageError(t('Gõ ít nhất một thay đổi: --profile, --mode, --allow, --block hoặc --remove.'));
  }
  return {
    action: 'browser-choice', ...chatFields(options),
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    ...(options.mode !== undefined ? { mode: modeOf(options.mode) } : {}),
    ...listed(options, '--allow'), ...listed(options, '--block'), ...listed(options, '--remove'),
  };
}

function desktopBody(options: Options): HeldBody {
  if (options.mode === undefined && !hasList(options, ['--add', '--remove'])) throw new UsageError(t('Gõ ít nhất một thay đổi: --mode, --add hoặc --remove.'));
  return {
    action: 'desktop-choice', ...chatFields(options),
    ...(options.mode !== undefined ? { mode: modeOf(options.mode) } : {}),
    ...listed(options, '--add'), ...listed(options, '--remove'),
  };
}

/** A server file, read here at the terminal: it names the secrets and never holds one. The values are typed after the pairing. */
function serverFileRequest(verb: 'mcp-save' | 'mcp-import', path: string | undefined): SetupRequest {
  const file = needed(path, t('đường dẫn tệp JSON'));
  let text: string;
  try {
    if (statSync(file).size > MAX_SERVER_FILE_BYTES) throw new UsageError(t('Tệp lớn quá 1 MB.'));
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(t('Không đọc được tệp {0}.', file));
  }
  let parsed: ReturnType<typeof parseMcpImportNamingSecrets>;
  try {
    parsed = parseMcpImportNamingSecrets(text);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : t('Tệp không hợp lệ.'));
  }
  if (parsed.drafts.length === 0) throw new UsageError(parsed.skipped.map(item => `${item.name}: ${item.reason}`).join(' '));
  if (verb === 'mcp-save' && parsed.drafts.length !== 1) throw new UsageError(t('Tệp có {0} máy chủ. Dùng orglet grant mcp-import cho nhiều máy chủ.', parsed.drafts.length));
  return { body: { action: verb, servers: parsed.drafts }, ...(parsed.secrets.length ? { mcpSecrets: parsed.secrets } : {}) };
}

function decisionEntry(text: string): { connection: string; model: string } {
  const split = text.indexOf(':');
  if (split < 1 || split === text.length - 1) throw new UsageError(t('Gõ <kết nối>:<model>, ví dụ openai:gpt-5-mini.'));
  return { connection: text.slice(0, split), model: text.slice(split + 1) };
}

/** Reads the arguments after the command name (`grant`, `connect` or `disconnect` is `argumentList[0]`). */
export function parseSetupArguments(argumentList: readonly string[]): SetupRequest {
  const command = argumentList[0] as typeof SETUP_COMMANDS[number];
  const options = readOptions(argumentList.slice(1));
  if (command === 'grant') {
    const [verb, file] = options.positionals;
    if (verb === 'mcp-save' || verb === 'mcp-import') return serverFileRequest(verb, file);
    return { body: grantBody(options) };
  }
  return connectionBody(command, options.positionals);
}
