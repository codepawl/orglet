import { isCustomProvider } from './custom-connections';
import { CATALOG_HINT_IDS, type ModelEntry, type ModelListProvider } from './models';

/** Whose model a row is, for the mark beside its name. Absent means the connection's own mark. */
export type ModelVendor = 'claude' | 'openai' | 'gemini' | 'grok' | 'cursor' | 'ollama' | 'openrouter' | 'opencode';

/** One row of a model picker (COD-332). */
export type ModelChoice = {
  /** What choosing the row saves on the orglet. The empty string is "no model set": the CLI's or provider's default. */
  value: string;
  /** The listed model behind the row; absent for a default nobody has named. */
  entry?: ModelEntry;
  /** The versioned name, else the ID; absent for a default nobody has named, which the picker calls "Default". */
  label?: string;
  vendor?: ModelVendor;
  /** Wears the Default badge: the model that runs when none is set. */
  isDefault: boolean;
  /** Listed under More models: an older version of a model above it, or one only a full ID reaches. */
  more: boolean;
};

const PROVIDER_VENDORS: Partial<Record<ModelListProvider, ModelVendor>> = {
  'claude-code': 'claude',
  anthropic: 'claude',
  codex: 'openai',
  openai: 'openai',
  xai: 'grok',
  gemini: 'gemini',
  cursor: 'cursor',
  ollama: 'ollama',
  openrouter: 'openrouter',
  'opencode-zen': 'opencode',
  'opencode-go': 'opencode',
};

// Whose model it is, read from its ID and name. A connection that serves many vendors' models (Cursor Agent,
// OpenRouter, OpenCode) then shows each model's own mark; anything else keeps the connection's.
const VENDOR_WORDS: ReadonlyArray<[ModelVendor, RegExp]> = [
  ['claude', /\b(claude|anthropic|opus|sonnet|haiku|fable)\b/],
  ['openai', /\b(gpt|openai|codex|o\d)\b/],
  ['gemini', /\b(gemini|google)\b/],
  ['grok', /\b(grok|x-ai|xai)\b/],
  ['cursor', /\b(composer|cursor)\b/],
];

export function modelVendor(provider: ModelListProvider, entry: Pick<ModelEntry, 'id' | 'displayName'> | undefined): ModelVendor | undefined {
  const words = `${entry?.id ?? ''} ${entry?.displayName ?? ''}`.toLowerCase();
  const named = VENDOR_WORDS.find(([, pattern]) => pattern.test(words));
  if (named) return named[0];
  return isCustomProvider(provider) ? undefined : PROVIDER_VENDORS[provider];
}

/** A number in a model's name, not part of a longer number or a date: "5.5" in "Opus 5.5", "6" in "GPT-6-Sol". */
const VERSION_IN_NAME = /(^|[^\d.])(\d{1,3}(?:\.\d{1,3})?)(?![\d.])/;

/**
 * The family and version a model's display name spells out: "GPT-5.6-Sol" is version 5.6 of "gpt sol", "Claude Opus
 * 4.5" version 4.5 of "claude opus". Read only from the vendor's own display name, never from an ID, and undefined when
 * the name has no version.
 */
export function modelVersion(name: string | undefined): { family: string; version: number[] } | undefined {
  const match = name?.match(VERSION_IN_NAME);
  if (!name || !match || match.index === undefined) return undefined;
  const start = match.index + match[1].length;
  const rest = `${name.slice(0, start)} ${name.slice(start + match[2].length)}`;
  const family = rest.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return { family, version: match[2].split('.').map(Number) };
}

function newerVersion(first: number[], second: number[]): boolean {
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** Whether another listed model is a newer version of the same family. */
function supersededInList(entry: ModelEntry, models: readonly ModelEntry[]): boolean {
  const own = modelVersion(entry.displayName);
  if (!own) return false;
  return models.some(other => {
    const theirs = modelVersion(other.displayName);
    return theirs !== undefined && theirs.family === own.family && newerVersion(theirs.version, own.version);
  });
}

/**
 * In a list of aliases (Claude Code), the aliases are what the CLI means by each name and always stay on top, even
 * when a newer version is reachable by its full ID; every full ID sits under More models.
 */
function belongsUnderMore(entry: ModelEntry, models: readonly ModelEntry[], listHasAliases: boolean): boolean {
  if (listHasAliases) return entry.source !== 'alias';
  if (entry.replacementId) return true;
  return supersededInList(entry, models);
}

/** The listed model that runs when none is set: the one the CLI named, else Orglet's own suggestion for the API. */
export function defaultEntryId(provider: ModelListProvider, models: readonly ModelEntry[]): string | undefined {
  const named = models.find(entry => entry.isDefault);
  if (named) return named.id;
  return Object.hasOwn(CATALOG_HINT_IDS, provider) ? CATALOG_HINT_IDS[provider as keyof typeof CATALOG_HINT_IDS] : undefined;
}

/**
 * The rows of a model picker, in list order: the current model of each family first, the rest marked `more`. The row
 * that runs by default saves the empty value, so an orglet left on it follows the CLI when its default changes. When
 * that model is not in the list, or nobody knows it, a separate first row stands for it. `hasDefault` is false for a
 * connection that has no default (the OpenCode plans), which gets no such row.
 */
export function modelChoices(provider: ModelListProvider, models: readonly ModelEntry[], hasDefault: boolean): ModelChoice[] {
  const defaultId = hasDefault ? defaultEntryId(provider, models) : undefined;
  const listHasAliases = models.some(entry => entry.source === 'alias');
  const listed = models.map((entry): ModelChoice => {
    const isDefault = entry.id === defaultId;
    return {
      value: isDefault ? '' : entry.id,
      entry,
      label: entry.displayName ?? entry.id,
      vendor: modelVendor(provider, entry),
      isDefault,
      more: !isDefault && belongsUnderMore(entry, models, listHasAliases),
    };
  });
  if (!hasDefault || listed.some(choice => choice.isDefault)) return listed;
  const unlisted: ModelChoice = defaultId
    ? { value: '', label: defaultId, vendor: modelVendor(provider, { id: defaultId }), isDefault: true, more: false }
    : { value: '', vendor: modelVendor(provider, undefined), isDefault: false, more: false };
  return [unlisted, ...listed];
}

/**
 * Which row an orglet's saved model checks. Nothing saved is the default row; so is a saved ID that names the default
 * row's model (the alias, or the model the CLI resolved it to), which choosing that row would clear.
 */
export function checkedChoiceValue(choices: readonly ModelChoice[], savedModelId: string | undefined): string {
  if (!savedModelId) return '';
  const defaultEntry = choices.find(choice => choice.value === '')?.entry;
  if (defaultEntry && (defaultEntry.id === savedModelId || defaultEntry.resolvedId === savedModelId)) return '';
  return savedModelId;
}
