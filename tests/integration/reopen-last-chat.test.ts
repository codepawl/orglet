import { expect, it } from 'vitest';
import { chatToReopen } from '../../apps/desktop/src/renderer/lastChat';

/*
 * COD-287, dogfood round 5: after a restart Orglet opened the first orglet, not the chat the person was in.
 */

it('reopens the chat that was open when Orglet closed, unless it was archived or deleted since', () => {
  const tasks = [{ id: 'open' }, { id: 'archived', archivedAt: '2026-09-27T09:00:00.000Z' }, { id: 'deleted', deletedAt: '2026-09-27T09:00:00.000Z' }];
  expect(chatToReopen(tasks, 'open')?.id).toBe('open');
  expect(chatToReopen(tasks, 'archived')).toBeUndefined();
  expect(chatToReopen(tasks, 'deleted')).toBeUndefined();
  expect(chatToReopen(tasks, 'gone')).toBeUndefined();
  expect(chatToReopen(tasks, undefined)).toBeUndefined();
});
