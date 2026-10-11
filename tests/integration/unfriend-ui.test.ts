import { describe, expect, it } from 'vitest';
import type { OrgletPlace } from '../../apps/desktop/src/shared/unfriend';
import {
  defaultKickedKeys,
  directMessageWorkers,
  keptPlaceNames,
  keptPlaces,
  placeKey,
  toggleKicked,
  unfriendOutcomeLine,
} from '../../apps/desktop/src/renderer/unfriendChoice';
import { sendToOptions } from '../../apps/desktop/src/renderer/sendTo';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

const space: OrgletPlace = { kind: 'space', id: 'space-1', name: 'Studio', canKick: true };
const channel: OrgletPlace = { kind: 'channel', id: 'channel-1', name: 'research', canKick: true };
const soleChannel: OrgletPlace = { kind: 'channel', id: 'channel-2', name: 'solo', canKick: false };

describe('the unfriend choice', () => {
  it('starts with every place that can be kicked checked, and never the one that cannot', () => {
    const kicked = defaultKickedKeys([space, channel, soleChannel]);
    expect([...kicked].sort()).toEqual([placeKey(channel), placeKey(space)].sort());
  });

  it('keeps the places the person unchecked and the one that cannot be kicked', () => {
    const places = [space, channel, soleChannel];
    const kicked = toggleKicked(defaultKickedKeys(places), channel);
    expect(keptPlaces(places, kicked)).toEqual([
      { kind: 'channel', id: 'channel-1' },
      { kind: 'channel', id: 'channel-2' },
    ]);
  });

  it('ignores a toggle on a place that cannot be kicked', () => {
    const kicked = toggleKicked(defaultKickedKeys([soleChannel]), soleChannel);
    expect(kicked.size).toBe(0);
    expect(keptPlaces([soleChannel], kicked)).toEqual([{ kind: 'channel', id: 'channel-2' }]);
  });

  it('says the orglet is removed only when nothing is kept', () => {
    expect(unfriendOutcomeLine([space, channel], defaultKickedKeys([space, channel]))).toEqual({ kind: 'removed' });
    expect(unfriendOutcomeLine([space, soleChannel], defaultKickedKeys([space, soleChannel]))).toEqual({ kind: 'kept', keptCount: 1 });
    expect(unfriendOutcomeLine([space, channel], new Set())).toEqual({ kind: 'kept', keptCount: 2 });
  });

  it('joins the place names for the line under an unfriended orglet', () => {
    expect(keptPlaceNames([space, channel])).toBe('Studio, research');
  });
});

describe('an unfriended orglet is not a direct message', () => {
  const friend = { id: 'a', name: 'Ada' } as Worker;
  const unfriended = { id: 'b', name: 'Bo', unfriendedAt: '2026-10-11T00:00:00.000Z' } as Worker;

  it('filters unfriended orglets out of the direct message list', () => {
    expect(directMessageWorkers([friend, unfriended])).toEqual([friend]);
  });

  it('leaves them out of the Send to list but keeps the rest', () => {
    const options = sendToOptions({ tasks: [], workers: [friend, unfriended], teams: [] });
    const names = options.filter(option => option.group === 'orglets').map(option => option.name);
    expect(names).toEqual(['Ada']);
  });
});
