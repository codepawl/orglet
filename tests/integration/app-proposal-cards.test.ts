import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AppProposalCards, type ProposalActions } from '../../apps/desktop/src/renderer/components/AppProposals';
import type { AppProposal } from '../../apps/desktop/src/shared/app-proposals';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

const noop = () => {};
const actions: ProposalActions = { busy: false, onApply: noop, onApplyAll: noop, onDismiss: noop, onDismissAll: noop, onUndo: noop, onOpen: noop };
const base = { taskId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222', inputRevision: 0, createdAt: '2026-09-23T09:00:00.000Z', payload: {} };
const proposal = (overrides: Partial<AppProposal> & Pick<AppProposal, 'id' | 'sequence' | 'kind' | 'action' | 'title' | 'changes' | 'status' | 'hold'>): AppProposal => ({ ...base, ...overrides });
const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workers: Worker[] = [{ id: '44444444-4444-4444-8444-444444444441', revision: 1, name: 'Researcher', description: 'Reads papers', instructions: 'Work.', provider: 'anthropic', skillId }];
const skills = [{ id: skillId, name: 'Research skill' }];
const render = (proposals: AppProposal[]) => renderToStaticMarkup(createElement(AppProposalCards, { proposals, workers, skills, actions }));

/** The cards a chat shows for a worker's proposed app changes (COD-199, COD-212): the new orglets on one card, a crew as its people, the rest as a diff. */
export const sampleProposals: AppProposal[] = [
  proposal({ id: '33333333-3333-4333-8333-333333333331', sequence: 1, kind: 'orglet', action: 'create', ref: 'scout', title: 'Research Scout', status: 'pending', hold: null,
    changes: [{ field: 'name', before: null, after: 'Research Scout' }, { field: 'description', before: null, after: 'Finds recent papers' }, { field: 'instructions', before: null, after: 'Search recent papers on the topic, read the abstracts and summarise what changed.' }, { field: 'provider', before: null, after: 'claude-code' }, { field: 'skillId', before: null, after: skillId }, { field: 'taskBudgetMicros', before: null, after: '400000' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333335', sequence: 2, kind: 'orglet', action: 'create', ref: 'writer', title: 'Summary Writer', status: 'applied', hold: null, appliedAt: '2026-09-23T09:01:00.000Z', target: { kind: 'worker', id: '44444444-4444-4444-8444-444444444449' },
    changes: [{ field: 'name', before: null, after: 'Summary Writer' }, { field: 'instructions', before: null, after: 'Write the summary.' }, { field: 'provider', before: null, after: 'anthropic' }, { field: 'modelId', before: null, after: 'claude-sonnet-4-5' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333332', sequence: 3, kind: 'crew', action: 'create', title: 'Research crew', status: 'pending', hold: 'budget', heldReason: 'budget',
    changes: [{ field: 'name', before: null, after: 'Research crew' }, { field: 'memberIds', before: null, after: 'Researcher, ref:scout, ref:writer' }, { field: 'synthesizerId', before: null, after: 'ref:scout' }, { field: 'workflow', before: null, after: 'sequential' }, { field: 'monthlyBudgetMicros', before: null, after: '9000000' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333333', sequence: 4, kind: 'settings', action: 'edit', title: 'Cài đặt', status: 'applied', hold: null, automatic: true, appliedAt: '2026-09-23T09:01:00.000Z', target: { kind: 'settings', id: 'settings' }, undo: { kind: 'settings', previous: { theme: 'system' } },
    changes: [{ field: 'theme', before: 'system', after: 'dark' }, { field: 'interfaceFont', before: null, after: 'SF Pro Text' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333334', sequence: 5, kind: 'skill', action: 'edit', title: 'General help', status: 'pending', hold: null, error: 'Gói skill giữ nguyên nội dung đã nhập. Sửa thư mục gốc rồi nhập lại để tạo gói mới.',
    changes: [{ field: 'content', before: 'Help with whatever the user asks.', after: 'Help with whatever the user asks. Review code when asked.' }] }),
];

it('puts the new orglets on one card of rows, draws a crew as its people, and keeps the diff for the rest', () => {
  const html = render(sampleProposals);
  // One card for both new orglets: a row each with its face, one line and model chip, and the row's own state.
  expect(html.match(/app-proposal-orglets/g)).toHaveLength(1);
  expect(html).toContain('2 new orglets');
  expect(html).toContain('Research Scout');
  expect(html).toContain('Finds recent papers');
  expect(html).toContain('Claude Code');
  expect(html).toContain('Anthropic · claude-sonnet-4-5');
  expect(html).toMatch(/proposal-orglet-state success[^>]*>Applied</);
  expect(html).toContain('aria-label="Apply Research Scout"');
  expect(html).toContain('aria-label="Dismiss Research Scout"');
  expect(html).toContain('New crew · Research crew');
  // The crew is its members' faces and names with the lead marked, not a field list.
  expect(html).toContain('proposal-crew-member');
  expect(html).toContain('Sequential');
  expect(html).toContain('$9.00/month');
  expect(html).not.toContain('Orgletrator</dt>');
  expect(html).not.toContain('ref:scout');
  expect(html).not.toContain('(new, from this reply)');
  expect(html).toContain('Waiting for your click: this raises a spending limit.');
  expect(html).toContain('Applied automatically');
  expect(html).toContain('Undo');
  expect(html).toContain('Open settings');
  expect(html).toContain('A skill package keeps the content it was imported with.');
  // Three pending across the turn, so the turn's Apply all stays.
  expect(html).toContain('Apply all (3)');
  expect(html).not.toContain('400000');
  expect(html).toMatch(/app-proposal-before[^>]*>system</);
  expect(render([])).toBe('');
});

it('lets the orglet card apply or dismiss its own rows at once, without a second Apply all for the same rows', () => {
  const twoPending = sampleProposals.filter(item => item.kind === 'orglet').map(item => ({ ...item, status: 'pending' as const, target: undefined, appliedAt: undefined }));
  const html = render(twoPending);
  expect(html).toContain('Apply 2 orglets');
  expect(html).toContain('Dismiss 2 orglets');
  expect(html).not.toContain('Apply all (2)');
  // Values on the edit cards resolve too: a skill id reads as the skill's name.
  const edit = render([proposal({ id: '33333333-3333-4333-8333-333333333336', sequence: 1, kind: 'orglet', action: 'edit', title: 'Researcher', status: 'pending', hold: null, changes: [{ field: 'skillId', before: skillId, after: 'ref:review' }] }),
    proposal({ id: '33333333-3333-4333-8333-333333333337', sequence: 2, kind: 'skill', action: 'create', ref: 'review', title: 'Code review', status: 'pending', hold: null, changes: [{ field: 'name', before: null, after: 'Code review' }, { field: 'content', before: null, after: 'Review diffs.' }] })]);
  expect(edit).toContain('Research skill');
  expect(edit).toContain('>Code review<');
  expect(edit).not.toContain(skillId);
  // A creation's name row repeats the title, so it goes.
  expect(edit).not.toContain('Name</dt>');
});
