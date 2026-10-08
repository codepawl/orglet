import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { failedMessages, fieldMessage, firstFailedField, isBlank } from '../../apps/desktop/src/renderer/fieldErrors';
import { setLanguage } from '../../apps/desktop/src/renderer/i18n';
import { chatLabel } from '../../apps/desktop/src/renderer/components/SearchDialog';
import { ForwardedTurn } from '../../apps/desktop/src/renderer/components/TaskThread';
import { modelLabel } from '../../apps/desktop/src/renderer/components/proposalValues';
import { deleteBlockedByChannels } from '../../apps/desktop/src/renderer/archiveBlock';
import { chartPointQuote, formatChartValue } from '../../apps/desktop/src/renderer/chartPoint';
import { listingKindName, repeatsListingName } from '../../apps/desktop/src/renderer/components/MarketPublishing';
import { PlanUsageNote } from '../../apps/desktop/src/renderer/components/PlanUsage';
import type { Task } from '../../apps/desktop/src/shared/contracts';

beforeAll(() => setLanguage('en'));

describe('a form says what is missing under the field', () => {
  it('collects the message of each failed check and points at the first failed field', () => {
    const checks = [
      { field: 'name', failed: false, message: 'Name it.' },
      { field: 'brief', failed: true, message: 'Write the brief.' },
      { field: 'budget', failed: true, message: 'Enter a limit.' },
    ];
    expect(failedMessages(checks)).toEqual({ brief: 'Write the brief.', budget: 'Enter a limit.' });
    expect(firstFailedField(checks)).toBe('brief');
    expect(firstFailedField([{ field: 'name', failed: false, message: '' }])).toBeUndefined();
    expect(failedMessages([])).toEqual({});
  });

  it('counts spaces alone as empty', () => {
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });

  it('draws the error with a mark before the text, only under the field it is about', () => {
    const markup = renderToStaticMarkup(createElement('div', null, fieldMessage('name', 'name', 'Give the space a name.')));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('org-field-error');
    expect(markup).toMatch(/<svg[\s\S]*<\/svg><span>Give the space a name\.<\/span>/);
    expect(fieldMessage('members', 'name', 'Give the space a name.')).toBeNull();
    expect(fieldMessage('name', undefined, 'Give the space a name.')).toBeNull();
    expect(fieldMessage('name', 'name', '')).toBeNull();
  });
});

describe('the composer notice about the plan', () => {
  const usage = (tone: 'warning' | 'out') => ({ shown: { tone, harness: { name: 'Claude Code' }, tightest: { usedPercent: 95 }, resetsAt: undefined }, offer: undefined }) as never;

  it('leads with a different mark for running low and for out', () => {
    const low = renderToStaticMarkup(createElement(PlanUsageNote, { usage: usage('warning'), onSwitch: () => undefined }));
    const out = renderToStaticMarkup(createElement(PlanUsageNote, { usage: usage('out'), onSwitch: () => undefined }));
    expect(low).toMatch(/<p><svg[^>]*aria-hidden="true"/);
    expect(out).toMatch(/<p><svg[^>]*aria-hidden="true"/);
    expect(low).toContain('Claude Code has used 95% of its plan');
    expect(low.match(/<svg[\s\S]*?<\/svg>/)![0]).not.toBe(out.match(/<svg[\s\S]*?<\/svg>/)![0]);
  });
});

describe('search results', () => {
  const task = (patch: Partial<Task>): Task => ({ id: 't1', brief: 'Check **this** list', workerId: 'w1', status: 'completed', createdAt: '2026-10-01T00:00:00.000Z', ...patch }) as Task;
  const workspace = { tasks: [], workers: [], teams: [], archivedWorkers: [] };

  it('shows a title as read, without Markdown marks', () => {
    expect(chatLabel(task({}), workspace, []).name).toBe('Check this list');
    expect(chatLabel(task({ title: '## **Plan** for `June`' }), workspace, []).name).toBe('Plan for June');
  });

  it('does not repeat a channel’s name as its own detail', () => {
    const channel = { id: 'c1', name: 'planning', members: [] };
    const team = { id: 'team1', name: 'planning', memberIds: [], synthesizerId: 'w1' };
    const label = chatLabel(task({ teamId: 'team1', channel } as never), { ...workspace, teams: [team] as never }, []);
    expect(label.name).toBe('planning');
    expect(label.detail).toBeUndefined();
    expect(label.channel).toBe(true);
  });
});

describe('a forwarded answer', () => {
  it('shows the sample reply in the language of the app, not as it was stored', () => {
    const stored = 'Mình là Tí demo nên chưa đọc tệp hay gọi model thật. Bấm Kết nối model dưới khung chat để chọn một model thật, rồi mình trò chuyện và làm việc thật nhé.';
    const forwarded = { fromTaskId: 't', messageId: 'm', from: 'Demo', authorKind: 'orglet' as const, author: 'Demo', text: stored, files: [] };
    const markup = renderToStaticMarkup(createElement(ForwardedTurn, { forwarded, elementId: 'forwarded-m' }));
    expect(markup).not.toContain('Mình là Tí demo');
    expect(markup).toContain('I&#x27;m a demo orglet');
  });

  it('keeps what a person typed exactly as typed', () => {
    const forwarded = { fromTaskId: 't', messageId: 'm', from: 'Demo', authorKind: 'person' as const, text: 'Mình là Tí demo', files: [] };
    expect(renderToStaticMarkup(createElement(ForwardedTurn, { forwarded, elementId: 'forwarded-p' }))).toContain('Mình là Tí demo');
  });
});

describe('an app-change proposal', () => {
  it('names the sample model the way the model picker does', () => {
    expect(modelLabel('demo', undefined)).toBe('Demo');
  });
});

describe('deleting an orglet that is in a channel', () => {
  const crew = (id: string, name: string, memberIds: string[]) => ({ id, name, memberIds, synthesizerId: memberIds[0] ?? '' });

  it('says which channel holds it and offers to open that channel', () => {
    const block = deleteBlockedByChannels([crew('team1', 'planning', ['w1', 'w2'])], 'w2', 'Researcher');
    expect(block).toMatchObject({ crewId: 'team1', actionLabel: 'Open #planning' });
    expect(block?.question).toBe('Researcher is in #planning. Remove this orglet from the channel before deleting it.');
  });

  it('counts the channels when there are several', () => {
    const block = deleteBlockedByChannels([crew('a', 'one', ['w1']), crew('b', 'two', ['w1'])], 'w1', 'Researcher');
    expect(block?.question).toContain('2 channels: #one, #two');
    expect(block?.crewId).toBe('a');
  });

  it('lets an orglet that is in no channel be deleted', () => {
    expect(deleteBlockedByChannels([crew('team1', 'planning', ['w1'])], 'w9', 'Other')).toBeUndefined();
    expect(deleteBlockedByChannels([], 'w1', 'Researcher')).toBeUndefined();
  });
});

describe('a chart point in the composer', () => {
  it('groups thousands the way the chart’s tooltip does', () => {
    expect(formatChartValue('38200')).toBe('38,200');
    expect(formatChartValue('1234567.891')).toBe('1,234,567.891');
    expect(formatChartValue('-4500')).toBe('-4,500');
    expect(formatChartValue('999')).toBe('999');
    expect(formatChartValue('12.5')).toBe('12.5');
  });

  it('leaves a value that is not a plain number as it is', () => {
    expect(formatChartValue('2026-10-09')).toBe('2026-10-09');
    expect(formatChartValue('n/a')).toBe('n/a');
  });

  it('quotes the figure the person saw', () => {
    expect(chartPointQuote('Revenue by region', { series: null, x: 'North', value: '38200' })).toBe('About the chart “Revenue by region”: North = 38,200');
  });
});

describe('marketplace listings', () => {
  it('calls one orglet an Orglet, not Orglets', () => {
    expect(listingKindName('orglet')).toBe('Orglet');
    expect(listingKindName('crew')).not.toBe('Orglets');
    expect(listingKindName('space')).toBe('Space');
  });

  it('does not head an orglet’s section with the listing’s own name again', () => {
    expect(repeatsListingName({ kind: 'orglet', name: 'Research friend' }, 'research friend ')).toBe(true);
    expect(repeatsListingName({ kind: 'orglet', name: 'Research friend' }, 'Source finder')).toBe(false);
    expect(repeatsListingName({ kind: 'crew', name: 'Research desk' }, 'Research desk')).toBe(false);
  });
});

