import { z } from 'zod';
import {
  AppProposal, PROPOSED_SETTING_KEYS, ProposeCrew, ProposeCrewTemplate, ProposeOrglet, ProposeSchedule, ProposeSettings, ProposeSkill,
  type AppProposalKind, type ProposalChange, type ProposalHold, type ProposalTarget, type ProposalToolName, type ProposalUndo,
} from '../../shared/app-proposals';
import { ProposeSelfImprovement, type ImprovementSignal } from '../../shared/self-improvement';
import { MAX_CREW_MEMBERS, RoutineInput, SkillInput, TeamInput, WorkerInput, type Routine, type WorkerAvatar, type Run, type Skill, type Task, type Team, type Worker } from '../../shared/contracts';
import { Store, id, now } from '../storage/database';
import { SelfImprovement } from './self-improvement';

/** The one spending cap a worker chat starts with when its worker has none of its own (WorkerDialog's default). */
const DEFAULT_TASK_BUDGET_MICROS = 500_000;
/** The monthly cap a new crew gets when the proposal names none, the same one `createTemplate` gives. */
const DEFAULT_TEAM_MONTHLY_BUDGET_MICROS = 5_000_000;
const CHANGE_VALUE_LIMIT = 160;

export type ProposedSettings = z.infer<typeof ProposeSettings>;
/** A settings value as the app currently holds it; a font nobody picked is `null`, so applying it again clears the pick. */
export type CurrentSettings = Omit<{ [Key in keyof ProposedSettings]: NonNullable<ProposedSettings[Key]> }, 'interfaceFont' | 'codeFont'> & { interfaceFont: string | null; codeFont: string | null };

/**
 * The commands Apply runs. They are the same code paths the dialogs call, owned by CoreService, so a proposal can
 * do nothing the user could not do by hand and gets the same validation.
 */
export type ProposalApplier = {
  saveWorker(input: WorkerInput): Worker;
  saveTeam(input: z.infer<typeof TeamInput>): Team;
  saveSkill(input: z.infer<typeof SkillInput>): Skill;
  saveRoutine(input: z.infer<typeof RoutineInput>): Routine;
  /** Builds a crew's template text, so a template that cannot be exported fails here rather than at the save dialog. */
  templateText(teamId: string): string;
  currentSettings(): CurrentSettings;
  applySettings(patch: Partial<CurrentSettings>): void;
  deleteEntity(kind: 'worker' | 'team', entityId: string): void;
};

/** A proposal the worker got wrong. It goes back to the model as the tool's answer and never fails the run. */
export class ProposalError extends Error {}

type OrgletPayload = { fields: Partial<WorkerInput>; skillRef?: string };
/** A self-improvement is an orglet edit whose only field is the instructions, plus the sentence it swaps in (COD-162). */
type SelfImprovementPayload = OrgletPayload & { targetId: string; sentence: { replaces: string | null; sentence: string } };
type MemberReference = { id: string } | { ref: string };
type CrewPayload = { fields: Partial<Omit<z.infer<typeof TeamInput>, 'memberIds' | 'synthesizerId'>>; members?: MemberReference[]; lead?: MemberReference };
type TemplatePayload = { team: MemberReference };
type SkillPayload = { fields: Partial<z.infer<typeof SkillInput>> };
type SchedulePayload = { fields: { name?: string; schedule?: Routine['schedule']; brief?: string; budgetMicros?: number; target?: { worker: MemberReference } | { team: MemberReference } } };
type SettingsPayload = { patch: Partial<CurrentSettings> };

/** `null` and a missing key both mean the model left the field alone. */
function given<Value>(value: Value | null | undefined): Value | undefined {
  return value === null ? undefined : value;
}

/** One line of a card: text on one line and no longer than a glance, numbers and flags as plain words the renderer maps. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return value.map(describe).join(', ');
  if (typeof value === 'object' && value !== null) return describe(Object.values(value));
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= CHANGE_VALUE_LIMIT) return text;
  return `${text.slice(0, CHANGE_VALUE_LIMIT - 1)}…`;
}

/** The lines of a creation: every field that was given, in the order given. */
function creationChanges(fields: Record<string, unknown>): ProposalChange[] {
  return Object.entries(fields).flatMap(([field, value]) => value === undefined ? [] : [{ field, before: null, after: describe(value) }]);
}

/** The lines of an edit: only the fields whose value would actually change. */
function editChanges(current: Record<string, unknown>, next: Record<string, unknown>): ProposalChange[] {
  return Object.entries(next).flatMap(([field, value]) => {
    if (value === undefined) return [];
    const before = current[field];
    if (JSON.stringify(before) === JSON.stringify(value)) return [];
    return [{ field, before: before === undefined || before === null ? null : describe(before), after: describe(value) }];
  });
}

/** "weekly 09:00 · weekday 1 · Asia/Ho_Chi_Minh": the card line for a schedule, before and after alike. */
function describeSchedule(schedule: Routine['schedule']): string {
  const day = schedule.frequency === 'weekly' ? ` · weekday ${schedule.weekday}` : '';
  return `${schedule.frequency} ${schedule.time}${day} · ${schedule.timeZone}`;
}

const workerFields = (worker: Worker): WorkerInput => WorkerInput.parse(worker);
const teamFields = (team: Team): z.infer<typeof TeamInput> => TeamInput.parse(team);
const skillFields = (skill: Skill): z.infer<typeof SkillInput> => SkillInput.parse({ id: skill.id, name: skill.name, content: skill.content });

/** What the worker is told beside the evidence: one sentence, its own instructions only, and answer the user first. */
const SELF_IMPROVEMENT_INSTRUCTION = 'This is repeated feedback on your earlier work in this app. If one short, concrete sentence added to or changed in your own instructions would prevent it next time, call propose_self_improvement once: name the signal it answers, quote in replaces the one existing sentence to change (exactly as written) or set replaces to null to add the sentence at the end, and put the new sentence in sentence. Do not rewrite your instructions, do not propose anything for another orglet, a skill, a tool, a model or a budget, and skip this when the feedback does not point at your instructions. It is stored as a card the user applies or dismisses; answer the user first as usual.';

export class AppProposals {
  private readonly selfImprovement: SelfImprovement;
  constructor(private store: Store, private applier: ProposalApplier) {
    this.selfImprovement = new SelfImprovement(store);
  }

  /** The repeated feedback this worker has had, for the run to freeze on its snapshot before it starts (COD-162). */
  improvementSignals(run: Run): ImprovementSignal[] {
    return this.selfImprovement.signalsFor(run.snapshot.worker.id, run.id);
  }

  /** What the run's prompt carries when it may propose a self-improvement: the frozen signals and how to answer them. */
  improvementContext(run: Run) {
    return { signals: run.snapshot.improvement ?? [], instruction: SELF_IMPROVEMENT_INSTRUCTION };
  }

  list(taskId: string): AppProposal[] {
    return this.store.db.prepare('SELECT data FROM app_proposals WHERE task_id=? ORDER BY rowid').all(taskId)
      .map(row => AppProposal.parse(JSON.parse(String(row.data))));
  }

  get(proposalId: string): AppProposal {
    const row = this.store.db.prepare('SELECT data FROM app_proposals WHERE id=?').get(proposalId);
    if (!row) throw new Error('Không tìm thấy đề xuất này.');
    return AppProposal.parse(JSON.parse(String(row.data)));
  }

  private forRun(runId: string): AppProposal[] {
    return this.store.db.prepare('SELECT data FROM app_proposals WHERE run_id=? ORDER BY rowid').all(runId)
      .map(row => AppProposal.parse(JSON.parse(String(row.data))));
  }

  private write(proposal: AppProposal) {
    AppProposal.parse(proposal);
    this.store.db.prepare('INSERT INTO app_proposals(id,task_id,run_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(proposal.id, proposal.taskId, proposal.runId, JSON.stringify(proposal));
  }

  /**
   * What the run's prompt carries so the worker can name existing things by id (COD-199): the live workers, crews,
   * skills and schedules, the providers already in use, which chat this is, and the settings it may propose.
   */
  context(run: Run, task: Task) {
    const workspace = this.store.workspace();
    const providers = [...new Set([run.snapshot.worker.provider, ...workspace.workers.map(worker => worker.provider)])].filter(provider => provider !== 'demo');
    return {
      orglets: workspace.workers.slice(0, 50).map(worker => ({ id: worker.id, name: worker.name, description: worker.description ?? '', provider: worker.provider, skillId: worker.skillId })),
      crews: workspace.teams.slice(0, 50).map(team => ({ id: team.id, name: team.name, memberIds: team.memberIds, leadId: team.synthesizerId, workflow: team.workflow })),
      skills: workspace.skills.slice(0, 50).map(skill => ({ id: skill.id, name: skill.name })),
      schedules: workspace.routines.slice(0, 50).map(routine => ({ id: routine.id, name: routine.name, enabled: routine.enabled })),
      providersInUse: providers,
      thisChat: { workerId: run.snapshot.worker.id, ...(task.teamId ? { teamId: task.teamId } : {}) },
      settings: this.applier.currentSettings(),
      instruction: 'When the user asks you to set up or change something in Orglet (an orglet, a crew, a template, a skill, a schedule, or one of the listed settings), call the matching propose_* tool once per change, then answer with reply. Each proposal is stored as a card the user applies or dismisses; nothing changes until they do. Use the ids above for existing things; give a new orglet, crew or skill a short ref and point at it with the *Ref fields when a later proposal in this same reply needs it. Null leaves a field alone; an edit needs targetId. You cannot change API keys, connections, harness accounts, backups, tool permissions, working folders, budgets above the current caps, or the auto-apply switch; say so instead of trying.',
    };
  }

  /** Validates and stores one propose_* call. The answer goes back to the model; a mistake is an error it can correct. */
  record(run: Run, task: Task, name: ProposalToolName, rawArguments: unknown): { proposalId: string; ref?: string; status: 'pending'; note: string } {
    const earlier = this.forRun(run.id);
    const sequence = earlier.length + 1;
    const draft = this.draft(run, task, name, rawArguments, earlier);
    if (draft.ref && earlier.some(proposal => proposal.ref === draft.ref)) throw new ProposalError(`Ref "${draft.ref}" đã được dùng trong lượt này.`);
    const proposal: AppProposal = {
      id: id(), taskId: task.id, runId: run.id, inputRevision: run.snapshot.inputRevision ?? 0, sequence, createdAt: now(),
      kind: draft.kind, action: draft.action, ...(draft.ref ? { ref: draft.ref } : {}),
      title: draft.title, changes: draft.changes, payload: draft.payload, hold: draft.hold, status: 'pending',
      // A self-improvement says from the start that it waits for a click, whatever the worker's switch says.
      ...(draft.improvement ? { heldReason: 'self', improvement: draft.improvement } : {}),
    };
    this.write(proposal);
    return { proposalId: proposal.id, ...(draft.ref ? { ref: draft.ref } : {}), status: 'pending', note: 'Stored for the user to apply or dismiss. It is not applied yet.' };
  }

  private draft(run: Run, task: Task, name: ProposalToolName, rawArguments: unknown, earlier: AppProposal[]): { kind: AppProposalKind; action: AppProposal['action']; ref?: string; title: string; changes: ProposalChange[]; payload: Record<string, unknown>; hold: ProposalHold | null; improvement?: AppProposal['improvement'] } {
    const refOf = (ref: string | null | undefined, kind: AppProposalKind, what: string) => {
      const value = given(ref);
      if (value === undefined) return undefined;
      const found = earlier.find(proposal => proposal.ref === value && proposal.kind === kind);
      if (!found) throw new ProposalError(`Không có ${what} nào được đề xuất với ref "${value}" trong lượt này.`);
      return { ref: value, title: found.title };
    };
    const proposer = run.snapshot.worker;
    const proposerCap = proposer.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS;
    switch (name) {
      case 'propose_orglet': {
        const args = ProposeOrglet.partial().parse(rawArguments);
        const skillRef = refOf(args.skillRef, 'skill', 'skill');
        const skillId = given(args.skillId);
        if (skillId) this.liveSkill(skillId);
        const chosen: Partial<WorkerInput> = {
          name: given(args.name), description: given(args.description), instructions: given(args.instructions),
          provider: given(args.provider), modelId: given(args.modelId), skillId: skillRef ? undefined : skillId, taskBudgetMicros: given(args.taskBudgetMicros),
        };
        const payload: OrgletPayload = { fields: chosen, ...(skillRef ? { skillRef: skillRef.ref } : {}) };
        const targetId = given(args.targetId);
        if (targetId) {
          const current = this.liveWorker(targetId);
          const changes = editChanges(workerFields(current), { ...chosen, ...(skillRef ? { skillId: `ref:${skillRef.ref}` } : {}) });
          if (!changes.length) throw new ProposalError('Đề xuất không thay đổi gì ở Tí này.');
          const raised = chosen.taskBudgetMicros !== undefined && chosen.taskBudgetMicros > (current.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS);
          return { kind: 'orglet', action: 'edit', ref: given(args.ref), title: chosen.name ?? current.name, changes, payload: { ...payload, targetId }, hold: raised ? 'budget' : null };
        }
        if (!chosen.name || !chosen.instructions) throw new ProposalError('Tạo Tí mới cần name và instructions.');
        const fields: Partial<WorkerInput> = {
          ...chosen,
          provider: chosen.provider ?? proposer.provider,
          modelId: chosen.modelId ?? (chosen.provider ? undefined : proposer.modelId),
          skillId: skillRef ? undefined : chosen.skillId ?? proposer.skillId,
          taskBudgetMicros: chosen.taskBudgetMicros ?? proposer.taskBudgetMicros,
        };
        const changes = creationChanges({ ...fields, ...(skillRef ? { skillId: `ref:${skillRef.ref}` } : {}) });
        const raised = chosen.taskBudgetMicros !== undefined && chosen.taskBudgetMicros > proposerCap;
        return { kind: 'orglet', action: 'create', ref: given(args.ref), title: chosen.name, changes, payload: { ...payload, fields }, hold: raised ? 'budget' : null };
      }
      case 'propose_crew': {
        const args = ProposeCrew.partial().parse(rawArguments);
        const memberIds = given(args.memberIds) ?? [];
        const memberRefs = given(args.memberRefs) ?? [];
        const members: MemberReference[] | undefined = memberIds.length || memberRefs.length
          ? [...memberIds.map(memberId => ({ id: memberId })), ...memberRefs.map(ref => ({ ref }))] : undefined;
        const memberNames = members?.map(member => 'id' in member ? this.liveWorker(member.id).name : `ref:${refOf(member.ref, 'orglet', 'Tí')!.ref}`);
        if (members && members.length > MAX_CREW_MEMBERS) throw new ProposalError(`Một hội có tối đa ${MAX_CREW_MEMBERS} Tí.`);
        const leadId = given(args.leadId);
        const leadRef = refOf(args.leadRef, 'orglet', 'Tí');
        const lead: MemberReference | undefined = leadId ? { id: leadId } : leadRef ? { ref: leadRef.ref } : undefined;
        const leadName = leadId ? this.liveWorker(leadId).name : leadRef ? `ref:${leadRef.ref}` : undefined;
        const chosen: CrewPayload['fields'] = {
          name: given(args.name), instructions: given(args.instructions), workflow: given(args.workflow),
          monthlyBudgetMicros: given(args.monthlyBudgetMicros), taskBudgetMicros: given(args.taskBudgetMicros),
        };
        const targetId = given(args.targetId);
        if (targetId) {
          const current = this.liveTeam(targetId);
          const currentView = { ...teamFields(current), memberIds: current.memberIds.map(memberId => this.workerName(memberId)), synthesizerId: this.workerName(current.synthesizerId) };
          const changes = editChanges(currentView, { ...chosen, memberIds: memberNames, synthesizerId: leadName });
          if (!changes.length) throw new ProposalError('Đề xuất không thay đổi gì ở hội này.');
          const raised = (chosen.monthlyBudgetMicros !== undefined && chosen.monthlyBudgetMicros > current.monthlyBudgetMicros)
            || (chosen.taskBudgetMicros !== undefined && chosen.taskBudgetMicros > (current.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS));
          const payload: CrewPayload = { fields: chosen, ...(members ? { members } : {}), ...(lead ? { lead } : {}) };
          return { kind: 'crew', action: 'edit', ref: given(args.ref), title: chosen.name ?? current.name, changes, payload: { ...payload, targetId }, hold: raised ? 'budget' : null };
        }
        if (!chosen.name || !chosen.instructions) throw new ProposalError('Tạo hội mới cần name và instructions.');
        if (!members) throw new ProposalError('Tạo hội mới cần ít nhất một thành viên (memberIds hoặc memberRefs).');
        const fields: CrewPayload['fields'] = { ...chosen, workflow: chosen.workflow ?? 'parallel', monthlyBudgetMicros: chosen.monthlyBudgetMicros ?? DEFAULT_TEAM_MONTHLY_BUDGET_MICROS };
        const changes = creationChanges({ ...fields, memberIds: memberNames, synthesizerId: leadName ?? memberNames![0] });
        const raised = (chosen.monthlyBudgetMicros !== undefined && chosen.monthlyBudgetMicros > DEFAULT_TEAM_MONTHLY_BUDGET_MICROS)
          || (chosen.taskBudgetMicros !== undefined && chosen.taskBudgetMicros > proposerCap);
        const payload: CrewPayload = { fields, members, lead: lead ?? members[0] };
        return { kind: 'crew', action: 'create', ref: given(args.ref), title: chosen.name, changes, payload, hold: raised ? 'budget' : null };
      }
      case 'propose_crew_template': {
        const args = ProposeCrewTemplate.partial().parse(rawArguments);
        const teamId = given(args.teamId);
        const teamRef = refOf(args.teamRef, 'crew', 'hội');
        if (!teamId && !teamRef) throw new ProposalError('Cần teamId của hội có sẵn hoặc teamRef của hội vừa đề xuất.');
        const title = teamId ? this.liveTeam(teamId).name : teamRef!.title;
        const payload: TemplatePayload = { team: teamId ? { id: teamId } : { ref: teamRef!.ref } };
        return { kind: 'crew_template', action: 'export', title, changes: [{ field: 'team', before: null, after: title }], payload, hold: 'template' };
      }
      case 'propose_skill': {
        const args = ProposeSkill.partial().parse(rawArguments);
        const chosen: SkillPayload['fields'] = { name: given(args.name), content: given(args.content) };
        const targetId = given(args.targetId);
        if (targetId) {
          const current = this.store.get<Skill>('skills', targetId);
          if (current.package) throw new ProposalError('Gói skill nhập từ thư mục giữ nguyên nội dung; không sửa được bằng đề xuất.');
          const changes = editChanges(skillFields(current), chosen);
          if (!changes.length) throw new ProposalError('Đề xuất không thay đổi gì ở skill này.');
          return { kind: 'skill', action: 'edit', ref: given(args.ref), title: chosen.name ?? current.name, changes, payload: { fields: chosen, targetId }, hold: null };
        }
        if (!chosen.name || !chosen.content) throw new ProposalError('Tạo skill mới cần name và content.');
        return { kind: 'skill', action: 'create', ref: given(args.ref), title: chosen.name, changes: creationChanges(chosen), payload: { fields: chosen }, hold: null };
      }
      case 'propose_schedule': {
        const args = ProposeSchedule.partial().parse(rawArguments);
        const workerId = given(args.workerId);
        const workerRef = refOf(args.workerRef, 'orglet', 'Tí');
        const teamId = given(args.teamId);
        const teamRef = refOf(args.teamRef, 'crew', 'hội');
        if ([workerId, workerRef, teamId, teamRef].filter(Boolean).length > 1) throw new ProposalError('Một lịch chạy cho đúng một Tí hoặc một hội.');
        const target: SchedulePayload['fields']['target'] = workerId ? { worker: { id: workerId } } : workerRef ? { worker: { ref: workerRef.ref } }
          : teamId ? { team: { id: teamId } } : teamRef ? { team: { ref: teamRef.ref } } : undefined;
        const targetName = workerId ? this.liveWorker(workerId).name : workerRef ? `ref:${workerRef.ref}` : teamId ? this.liveTeam(teamId).name : teamRef ? `ref:${teamRef.ref}` : undefined;
        const frequency = given(args.frequency);
        const time = given(args.time);
        const weekday = given(args.weekday);
        const timeZone = given(args.timeZone);
        const targetId = given(args.targetId);
        if (targetId) {
          const current = this.store.get<Routine>('routines', targetId);
          const schedule = frequency || time || weekday !== undefined || timeZone
            ? { ...current.schedule, ...(frequency ? { frequency } : {}), ...(time ? { time } : {}), ...(weekday !== undefined ? { weekday } : {}), ...(timeZone ? { timeZone } : {}) } : undefined;
          const fields: SchedulePayload['fields'] = { name: given(args.name), brief: given(args.brief), schedule, target };
          const currentView = { name: current.name, brief: current.task.brief, schedule: describeSchedule(current.schedule), target: current.task.teamId ? this.teamName(current.task.teamId) : this.workerName(current.task.workerId), enabled: current.enabled ? 'true' : 'false' };
          const changes = editChanges(currentView, { name: fields.name, brief: fields.brief, schedule: schedule ? describeSchedule(schedule) : undefined, target: targetName, enabled: current.enabled ? 'false' : undefined });
          if (!changes.length) throw new ProposalError('Đề xuất không thay đổi gì ở lịch này.');
          return { kind: 'schedule', action: 'edit', title: fields.name ?? current.name, changes, payload: { fields, targetId }, hold: null };
        }
        const name = given(args.name);
        const brief = given(args.brief);
        if (!name || !brief || !frequency || !time) throw new ProposalError('Tạo lịch mới cần name, brief, frequency và time.');
        const schedule: Routine['schedule'] = { frequency, time, weekday: weekday ?? 1, timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
        const chatTarget: SchedulePayload['fields']['target'] = target ?? (task.teamId ? { team: { id: task.teamId } } : { worker: { id: proposer.id } });
        const budgetMicros = 'team' in chatTarget && 'id' in chatTarget.team ? this.liveTeam(chatTarget.team.id).taskBudgetMicros ?? proposerCap : proposerCap;
        const fields: SchedulePayload['fields'] = { name, brief, schedule, target: chatTarget, budgetMicros };
        const changes = creationChanges({ name, brief, schedule: describeSchedule(schedule), target: targetName ?? (task.teamId ? this.teamName(task.teamId) : proposer.name), enabled: 'false' });
        return { kind: 'schedule', action: 'create', title: name, changes, payload: { fields }, hold: null };
      }
      case 'propose_self_improvement': return this.draftSelfImprovement(run, rawArguments);
      case 'propose_settings': {
        const args = ProposeSettings.partial().parse(rawArguments);
        const current = this.applier.currentSettings();
        const patch: Partial<CurrentSettings> = {};
        for (const key of PROPOSED_SETTING_KEYS) {
          const value = given(args[key]);
          if (value !== undefined && value !== current[key]) Object.assign(patch, { [key]: value });
        }
        const changes = editChanges(current, patch);
        if (!changes.length) throw new ProposalError('Đề xuất không thay đổi cài đặt nào.');
        const payload: SettingsPayload = { patch };
        return { kind: 'settings', action: 'edit', title: 'Cài đặt', changes, payload, hold: null };
      }
    }
  }

  /**
   * One sentence for the proposing worker's own instructions (COD-162). The signal must be one the run froze, the
   * sentence to replace must occur exactly once, and the result is an ordinary orglet edit of the instructions field,
   * held for a click. There is no target: the payload's targetId is always the proposing worker.
   */
  private draftSelfImprovement(run: Run, rawArguments: unknown): ReturnType<AppProposals['draft']> {
    const args = ProposeSelfImprovement.parse(rawArguments);
    const signal = (run.snapshot.improvement ?? []).find(candidate => candidate.kind === args.signal);
    if (!signal) throw new ProposalError('Tín hiệu này không có trong phản hồi lặp lại của lượt chạy.');
    const current = this.liveWorker(run.snapshot.worker.id);
    const instructions = this.instructionsWith(current.instructions, args.replaces, args.sentence);
    if (instructions === current.instructions) throw new ProposalError('Đề xuất không thay đổi gì ở hướng dẫn của Tí này.');
    if (instructions.length > 16000) throw new ProposalError('Hướng dẫn sau khi sửa vượt 16.000 ký tự.');
    const payload: SelfImprovementPayload = { targetId: current.id, fields: { instructions }, sentence: { replaces: args.replaces, sentence: args.sentence } };
    const changes: ProposalChange[] = [{ field: 'instructions', before: args.replaces === null ? null : describe(args.replaces), after: describe(args.sentence) }];
    return { kind: 'orglet', action: 'edit', title: current.name, changes, payload, hold: 'self', improvement: { signal: signal.kind, because: signal.because } };
  }

  /** The instructions with one sentence swapped or added; the sentence to replace has to be there exactly once. */
  private instructionsWith(current: string, replaces: string | null, sentence: string): string {
    if (replaces === null) return `${current.trimEnd()}\n${sentence}`;
    const first = current.indexOf(replaces);
    if (first < 0) throw new ProposalError('Câu cần thay không có trong hướng dẫn hiện tại; trích đúng nguyên văn.');
    if (current.indexOf(replaces, first + 1) >= 0) throw new ProposalError('Câu cần thay xuất hiện nhiều lần trong hướng dẫn; trích đoạn dài hơn để chỉ đúng một chỗ.');
    return `${current.slice(0, first)}${sentence}${current.slice(first + replaces.length)}`;
  }

  /**
   * When a run finishes: a run that read unvetted content holds every proposal it made, then the safe ones are
   * applied at once if the worker's auto-apply switch is on. A held one records why it waited for a click.
   */
  finishRun(run: Run, untrustedInputs: readonly string[]) {
    const pending = this.forRun(run.id).filter(proposal => proposal.status === 'pending');
    if (!pending.length) return;
    const worker = this.store.all<Worker>('workers').find(candidate => candidate.id === run.snapshot.worker.id);
    const automatic = worker?.autoApplyProposals === true;
    for (const proposal of pending) {
      // A self-improvement keeps its own reason: it never applies on its own, read or not (COD-162).
      const hold: ProposalHold | null = proposal.hold === 'self' ? 'self' : untrustedInputs.length ? 'untrusted' : proposal.hold;
      const settled: AppProposal = { ...proposal, hold, ...(automatic && hold ? { heldReason: hold } : {}) };
      this.write(settled);
      if (automatic && !hold) this.apply(proposal.id, true);
    }
    // With the switch on but every card held (a self-improvement, say), "applied 0 of 1" would mislead: they wait.
    const appliedCount = automatic ? pending.filter(proposal => this.get(proposal.id).status === 'applied').length : 0;
    this.store.event(run.id, appliedCount
      ? `Đã áp dụng tự động ${appliedCount}/${pending.length} đề xuất thay đổi trong app.`
      : `${pending.length} đề xuất thay đổi trong app đang chờ bạn áp dụng.`);
  }

  /** Runs the proposal through the UI's own command. A failure stays on the card as text and leaves it pending. */
  apply(proposalId: string, automatic = false, avatar?: WorkerAvatar): AppProposal {
    const proposal = this.get(proposalId);
    if (proposal.status !== 'pending') throw new Error('Đề xuất này đã được xử lý.');
    try {
      // Each applier command is its own transaction, the same one the dialog would run; nothing wraps them.
      const applied = this.perform(proposal, avatar);
      // Undo is kept for an automatic apply, and for a self-improvement: it changed how the worker works, so one
      // click takes it back the same way an automatic edit is taken back (COD-162).
      const keepUndo = automatic || !!proposal.improvement;
      const record: AppProposal = { ...proposal, status: 'applied', appliedAt: now(), automatic, target: applied.target, error: undefined, ...(keepUndo && applied.undo ? { undo: applied.undo } : {}) };
      this.write(record);
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không áp dụng được đề xuất.';
      const record: AppProposal = { ...proposal, error: message.slice(0, 2000) };
      this.write(record);
      if (automatic) return record;
      throw error;
    }
  }

  private perform(proposal: AppProposal, avatar?: WorkerAvatar): { target: ProposalTarget; undo?: ProposalUndo } {
    switch (proposal.kind) {
      case 'orglet': {
        const payload = proposal.payload as OrgletPayload & { targetId?: string };
        const skillId = payload.skillRef ? this.resolveRef(proposal.runId, payload.skillRef, 'skill') : payload.fields.skillId;
        if (payload.targetId) {
          const current = this.liveWorker(payload.targetId);
          const previous = workerFields(current);
          const saved = this.applier.saveWorker(WorkerInput.parse({ ...previous, ...compact(payload.fields), ...(skillId ? { skillId } : {}), id: current.id }));
          return { target: { kind: 'worker', id: saved.id }, undo: { kind: 'restore', entity: 'worker', previous } };
        }
        const saved = this.applier.saveWorker(WorkerInput.parse({ ...(avatar ? { avatar } : {}), ...compact(payload.fields), skillId }));
        return { target: { kind: 'worker', id: saved.id }, undo: { kind: 'delete', entity: 'worker', id: saved.id } };
      }
      case 'crew': {
        const payload = proposal.payload as CrewPayload & { targetId?: string };
        const memberIds = payload.members?.map(member => this.resolveMember(proposal.runId, member));
        const synthesizerId = payload.lead ? this.resolveMember(proposal.runId, payload.lead) : undefined;
        if (payload.targetId) {
          const current = this.liveTeam(payload.targetId);
          const previous = teamFields(current);
          const saved = this.applier.saveTeam(TeamInput.parse({ ...previous, ...compact(payload.fields), ...(memberIds ? { memberIds } : {}), ...(synthesizerId ? { synthesizerId } : {}), id: current.id }));
          return { target: { kind: 'team', id: saved.id }, undo: { kind: 'restore', entity: 'team', previous } };
        }
        const saved = this.applier.saveTeam(TeamInput.parse({ ...compact(payload.fields), memberIds, synthesizerId }));
        return { target: { kind: 'team', id: saved.id }, undo: { kind: 'delete', entity: 'team', id: saved.id } };
      }
      case 'crew_template': {
        const payload = proposal.payload as TemplatePayload;
        const teamId = 'id' in payload.team ? payload.team.id : this.resolveRef(proposal.runId, payload.team.ref, 'crew');
        this.liveTeam(teamId);
        this.applier.templateText(teamId);
        return { target: { kind: 'template', id: teamId } };
      }
      case 'skill': {
        const payload = proposal.payload as SkillPayload & { targetId?: string };
        if (payload.targetId) {
          const current = this.store.get<Skill>('skills', payload.targetId);
          const previous = skillFields(current);
          const saved = this.applier.saveSkill(SkillInput.parse({ ...previous, ...compact(payload.fields), id: current.id }));
          return { target: { kind: 'skill', id: saved.id }, undo: { kind: 'restore', entity: 'skill', previous } };
        }
        const saved = this.applier.saveSkill(SkillInput.parse(compact(payload.fields)));
        return { target: { kind: 'skill', id: saved.id } };
      }
      case 'schedule': {
        const payload = proposal.payload as SchedulePayload & { targetId?: string };
        const chat = payload.fields.target ? this.resolveScheduleTarget(proposal.runId, payload.fields.target) : undefined;
        if (payload.targetId) {
          const current = this.store.get<Routine>('routines', payload.targetId);
          const task = { ...current.task, ...(chat ?? {}), ...(payload.fields.brief ? { brief: payload.fields.brief } : {}) };
          if (chat && !chat.teamId) delete (task as { teamId?: string }).teamId;
          // A change to an enabled schedule is saved switched off: enabling it is the user's approval of what will run.
          const saved = this.applier.saveRoutine(RoutineInput.parse({ id: current.id, name: payload.fields.name ?? current.name, enabled: false, schedule: payload.fields.schedule ?? current.schedule, task }));
          return { target: { kind: 'routine', id: saved.id } };
        }
        const saved = this.applier.saveRoutine(RoutineInput.parse({
          name: payload.fields.name, enabled: false, schedule: payload.fields.schedule,
          task: { ...chat, brief: payload.fields.brief, sourceIds: [], consent: false, budgetMicros: payload.fields.budgetMicros ?? DEFAULT_TASK_BUDGET_MICROS },
        }));
        return { target: { kind: 'routine', id: saved.id } };
      }
      case 'settings': {
        const payload = proposal.payload as SettingsPayload;
        const current = this.applier.currentSettings();
        const previous: Partial<CurrentSettings> = {};
        for (const key of Object.keys(payload.patch) as (keyof CurrentSettings)[]) Object.assign(previous, { [key]: current[key] });
        this.applier.applySettings(payload.patch);
        return { target: { kind: 'settings', id: 'settings' }, undo: { kind: 'settings', previous } };
      }
    }
  }

  dismiss(proposalId: string) {
    const proposal = this.get(proposalId);
    if (proposal.status !== 'pending') throw new Error('Đề xuất này đã được xử lý.');
    this.store.transaction(() => {
      this.write({ ...proposal, status: 'dismissed' });
      // Declining a self-improvement declines its reason for good: the worker is not asked again for that signal.
      if (proposal.improvement) this.selfImprovement.decline((proposal.payload as SelfImprovementPayload).targetId, proposal.improvement.signal);
    });
  }

  /** Takes an automatic apply back through the same commands; a created orglet or crew goes only if nothing uses it yet. */
  undo(proposalId: string): AppProposal {
    const proposal = this.get(proposalId);
    if (proposal.status !== 'applied' || !proposal.undo || proposal.undoneAt) throw new Error('Đề xuất này không hoàn tác được.');
    const undo = proposal.undo;
    if (undo.kind === 'delete') this.applier.deleteEntity(undo.entity, undo.id);
    else if (undo.kind === 'settings') this.applier.applySettings(undo.previous as Partial<CurrentSettings>);
    else if (undo.entity === 'worker') this.applier.saveWorker(WorkerInput.parse(undo.previous));
    else if (undo.entity === 'team') this.applier.saveTeam(TeamInput.parse(undo.previous));
    else this.applier.saveSkill(SkillInput.parse(undo.previous));
    const record: AppProposal = { ...proposal, undoneAt: now() };
    this.write(record);
    return record;
  }

  private resolveRef(runId: string, ref: string, kind: AppProposalKind): string {
    const found = this.forRun(runId).find(proposal => proposal.ref === ref && proposal.kind === kind);
    if (!found) throw new Error(`Không có đề xuất nào với ref "${ref}".`);
    if (found.status !== 'applied' || !found.target) throw new Error(`Áp dụng đề xuất "${found.title}" trước.`);
    return found.target.id;
  }

  private resolveMember(runId: string, member: MemberReference): string {
    return 'id' in member ? member.id : this.resolveRef(runId, member.ref, 'orglet');
  }

  private resolveScheduleTarget(runId: string, target: NonNullable<SchedulePayload['fields']['target']>): { workerId: string; teamId?: string } {
    if ('worker' in target) return { workerId: this.resolveMember(runId, target.worker) };
    const teamId = 'id' in target.team ? target.team.id : this.resolveRef(runId, target.team.ref, 'crew');
    return { workerId: this.liveTeam(teamId).synthesizerId, teamId };
  }

  private liveWorker(workerId: string): Worker {
    const worker = this.store.workspace().workers.find(candidate => candidate.id === workerId);
    if (!worker) throw new ProposalError(`Không có Tí nào với id ${workerId} đang hoạt động.`);
    return worker;
  }

  private liveTeam(teamId: string): Team {
    const team = this.store.workspace().teams.find(candidate => candidate.id === teamId);
    if (!team) throw new ProposalError(`Không có hội nào với id ${teamId} đang hoạt động.`);
    return team;
  }

  private liveSkill(skillId: string): Skill {
    const skill = this.store.workspace().skills.find(candidate => candidate.id === skillId);
    if (!skill) throw new ProposalError(`Không có skill nào với id ${skillId}.`);
    return skill;
  }

  private workerName(workerId: string): string {
    return this.store.all<Worker>('workers').find(worker => worker.id === workerId)?.name ?? workerId;
  }

  private teamName(teamId: string): string {
    return this.store.all<Team>('teams').find(team => team.id === teamId)?.name ?? teamId;
  }
}

/** Drops the keys a proposal left alone, so a merge keeps the current values underneath. */
function compact<Value extends Record<string, unknown>>(fields: Value): Partial<Value> {
  const kept: Partial<Value> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) Object.assign(kept, { [key]: value });
  return kept;
}
