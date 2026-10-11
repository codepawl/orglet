import { describe, expect, it } from 'vitest';
import { channelOrgletIdsOf, isGhostMessage } from '../../apps/desktop/src/renderer/channelChat';

/* Messages of an orglet that left a channel fade (owner, 2026-10-12). The rule is derived from the current member list. */

const orglet = (id: string) => ({ kind: 'orglet' as const, id });

describe('ghost messages', () => {
  it('marks a message whose orglet is not in the channel any more', () => {
    expect(isGhostMessage('listener', ['scout', 'writer'])).toBe(true);
    expect(isGhostMessage('scout', ['scout', 'writer'])).toBe(false);
  });

  it('is ordinary again as soon as the orglet is added back', () => {
    const task = { channel: { members: [orglet('scout')] } };
    expect(isGhostMessage('listener', channelOrgletIdsOf(task))).toBe(true);
    const added = { channel: { members: [orglet('scout'), orglet('listener')] } };
    expect(isGhostMessage('listener', channelOrgletIdsOf(added))).toBe(false);
  });

  it('has no ghosts outside a channel: a direct message, a side thread or a schedule run', () => {
    expect(channelOrgletIdsOf({})).toBeUndefined();
    expect(channelOrgletIdsOf({ channel: { members: [orglet('scout')] }, sideOf: 'main' })).toBeUndefined();
    expect(isGhostMessage('scout', channelOrgletIdsOf({}))).toBe(false);
  });

  it('leaves messages without an orglet author alone, and fades everything in a channel with nobody left', () => {
    expect(isGhostMessage(undefined, ['scout'])).toBe(false);
    expect(isGhostMessage('scout', channelOrgletIdsOf({ channel: { members: [] } }))).toBe(true);
  });

  it('keeps an orglet that is still listed, whatever became of it', () => {
    // Deleted or archived orglets stay in the member list, so the rule does not touch them.
    expect(isGhostMessage('archived', ['archived', 'scout'])).toBe(false);
  });
});
