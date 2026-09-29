import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ModelEntry } from '../../shared/models';
import { cleanEnv, commandLine } from '../harness/detect';

/** The `--model` aliases Claude Code documents. Which model each stands for is asked from the CLI itself (COD-332). */
export const CLAUDE_CODE_ALIASES: ReadonlyArray<{ id: string; displayName: string }> = [
  { id: 'sonnet', displayName: 'Sonnet' },
  { id: 'opus', displayName: 'Opus' },
  { id: 'haiku', displayName: 'Haiku' },
  { id: 'fable', displayName: 'Fable' },
];

/** Names the model Claude Code picks with this alias, or with none; undefined when the CLI did not say. */
export type ClaudeStartProbe = (executable: string, env: NodeJS.ProcessEnv, alias?: string) => Promise<string | undefined>;

/** What Claude Code and the Models API said: the model a run takes by default, each alias's model, and the names. */
export type ClaudeCodeReading = {
  defaultModel?: string;
  aliases: Partial<Record<string, string>>;
  /** Every model the account may use, with the vendor's display name; undefined when the list could not be read. */
  named?: ModelEntry[];
};

// Starting Claude Code and reading its first line took 8 to 10 seconds on 2026-09-29 (2.1.283, four at once).
const START_TIMEOUT_MS = 20_000;
const DATED_SUFFIX = /^-\d{8}$/;

/**
 * The flags Orglet's own runs pass (`harnessArgs`), so the answer matches a run: `--restricted` leaves the person's
 * settings file out, and with it a model set there. The prompt is `/cost`, which the CLI answers itself without a
 * model call (0 tokens on 2026-09-29); the process is stopped as soon as its first line names the model anyway.
 */
export function claudeStartArgs(alias?: string): string[] {
  const model = alias ? ['--model', alias] : [];
  return ['-p', '/cost', ...model, '--output-format', 'stream-json', '--verbose', '--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence'];
}

/** The model named by a `system`/`init` line of `--output-format stream-json`, or undefined for any other line. */
export function startLineModel(line: string): string | undefined {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!message || typeof message !== 'object') return undefined;
  const record = message as { type?: unknown; subtype?: unknown; model?: unknown };
  if (record.type !== 'system' || record.subtype !== 'init') return undefined;
  return typeof record.model === 'string' && record.model.trim() ? record.model.trim().slice(0, 200) : undefined;
}

/** Starts Claude Code in the system temp folder, reads lines until the start line, then stops it. */
export const claudeStartProbe: ClaudeStartProbe = (executable, env, alias) => new Promise(resolve => {
  const command = commandLine(executable, claudeStartArgs(alias));
  const child = spawn(command.file, command.args, {
    cwd: tmpdir(),
    windowsHide: true,
    windowsVerbatimArguments: command.verbatim,
    env: { ...cleanEnv(process.env), ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buffered = '';
  let finished = false;
  const finish = (model: string | undefined) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    resolve(model);
  };
  const timer = setTimeout(() => finish(undefined), START_TIMEOUT_MS);
  child.on('error', () => finish(undefined));
  child.on('exit', () => finish(undefined));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline >= 0 && !finished) {
      const model = startLineModel(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (model) finish(model);
    }
  });
});

/** Drops a context tag such as `[1m]`, which names the same model. */
function baseModelId(modelId: string): string {
  return modelId.replace(/\[[^\]]*\]$/, '').toLowerCase();
}

/** The same model, allowing a dated ID (`claude-haiku-4-5-20251001`) for its undated name. */
export function sameClaudeModel(first: string, second: string): boolean {
  const a = baseModelId(first);
  const b = baseModelId(second);
  if (a === b) return true;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) && DATED_SUFFIX.test(longer.slice(shorter.length));
}

/** Every row in this picker is a Claude model and wears Claude's mark, so the vendor word is left off. */
function shortName(displayName: string | undefined): string | undefined {
  const name = displayName?.replace(/^Claude\s+/i, '').trim();
  return name ? name : undefined;
}

function nameOf(reading: ClaudeCodeReading, modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  return shortName(reading.named?.find(entry => sameClaudeModel(entry.id, modelId))?.displayName);
}

/**
 * The picker's rows for Claude Code. The aliases come first, named by the model the CLI says each stands for today
 * ("Opus 5.5"), or by the alias alone when it did not say or the name is unknown; the alias the CLI starts with
 * carries `isDefault`. Every other model the account may use follows as a full ID, so it can be pinned.
 */
export function claudeCodeEntries(reading: ClaudeCodeReading): ModelEntry[] {
  let defaultTaken = false;
  const aliasRows = CLAUDE_CODE_ALIASES.map(alias => {
    const resolvedId = reading.aliases[alias.id];
    const isDefault = !defaultTaken && Boolean(resolvedId && reading.defaultModel && sameClaudeModel(resolvedId, reading.defaultModel));
    if (isDefault) defaultTaken = true;
    const entry: ModelEntry = {
      provider: 'claude-code',
      id: alias.id,
      displayName: nameOf(reading, resolvedId) ?? alias.displayName,
      aliases: [alias.id],
      source: 'alias',
      ...(resolvedId ? { resolvedId } : {}),
      ...(isDefault ? { isDefault: true as const } : {}),
    };
    return entry;
  });
  const covered = aliasRows.flatMap(row => row.resolvedId ? [row.resolvedId] : []);
  const defaultRow: ModelEntry[] = reading.defaultModel && !defaultTaken
    ? [{ provider: 'claude-code', id: reading.defaultModel, source: 'native', isDefault: true, ...optionalName(nameOf(reading, reading.defaultModel)) }]
    : [];
  if (reading.defaultModel) covered.push(reading.defaultModel);
  const others = (reading.named ?? [])
    .filter(entry => !covered.some(modelId => sameClaudeModel(modelId, entry.id)))
    .map((entry): ModelEntry => ({ provider: 'claude-code', id: entry.id, source: 'native', ...optionalName(shortName(entry.displayName)) }));
  return [...aliasRows, ...defaultRow, ...others];
}

function optionalName(displayName: string | undefined) {
  return displayName ? { displayName } : {};
}
