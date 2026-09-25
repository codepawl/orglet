/** The commands of `orglet chat` that start with a slash, and their Tab completion (COD-236). */

export type SlashCommand =
  | { kind: 'to'; name?: string }
  | { kind: 'list' }
  | { kind: 'read' }
  | { kind: 'open' }
  | { kind: 'clear' }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'unknown'; command: string };

/** In the order `/help` lists them. */
export const SLASH_COMMANDS = ['/to', '/list', '/read', '/open', '/clear', '/help', '/exit'] as const;

export const SLASH_HELP: readonly [string, string][] = [
  ['/to <name>', 'Switch to another orglet or crew; without a name, pick from the list'],
  ['/list', 'List orglets and crews'],
  ['/read', 'Show the latest answer in this chat again'],
  ['/open', 'Bring the app forward on this chat'],
  ['/clear', 'Clear the screen'],
  ['/help', 'Show these commands'],
  ['/exit', 'Leave (Ctrl+D does the same)'],
];

export function isSlashCommand(line: string): boolean {
  return line.trimStart().startsWith('/');
}

/** Reads one typed line that starts with a slash. Command names ignore case; `/quit` is `/exit`. */
export function parseSlash(line: string): SlashCommand {
  const trimmed = line.trim();
  const space = trimmed.search(/\s/);
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : trimmed.slice(space).trim();
  switch (command) {
    case '/to': return rest ? { kind: 'to', name: rest } : { kind: 'to' };
    case '/list': return { kind: 'list' };
    case '/read': return { kind: 'read' };
    case '/open': return { kind: 'open' };
    case '/clear': return { kind: 'clear' };
    case '/help': return { kind: 'help' };
    case '/exit':
    case '/quit': return { kind: 'exit' };
    default: return { kind: 'unknown', command };
  }
}

function startsWithIgnoringCase(text: string, start: string): boolean {
  return text.toLocaleLowerCase().startsWith(start.toLocaleLowerCase());
}

/**
 * Tab completion in the shape `readline` expects: the candidate lines and the part of the line they replace. A
 * command completes from its start, and `/to ` completes the chat names.
 */
export function completeSlash(line: string, names: readonly string[]): [string[], string] {
  if (!isSlashCommand(line)) return [[], line];
  const toMatch = line.match(/^\s*\/to\s+(.*)$/i);
  if (toMatch) {
    const partial = toMatch[1];
    const matches = names.filter(name => startsWithIgnoringCase(name, partial));
    return [matches.map(name => `/to ${name}`), line];
  }
  if (/\s/.test(line.trim())) return [[], line];
  const typed = line.trim();
  const matches = SLASH_COMMANDS.filter(command => startsWithIgnoringCase(command, typed));
  // `/to` needs a name after it, so its completion ends with the space.
  return [matches.map(command => (command === '/to' ? '/to ' : command)), line];
}
