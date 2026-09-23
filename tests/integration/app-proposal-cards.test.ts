import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AppProposalCards, type ProposalActions } from '../../apps/desktop/src/renderer/components/AppProposals';
import type { AppProposal } from '../../apps/desktop/src/shared/app-proposals';

const noop = () => {};
const actions: ProposalActions = { busy: false, onApply: noop, onApplyAll: noop, onDismiss: noop, onUndo: noop, onOpen: noop };
const base = { taskId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222', inputRevision: 0, createdAt: '2026-09-23T09:00:00.000Z', payload: {} };
const proposal = (overrides: Partial<AppProposal> & Pick<AppProposal, 'id' | 'sequence' | 'kind' | 'action' | 'title' | 'changes' | 'status' | 'hold'>): AppProposal => ({ ...base, ...overrides });

/** The cards a chat shows for a worker's proposed app changes (COD-199): what a creation sets, before → after for an edit, and the outcome. */
export const sampleProposals: AppProposal[] = [
  proposal({ id: '33333333-3333-4333-8333-333333333331', sequence: 1, kind: 'orglet', action: 'create', ref: 'scout', title: 'Research Scout', status: 'pending', hold: null,
    changes: [{ field: 'name', before: null, after: 'Research Scout' }, { field: 'instructions', before: null, after: 'Search recent papers on the topic, read the abstracts and summarise what changed.' }, { field: 'provider', before: null, after: 'anthropic' }, { field: 'taskBudgetMicros', before: null, after: '400000' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333332', sequence: 2, kind: 'crew', action: 'create', title: 'Research crew', status: 'pending', hold: 'budget', heldReason: 'budget',
    changes: [{ field: 'name', before: null, after: 'Research crew' }, { field: 'memberIds', before: null, after: 'Researcher, ref:scout' }, { field: 'synthesizerId', before: null, after: 'Researcher' }, { field: 'monthlyBudgetMicros', before: null, after: '9000000' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333333', sequence: 3, kind: 'settings', action: 'edit', title: 'Cài đặt', status: 'applied', hold: null, automatic: true, appliedAt: '2026-09-23T09:01:00.000Z', target: { kind: 'settings', id: 'settings' }, undo: { kind: 'settings', previous: { theme: 'system' } },
    changes: [{ field: 'theme', before: 'system', after: 'dark' }, { field: 'interfaceFont', before: null, after: 'SF Pro Text' }] }),
  proposal({ id: '33333333-3333-4333-8333-333333333334', sequence: 4, kind: 'skill', action: 'edit', title: 'General help', status: 'pending', hold: null, error: 'Gói skill giữ nguyên nội dung đã nhập. Sửa thư mục gốc rồi nhập lại để tạo gói mới.',
    changes: [{ field: 'content', before: 'Help with whatever the user asks.', after: 'Help with whatever the user asks. Review code when asked.' }] }),
];

it('renders a creation as its fields, an edit as before → after, and the outcome with its buttons', () => {
  const html = renderToStaticMarkup(createElement(AppProposalCards, { proposals: sampleProposals, actions }));
  expect(html).toContain('New orglet · Research Scout');
  expect(html).toContain('New crew · Research crew');
  expect(html).toContain('Waiting for your click: this raises a spending limit.');
  expect(html).toContain('Applied automatically');
  expect(html).toContain('Undo');
  expect(html).toContain('Open settings');
  expect(html).toContain('A skill package keeps the content it was imported with.');
  expect(html).toContain('Apply all (3)');
  // Money reads as money, a flag as a word, and a same-reply reference says so.
  expect(html).toContain('$0.40');
  expect(html).toContain('scout (new, from this reply)');
  expect(html).not.toContain('400000');
  expect(html).toMatch(/app-proposal-before[^>]*>system</);
  expect(renderToStaticMarkup(createElement(AppProposalCards, { proposals: [], actions }))).toBe('');
});
