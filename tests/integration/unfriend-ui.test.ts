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

const space: OrgletPlace = { kind: 'space', id: 'space-1', name: 'Studio' };
const channel: OrgletPlace = { kind: 'channel', id: 'channel-1', name: 'research' };
const soleChannel: OrgletPlace = { kind: 'channel', id: 'channel-2', name: 'solo' };

describe('the unfriend choice', () => {
  it('starts with every place checked, including one the orglet is alone in', () => {
    const kicked = defaultKickedKeys([space, channel, soleChannel]);
    expect([...kicked].sort()).toEqual([placeKey(channel), placeKey(soleChannel), placeKey(space)].sort());
  });

  it('keeps only the places the person unchecked', () => {
    const places = [space, channel, soleChannel];
    const kicked = toggleKicked(defaultKickedKeys(places), channel);
    expect(keptPlaces(places, kicked)).toEqual([{ kind: 'channel', id: 'channel-1' }]);
  });

  it('lets the person uncheck and check the place the orglet is alone in', () => {
    const unchecked = toggleKicked(defaultKickedKeys([soleChannel]), soleChannel);
    expect(unchecked.size).toBe(0);
    expect(keptPlaces([soleChannel], unchecked)).toEqual([{ kind: 'channel', id: 'channel-2' }]);
    expect(toggleKicked(unchecked, soleChannel).has(placeKey(soleChannel))).toBe(true);
  });

  it('says the orglet is removed only when nothing is kept', () => {
    expect(unfriendOutcomeLine([space, channel], defaultKickedKeys([space, channel]))).toEqual({ kind: 'removed' });
    expect(unfriendOutcomeLine([space, soleChannel], defaultKickedKeys([space, soleChannel]))).toEqual({ kind: 'removed' });
    expect(unfriendOutcomeLine([space, channel], new Set())).toEqual({ kind: 'kept', keptCount: 2 });
    expect(unfriendOutcomeLine([space, soleChannel], toggleKicked(defaultKickedKeys([space, soleChannel]), soleChannel))).toEqual({ kind: 'kept', keptCount: 1 });
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
