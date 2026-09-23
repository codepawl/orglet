import type { AppProposal, AppProposalKind, ProposalChange } from '../../shared/app-proposals';
import type { Skill, Worker } from '../../shared/contracts';
import { formatMoney } from './money';
import { providerName } from './workerModel';
import { t } from '../i18n';

/**
 * How the proposal cards turn stored values into what the person reads (COD-212): a skill id into the skill's name,
 * a provider id into its name, and a `ref:` handle into the sibling proposal's title, or into the real worker once
 * that sibling was applied. Pure, so the thread can pass the workspace and the reply's proposals in and the test
 * can check the mapping without rendering.
 */
export type ProposalContext = {
  workers: readonly Worker[];
  skills: readonly Pick<Skill, 'id' | 'name'>[];
  /** Every proposal of the same reply, so a `ref:` value can find the card it points at. */
  siblings: readonly AppProposal[];
};

/** One member of a proposed crew as the card draws it: the live worker when there is one, else the sibling's name. */
export type ResolvedMember = { key: string; name: string; description?: string; worker?: Worker; proposal?: AppProposal; lead: boolean };

const REF_PREFIX = 'ref:';
const moneyFields = new Set(['taskBudgetMicros', 'monthlyBudgetMicros']);
const memberFields = new Set(['memberIds', 'synthesizerId']);
const workflowNames: Record<string, string> = { sequential: 'Tuần tự', parallel: 'Song song' };

export const isProposalRef = (value: string) => value.startsWith(REF_PREFIX);

/** The proposal of the same reply a `ref:` value points at, of the given kinds when they matter. */
export function siblingByRef(value: string, context: ProposalContext, kinds?: readonly AppProposalKind[]): AppProposal | undefined {
  if (!isProposalRef(value)) return undefined;
  const ref = value.slice(REF_PREFIX.length);
  return context.siblings.find(proposal => proposal.ref === ref && (!kinds || kinds.includes(proposal.kind)));
}

/** The worker a proposal created, once it was applied, not undone, and the worker still exists. */
export function workerOfProposal(proposal: AppProposal | undefined, context: ProposalContext): Worker | undefined {
  if (!proposal || proposal.status !== 'applied' || proposal.undoneAt || proposal.target?.kind !== 'worker') return undefined;
  const targetId = proposal.target.id;
  return context.workers.find(worker => worker.id === targetId);
}

/** A member value of a crew card: a `ref:` to an orglet of this reply, a worker id, or the name the core wrote. */
export function resolveMember(value: string, context: ProposalContext): Omit<ResolvedMember, 'lead'> {
  const trimmed = value.trim();
  if (isProposalRef(trimmed)) {
    const proposal = siblingByRef(trimmed, context, ['orglet']);
    const worker = workerOfProposal(proposal, context);
    const description = proposal?.changes.find(change => change.field === 'description')?.after;
    return { key: trimmed, name: worker?.name ?? proposal?.title ?? trimmed.slice(REF_PREFIX.length), description: worker?.description ?? description, worker, proposal };
  }
  const worker = context.workers.find(candidate => candidate.id === trimmed) ?? context.workers.find(candidate => candidate.name === trimmed);
  return { key: worker?.id ?? trimmed, name: worker?.name ?? trimmed, description: worker?.description, worker };
}

/** The members of a crew proposal in order, with the lead marked; the first member leads when none is named. */
export function crewMembers(proposal: AppProposal, context: ProposalContext): ResolvedMember[] {
  const memberList = proposal.changes.find(change => change.field === 'memberIds')?.after ?? '';
  const leadValue = proposal.changes.find(change => change.field === 'synthesizerId')?.after;
  const members = memberList ? memberList.split(', ').map(value => resolveMember(value, context)) : [];
  const lead = leadValue ? resolveMember(leadValue, context) : members[0];
  return members.map(member => ({ ...member, lead: lead !== undefined && member.key === lead.key }));
}

/** A skill value: the workspace skill's name for an id, the sibling's title for a `ref:`, else as written. */
export function skillName(value: string, context: ProposalContext): string {
  const sibling = siblingByRef(value, context, ['skill']);
  if (sibling) return sibling.title;
  return context.skills.find(skill => skill.id === value)?.name ?? value;
}

/** "Anthropic · claude-sonnet-4-5", or just the provider's name when no model is set. */
export function modelLabel(provider: string | undefined, modelId: string | undefined): string {
  if (!provider) return modelId ?? '';
  if (provider === 'demo') return t('không gọi API');
  const name = providerName(provider as Worker['provider']);
  return modelId ? `${name} · ${modelId}` : name;
}

/** The model line of an orglet proposal, from its provider and model fields. */
export function proposalModelLabel(proposal: AppProposal): string {
  const after = (field: string) => proposal.changes.find(change => change.field === field)?.after;
  return modelLabel(after('provider'), after('modelId'));
}

export function workflowName(value: string): string {
  const name = workflowNames[value];
  return name ? t(name) : value;
}

/** A stored value as the person reads it: money in the display currency, flags as words, ids and refs as names. */
export function showChangeValue(field: string, value: string, context: ProposalContext): string {
  if (moneyFields.has(field) && /^\d+$/.test(value)) return formatMoney(Number(value));
  if (value === 'true') return t('Bật');
  if (value === 'false') return t('Tắt');
  if (field === 'provider') return modelLabel(value, undefined);
  if (field === 'skillId') return skillName(value, context);
  if (field === 'workflow') return workflowName(value);
  if (memberFields.has(field)) return value.split(', ').map(part => resolveMember(part, context).name).join(', ');
  // A schedule's target or a template's crew may point at an orglet or a crew of this reply.
  if (field === 'target' || field === 'team') return siblingByRef(value, context)?.title ?? value;
  return value;
}

/**
 * The rows an orglet's detail dialog shows: the name is the title so it goes, provider and model fold into one
 * Model row, and the instructions come back at full length from the payload, where the card line was cut short.
 */
export function orgletDetailChanges(proposal: AppProposal): ProposalChange[] {
  const fields = proposal.payload.fields;
  const fullInstructions = fields && typeof fields === 'object' && typeof (fields as { instructions?: unknown }).instructions === 'string'
    ? (fields as { instructions: string }).instructions : undefined;
  const modelId = proposal.changes.find(change => change.field === 'modelId');
  return proposal.changes.flatMap(change => {
    if (change.field === 'name' && change.before === null) return [];
    if (change.field === 'modelId' && proposal.changes.some(item => item.field === 'provider')) return [];
    if (change.field === 'provider') return [{ ...change, after: modelLabel(change.after, modelId?.after), before: change.before === null ? null : modelLabel(change.before, modelId?.before ?? undefined) }];
    if (change.field === 'instructions' && fullInstructions && change.before === null) return [{ ...change, after: fullInstructions }];
    return [change];
  });
}

/** The card sequence of a reply: the create-orglet proposals share one card where the first of them sits. */
export type ProposalCardItem = { kind: 'orglets'; proposals: AppProposal[] } | { kind: 'single'; proposal: AppProposal };
export function proposalCards(proposals: readonly AppProposal[]): ProposalCardItem[] {
  const isNewOrglet = (proposal: AppProposal) => proposal.kind === 'orglet' && proposal.action === 'create';
  const newOrglets = proposals.filter(isNewOrglet);
  const items: ProposalCardItem[] = [];
  for (const proposal of proposals) {
    if (!isNewOrglet(proposal)) { items.push({ kind: 'single', proposal }); continue; }
    if (proposal === newOrglets[0]) items.push({ kind: 'orglets', proposals: newOrglets });
  }
  return items;
}
