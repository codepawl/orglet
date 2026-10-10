import { describe, expect, it } from 'vitest';
import { initialScheduleAsker } from '../../apps/desktop/src/renderer/scheduleAsker';
import { showChangeValue, triggerInWords } from '../../apps/desktop/src/renderer/components/proposalValues';

describe('the orglet the Schedules box asks', () => {
  const workerIds = ['first', 'second', 'third'];

  it('starts on the first orglet in the person\'s list', () => {
    expect(initialScheduleAsker(workerIds, undefined)).toBe('first');
  });

  it('keeps the orglet picked last time while it still exists', () => {
    expect(initialScheduleAsker(workerIds, 'third')).toBe('third');
  });

  it('goes back to the first orglet when the remembered one is gone, and to nobody when there are none', () => {
    expect(initialScheduleAsker(workerIds, 'archived')).toBe('first');
    expect(initialScheduleAsker([], 'third')).toBeUndefined();
  });
});

describe('a schedule card\'s new lines', () => {
  const context = { workers: [], skills: [], siblings: [] } as unknown as Parameters<typeof showChangeValue>[2];

  it('says what starts the schedule in words', () => {
    expect(triggerInWords('schedule')).toBe('On a schedule');
    expect(triggerInWords('folder:Invoices')).toBe('When a file arrives in Invoices');
    expect(triggerInWords('something else')).toBe('something else');
  });

  it('shows the daily cap as money and the trigger through the card\'s value mapper', () => {
    expect(showChangeValue('trigger', 'folder:Invoices', context)).toBe('When a file arrives in Invoices');
    expect(showChangeValue('dailyCapMicros', '2000000', context)).toMatch(/2/);
  });
});
