/**
 * The time zones a schedule can pick (COD-283). The editor used to take a typed name, which let people save a typo and
 * gave no hint of what was valid. Now it lists every IANA zone this runtime knows, the computer's own zone first.
 */
export type TimeZoneChoice = {
  /** The IANA name that is saved, such as `Asia/Ho_Chi_Minh`. */
  value: string;
  /** The place, readable: `Ho Chi Minh`, `Argentina / Buenos Aires`, `UTC`. */
  label: string;
  /** The IANA region the place sits in (`Asia`, `America`), or empty for a zone without one such as `UTC`. */
  region: string;
  /** The offset from UTC at the given moment, such as `UTC+7` or `UTC-3:30`; empty for UTC itself, whose name says it. */
  offset: string;
  /** The computer's own zone, listed first. */
  system: boolean;
};

/** Every zone name the runtime supports; an old runtime without the list offers the zones it was given. */
function supportedZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
}

/** `America/Argentina/Buenos_Aires` → region `America`, label `Argentina / Buenos Aires`. */
function placeOf(zone: string): { region: string; label: string } {
  const parts = zone.split('/');
  if (parts.length === 1) return { region: '', label: zone.replace(/_/g, ' ') };
  const [region, ...place] = parts;
  return { region, label: place.map(part => part.replace(/_/g, ' ')).join(' / ') };
}

/** The zone's offset at `at`, written from UTC; a zone the runtime cannot read shows no offset. */
function offsetOf(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at);
    const name = parts.find(part => part.type === 'timeZoneName')?.value ?? '';
    // GMT alone, and GMT+0 in some runtimes, are both plain UTC.
    return name.replace(/^GMT/, 'UTC').replace(/^UTC\+0$/, 'UTC');
  } catch {
    return '';
  }
}

/** Plain code-point order, so a region's zones are never split by how a locale collates `/` and `_`. */
function byCodePoint(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

/**
 * The list the editor shows: the computer's zone first, then every other zone by name, so each region's zones stay
 * together, with UTC last. A saved zone the runtime does not list (an alias typed before this list existed, such as
 * `Asia/Saigon`) is kept among them as saved, so opening and saving an old schedule never changes its zone.
 */
export function timeZoneChoices(systemZone: string, savedZone: string, at: Date, zones: readonly string[] = supportedZones()): TimeZoneChoice[] {
  const others = new Set(zones);
  // The runtime's list has no UTC (Node and Chromium list only places), yet it is a common pick for a schedule.
  others.add('UTC');
  others.add(savedZone);
  others.delete(systemZone);
  const choice = (zone: string, system: boolean): TimeZoneChoice => ({ value: zone, ...placeOf(zone), offset: zone === 'UTC' ? '' : offsetOf(zone, at), system });
  const sorted = [...others].sort(byCodePoint);
  return [choice(systemZone, true), ...sorted.map(zone => choice(zone, false))];
}
