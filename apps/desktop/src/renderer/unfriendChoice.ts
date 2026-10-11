import type { OrgletPlace } from '../shared/unfriend';

/** The places to keep, in the shape `unfriendWorker` takes. */
export type KeptPlace = { kind: OrgletPlace['kind']; id: string };

/** What the dialog's status line says: the orglet goes away entirely, or stays in some places. */
export type UnfriendOutcomeLine = { kind: 'removed' } | { kind: 'kept'; keptCount: number };

export function placeKey(place: Pick<OrgletPlace, 'kind' | 'id'>): string {
  return `${place.kind}:${place.id}`;
}

/** Every place that can be kicked starts checked. A place that cannot be kicked is never in the set. */
export function defaultKickedKeys(places: readonly OrgletPlace[]): Set<string> {
  return new Set(places.filter(place => place.canKick).map(placeKey));
}

/** A place stays when it cannot be kicked or the person unchecked it. */
export function keptPlaces(places: readonly OrgletPlace[], kickedKeys: ReadonlySet<string>): KeptPlace[] {
  return places
    .filter(place => !place.canKick || !kickedKeys.has(placeKey(place)))
    .map(place => ({ kind: place.kind, id: place.id }));
}

export function toggleKicked(kickedKeys: ReadonlySet<string>, place: OrgletPlace): Set<string> {
  const next = new Set(kickedKeys);
  const key = placeKey(place);
  if (!place.canKick) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function unfriendOutcomeLine(places: readonly OrgletPlace[], kickedKeys: ReadonlySet<string>): UnfriendOutcomeLine {
  const keptCount = keptPlaces(places, kickedKeys).length;
  return keptCount === 0 ? { kind: 'removed' } : { kind: 'kept', keptCount };
}

/** The names of the places an unfriended orglet still answers in, for the Friends line "Vẫn ở ...". */
export function keptPlaceNames(places: readonly OrgletPlace[]): string {
  return places.map(place => place.name).join(', ');
}

/** The orglets that still have a direct message: an unfriended one only answers in the places that kept it. */
export function directMessageWorkers<Person extends { unfriendedAt?: string }>(workers: readonly Person[]): Person[] {
  return workers.filter(worker => !worker.unfriendedAt);
}
