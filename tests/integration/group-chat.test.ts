import { describe, expect, it } from 'vitest';
import { groupChatFromRecipient, groupChatFromSelection, groupChatKey, groupChatNames, groupChatRecipient, groupChatTaskInput, isGroupChatTask, pruneGroupChat } from '../../apps/desktop/src/renderer/groupChat';
import { newChatKey, newChatKeyNames } from '../../apps/desktop/src/shared/live-task';
import { noSelection } from '../../apps/desktop/src/renderer/sidebarSelection';

/* COD-215: a group chat started from orglets picked in the sidebar. Nothing exists until the first message. */

describe('groupChatFromSelection', () => {
  it('needs two or more orglets, in the order they sit in the list', () => {
    expect(groupChatFromSelection({ section: 'workers', ids: ['b', 'a'], anchor: 'a' })).toEqual({ workerIds: ['b', 'a'] });
    expect(groupChatFromSelection({ section: 'workers', ids: ['a'], anchor: 'a' })).toBeUndefined();
    expect(groupChatFromSelection(noSelection)).toBeUndefined();
  });

  it('never makes a group out of crews', () => {
    expect(groupChatFromSelection({ section: 'teams', ids: ['t1', 't2'], anchor: 't2' })).toBeUndefined();
  });
});

describe('pruneGroupChat', () => {
  it('returns the same group while every orglet is still listed', () => {
    const group = { workerIds: ['a', 'b', 'c'] };
    expect(pruneGroupChat(group, ['c', 'b', 'a', 'd'])).toBe(group);
  });

  it('drops orglets that left and the group once fewer than two remain', () => {
    expect(pruneGroupChat({ workerIds: ['a', 'b', 'c'] }, ['a', 'c'])).toEqual({ workerIds: ['a', 'c'] });
    expect(pruneGroupChat({ workerIds: ['a', 'b'] }, ['a'])).toBeUndefined();
  });
});

describe('groupChatKey', () => {
  it('is the same for the same orglets in any order, and is where their permissions and folder wait', () => {
    expect(groupChatKey({ workerIds: ['b', 'a'] })).toBe(groupChatKey({ workerIds: ['a', 'b'] }));
    expect(groupChatKey({ workerIds: ['b', 'a'] })).toBe(newChatKey({ workerIds: ['a', 'b'] }));
    expect(groupChatKey({ workerIds: ['b', 'a'] })).toBe('group:a,b');
  });

  it('differs from a worker or team key, and a team stays keyed by the team', () => {
    expect(newChatKey({ workerId: 'a' })).toBe('worker:a');
    expect(newChatKey({ teamId: 't', workerId: 'a' })).toBe('team:t');
    expect(newChatKey({ workerIds: ['a', 'b'] })).not.toBe(newChatKey({ workerId: 'a' }));
  });

  it('names the orglets in a group key, so a deleted orglet takes its groups with it', () => {
    expect(newChatKeyNames('group:a,b', 'a')).toBe(true);
    expect(newChatKeyNames('group:a,b', 'c')).toBe(false);
    expect(newChatKeyNames('worker:a', 'a')).toBe(false);
    expect(newChatKeyNames('team:a', 'a')).toBe(false);
  });
});

describe('groupChatTaskInput', () => {
  it('makes every orglet an assignee and the first one picked the owner of the row', () => {
    const input = groupChatTaskInput({ workerIds: ['b', 'a'] }, { brief: 'Hello', sourceIds: [], consent: true, budgetMicros: 500_000 });
    expect(input).toEqual({ brief: 'Hello', sourceIds: [], consent: true, budgetMicros: 500_000, workerId: 'b', assignees: ['b', 'a'] });
  });
});

describe('isGroupChatTask', () => {
  it('matches a row these same orglets answer, whatever order they were picked in', () => {
    const group = { workerIds: ['b', 'a'] };
    expect(isGroupChatTask({ assignees: ['a', 'b'] }, group)).toBe(true);
    expect(isGroupChatTask({ assignees: ['a', 'b', 'c'] }, group)).toBe(false);
    expect(isGroupChatTask({ assignees: 'all' }, group)).toBe(false);
    expect(isGroupChatTask({ teamId: 't', assignees: ['a', 'b'] }, group)).toBe(false);
    expect(isGroupChatTask({}, group)).toBe(false);
  });
});

describe('group recipient', () => {
  it('round-trips through the navigation recipient keeping the order picked', () => {
    const group = { workerIds: ['b', 'a', 'c'] };
    expect(groupChatRecipient(group)).toBe('group:b,a,c');
    expect(groupChatFromRecipient(groupChatRecipient(group))).toEqual(group);
  });

  it('is undefined for a worker or team recipient, or a group that lost its members', () => {
    expect(groupChatFromRecipient('a')).toBeUndefined();
    expect(groupChatFromRecipient('team:t')).toBeUndefined();
    expect(groupChatFromRecipient('group:a')).toBeUndefined();
    expect(groupChatFromRecipient('')).toBeUndefined();
  });
});

describe('groupChatNames', () => {
  it('lists a few names and leaves more than that to a count', () => {
    expect(groupChatNames(['Researcher', 'Writer'])).toBe('Researcher, Writer');
    expect(groupChatNames(['A', 'B', 'C'])).toBe('A, B, C');
    expect(groupChatNames(['A', 'B', 'C', 'D'])).toBeUndefined();
  });
});
