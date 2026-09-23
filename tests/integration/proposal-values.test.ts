import { describe, expect, it } from 'vitest';
import { crewMembers, modelLabel, orgletDetailChanges, proposalCards, showChangeValue, type ProposalContext } from '../../apps/desktop/src/renderer/components/proposalValues';
import type { AppProposal } from '../../apps/desktop/src/shared/app-proposals';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

/** How the proposal cards name what a stored value points at (COD-212): refs to the same reply, ids to the workspace. */
const base = { taskId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222', inputRevision: 0, createdAt: '2026-09-23T09:00:00.000Z', payload: {}, hold: null } as const;
const proposal = (overrides: Partial<AppProposal> & Pick<AppProposal, 'id' | 'sequence' | 'kind' | 'action' | 'title' | 'changes' | 'status'>): AppProposal => ({ ...base, ...overrides });
const worker = (overrides: Partial<Worker> & Pick<Worker, 'id' | 'name'>): Worker => ({ revision: 1, instructions: 'Work.', provider: 'anthropic', skillId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...overrides });

const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const researcher = worker({ id: '44444444-4444-4444-8444-444444444441', name: 'Researcher', description: 'Reads papers' });
const finderPending = proposal({ id: '33333333-3333-4333-8333-333333333331', sequence: 1, kind: 'orglet', action: 'create', ref: 'finder', title: 'Source Finder', status: 'pending',
  changes: [{ field: 'name', before: null, after: 'Source Finder' }, { field: 'description', before: null, after: 'Finds sources' }, { field: 'instructions', before: null, after: 'Find sources…' }, { field: 'provider', before: null, after: 'claude-code' }, { field: 'skillId', before: null, after: skillId }],
  payload: { fields: { instructions: 'Find sources for every claim, newest first.' } } });
const checkerPending = proposal({ id: '33333333-3333-4333-8333-333333333332', sequence: 2, kind: 'orglet', action: 'create', ref: 'checker', title: 'Fact Checker', status: 'pending',
  changes: [{ field: 'name', before: null, after: 'Fact Checker' }, { field: 'instructions', before: null, after: 'Check facts.' }, { field: 'provider', before: null, after: 'anthropic' }, { field: 'modelId', before: null, after: 'claude-sonnet-4-5' }] });
const crew = proposal({ id: '33333333-3333-4333-8333-333333333333', sequence: 3, kind: 'crew', action: 'create', ref: 'desk', title: 'Fact Desk', status: 'pending',
  changes: [{ field: 'name', before: null, after: 'Fact Desk' }, { field: 'memberIds', before: null, after: 'Researcher, ref:finder, ref:checker' }, { field: 'synthesizerId', before: null, after: 'ref:checker' }, { field: 'workflow', before: null, after: 'sequential' }] });

const contextOf = (siblings: AppProposal[], workers: Worker[] = [researcher]): ProposalContext => ({ workers, skills: [{ id: skillId, name: 'Research skill' }], siblings });

describe('proposal values', () => {
  it('names a same-reply ref by its proposal before apply and by the real worker after', () => {
    const before = contextOf([finderPending, checkerPending, crew]);
    expect(showChangeValue('memberIds', crew.changes[1].after, before)).toBe('Researcher, Source Finder, Fact Checker');
    expect(showChangeValue('synthesizerId', 'ref:checker', before)).toBe('Fact Checker');

    const created = worker({ id: '44444444-4444-4444-8444-444444444442', name: 'Source Finder (renamed)', description: 'Finds sources' });
    const finderApplied: AppProposal = { ...finderPending, status: 'applied', appliedAt: '2026-09-23T09:02:00.000Z', target: { kind: 'worker', id: created.id } };
    const after = contextOf([finderApplied, checkerPending, crew], [researcher, created]);
    expect(showChangeValue('memberIds', crew.changes[1].after, after)).toBe('Researcher, Source Finder (renamed), Fact Checker');
    // An undone apply points at nothing any more, so the proposal's own name comes back.
    const undone = contextOf([{ ...finderApplied, undoneAt: '2026-09-23T09:03:00.000Z' }, checkerPending, crew], [researcher]);
    expect(showChangeValue('memberIds', crew.changes[1].after, undone)).toBe('Researcher, Source Finder, Fact Checker');
  });

  it('shows a skill by name, a provider by name, and money as money', () => {
    const context = contextOf([finderPending]);
    expect(showChangeValue('skillId', skillId, context)).toBe('Research skill');
    expect(showChangeValue('skillId', 'ref:review', { ...context, siblings: [proposal({ id: '33333333-3333-4333-8333-333333333339', sequence: 1, kind: 'skill', action: 'create', ref: 'review', title: 'Code review', status: 'pending', changes: [] })] })).toBe('Code review');
    expect(showChangeValue('provider', 'claude-code', context)).toBe('Claude Code');
    expect(showChangeValue('provider', 'anthropic', context)).toBe('Anthropic');
    expect(showChangeValue('workflow', 'sequential', context)).toBe('Sequential');
    expect(showChangeValue('taskBudgetMicros', '400000', context)).toBe('$0.40');
    expect(showChangeValue('autoTitles', 'true', context)).toBe('On');
    expect(modelLabel('anthropic', 'claude-sonnet-4-5')).toBe('Anthropic · claude-sonnet-4-5');
    expect(modelLabel('claude-code', undefined)).toBe('Claude Code');
  });

  it('lists a crew’s members in order with the lead marked, faces from the workspace where they exist', () => {
    const members = crewMembers(crew, contextOf([finderPending, checkerPending, crew]));
    expect(members.map(member => [member.name, member.lead, member.worker?.id ?? null])).toEqual([
      ['Researcher', false, researcher.id], ['Source Finder', false, null], ['Fact Checker', true, null],
    ]);
    expect(members[1].description).toBe('Finds sources');
    // No lead named: the first member leads, as the core saves it.
    const noLead = { ...crew, changes: crew.changes.filter(change => change.field !== 'synthesizerId') };
    expect(crewMembers(noLead, contextOf([finderPending, checkerPending, noLead])).map(member => member.lead)).toEqual([true, false, false]);
  });

  it('folds provider and model into one row, drops the name and restores the full instructions for the dialog', () => {
    const rows = orgletDetailChanges(checkerPending);
    expect(rows.map(row => row.field)).toEqual(['instructions', 'provider']);
    expect(rows[1].after).toBe('Anthropic · claude-sonnet-4-5');
    expect(orgletDetailChanges(finderPending).find(row => row.field === 'instructions')?.after).toBe('Find sources for every claim, newest first.');
  });

  it('groups the new orglets of a reply into one card where the first of them sits', () => {
    const skill = proposal({ id: '33333333-3333-4333-8333-333333333330', sequence: 0, kind: 'skill', action: 'create', title: 'Research skill', status: 'pending', changes: [] });
    const cards = proposalCards([skill, finderPending, checkerPending, crew]);
    expect(cards.map(card => card.kind)).toEqual(['single', 'orglets', 'single']);
    expect(cards[1].kind === 'orglets' && cards[1].proposals.map(item => item.title)).toEqual(['Source Finder', 'Fact Checker']);
  });
});
