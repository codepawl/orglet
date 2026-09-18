import type { ModelEntry } from './models';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Match a typed or saved ID to a cached row by exact slug or alias. Never fuzzy-matches. */
export function listedModel(models: readonly ModelEntry[], id: string | undefined): ModelEntry | undefined {
  const needle = id?.trim();
  if (!needle) return undefined;
  return models.find(entry => entry.id === needle || entry.aliases?.includes(needle));
}

/**
 * The picker value, or `hint` (catalog suggestion) when the field is empty.
 * A custom ID that is not on the list has no deprecation metadata — we do not invent it.
 */
export function pickerListedModel(models: readonly ModelEntry[], value: string, hint?: string): ModelEntry | undefined {
  return listedModel(models, value.trim() || hint);
}

/** Calendar day from native `sunsetAt` (`YYYY-MM-DD`). Invalid or missing values are omitted, never guessed. */
export function formatSunsetDay(sunsetAt: string | undefined, locale: string): string | undefined {
  if (!sunsetAt) return undefined;
  const match = DAY.exec(sunsetAt);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export type DeprecationNotice = {
  deprecated: true;
  sunsetAt?: string;
  replacementId?: string;
};

/** Chip fields from a cached row. `sunsetAt` only when the native payload stored a day. */
export function deprecationNotice(entry: ModelEntry | undefined): DeprecationNotice | undefined {
  if (!entry?.deprecated) return undefined;
  return {
    deprecated: true,
    ...(entry.sunsetAt ? { sunsetAt: entry.sunsetAt } : {}),
    ...(entry.replacementId ? { replacementId: entry.replacementId } : {}),
  };
}
