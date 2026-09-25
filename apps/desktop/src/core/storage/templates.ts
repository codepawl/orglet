import { z } from 'zod';
import { MAX_CREW_MEMBERS, WorkerInput, SkillInput, TeamInput, type Worker, type Skill, type Team } from '../../shared/contracts';
import { Store, id } from './database';
import { SkillPackage } from '../../shared/skill-package';
import { packageForImport } from '../skill-package';
import { isMemory, KnowledgeInput, type Knowledge } from '../../shared/knowledge';
import { KnowledgeBase } from '../context/knowledge';

const Key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const Template = z.object({
  format: z.literal('orglet-team-template'), version: z.literal(1),
  team: TeamInput.omit({ id: true, memberIds: true, synthesizerId: true }).extend({ memberKeys: z.array(Key).min(1).max(MAX_CREW_MEMBERS), synthesizerKey: Key }).strict(),
  // A template never carries the auto-apply switch or the MCP servers: both are this computer's, not the crew's (COD-199, COD-241).
  workers: z.array(WorkerInput.omit({ id: true, skillId: true, autoApplyProposals: true, mcpServerIds: true }).extend({ key: Key, skillKey: Key }).strict()).min(1).max(5),
  skills: z.array(SkillInput.omit({ id: true }).extend({ key: Key, package: SkillPackage.optional() }).strict()).min(1).max(5),
  knowledge: z.array(KnowledgeInput.pick({ title: true, content: true, tags: true, pinned: true }).strict()).max(50).optional(),
}).strict();

export class TeamTemplates {
  constructor(private store: Store, private notify: () => void) {}
  export(teamId: string) {
    const team = this.store.get<Team>('teams', teamId);
    const workers = [...new Set([...team.memberIds, team.synthesizerId])].map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    const workerKeys = new Map(workers.map((worker, index) => [worker.id, `worker-${index + 1}`]));
    const skillKeys = new Map(skills.map((skill, index) => [skill.id, `skill-${index + 1}`]));
    // Only this team's approved notes travel with it; workspace and worker knowledge stay local, and so does memory:
    // a template is a team to share, and what a team remembered is about this person (COD-161).
    const knowledge = this.store.all<Knowledge>('knowledge').filter(item => item.status === 'approved' && !isMemory(item) && item.scope.type === 'team' && item.scope.id === team.id).map(({ title, content, tags, pinned }) => ({ title, content, tags, pinned }));
    const text = JSON.stringify(Template.parse({
      format: 'orglet-team-template', version: 1,
      team: { name: team.name, instructions: team.instructions, workflow: team.workflow, monthlyBudgetMicros: team.monthlyBudgetMicros, ...(team.reviewPolicy ? { reviewPolicy: team.reviewPolicy } : {}), ...(team.preflight ? { preflight: team.preflight } : {}), ...(team.workHours ? { workHours: team.workHours } : {}), ...(team.maxConcurrentTasks ? { maxConcurrentTasks: team.maxConcurrentTasks } : {}), memberKeys: team.memberIds.map(workerId => workerKeys.get(workerId)), synthesizerKey: workerKeys.get(team.synthesizerId) },
      workers: workers.map(worker => ({ key: workerKeys.get(worker.id), name: worker.name, instructions: worker.instructions, provider: worker.provider, skillKey: skillKeys.get(worker.skillId), ...(worker.modelId ? { modelId: worker.modelId } : {}), ...(worker.avatar ? { avatar: worker.avatar } : {}), ...(worker.description ? { description: worker.description } : {}) })),
      skills: skills.map(skill => ({ key: skillKeys.get(skill.id), name: skill.name, content: skill.content, ...(skill.package ? { package: skill.package } : {}) })),
      ...(knowledge.length ? { knowledge } : {}),
    }), null, 2);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Template kèm gói skill vượt giới hạn 2 MB. Xuất từng gói skill riêng trong Thư viện.');
    return text;
  }
  import(text: string): Team {
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Template vượt giới hạn 2 MB.');
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new Error('Tệp template không phải JSON hợp lệ.'); }
    const template = Template.parse(input);
    const workersByKey = new Map(template.workers.map(worker => [worker.key, worker]));
    const skillsByKey = new Map(template.skills.map(skill => [skill.key, skill]));
    const usedWorkers = new Set([...template.team.memberKeys, template.team.synthesizerKey]);
    const usedSkills = new Set(template.workers.map(worker => worker.skillKey));
    if (workersByKey.size !== template.workers.length || skillsByKey.size !== template.skills.length || new Set(template.team.memberKeys).size !== template.team.memberKeys.length || usedWorkers.size !== template.workers.length || usedSkills.size !== template.skills.length || [...usedWorkers].some(key => !workersByKey.has(key)) || [...usedSkills].some(key => !skillsByKey.has(key))) throw new Error('Template có key trùng, thiếu hoặc không được sử dụng.');
    const skillIds = new Map(template.skills.map(skill => [skill.key, id()]));
    const workerIds = new Map(template.workers.map(worker => [worker.key, id()]));
    const skills: Skill[] = template.skills.map(({ key, ...skill }) => ({ ...skill, ...(skill.package ? packageForImport(skill.package) : {}), id: skillIds.get(key)!, revision: 1 }));
    const workers: Worker[] = template.workers.map(({ key, skillKey, ...worker }) => ({ ...worker, id: workerIds.get(key)!, skillId: skillIds.get(skillKey)!, revision: 1 }));
    const { memberKeys, synthesizerKey, ...settings } = template.team;
    const team: Team = { ...settings, id: id(), revision: 1, memberIds: memberKeys.map(key => workerIds.get(key)!), synthesizerId: workerIds.get(synthesizerKey)! };
    this.store.transaction(() => {
      this.store.versionRows([...skills.map(value => ({ table: 'skills' as const, value })), ...workers.map(value => ({ table: 'workers' as const, value })), { table: 'teams', value: team }]);
      new KnowledgeBase(this.store).importProposed(team.id, template.knowledge ?? []);
    });
    this.notify(); return team;
  }
}
