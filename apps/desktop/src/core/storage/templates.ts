import { TeamTemplate as Template, validateTemplateReferences } from '../../shared/templates';
import { type Worker, type Skill, type Team } from '../../shared/contracts';
import { Store, id } from './database';
import { packageForImport } from '../skill-package';
import { isMemory, type Knowledge } from '../../shared/knowledge';
import { KnowledgeBase } from '../context/knowledge';

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
      workers: workers.map(worker => ({ key: workerKeys.get(worker.id), name: worker.name, instructions: worker.instructions, provider: worker.provider, skillKey: skillKeys.get(worker.skillId), ...(worker.modelId ? { modelId: worker.modelId } : {}), ...(worker.effort ? { effort: worker.effort } : {}), ...(worker.avatar ? { avatar: worker.avatar } : {}), ...(worker.description ? { description: worker.description } : {}) })),
      skills: skills.map(skill => ({ key: skillKeys.get(skill.id), name: skill.name, content: skill.content, ...(skill.package ? { package: skill.package } : {}) })),
      ...(knowledge.length ? { knowledge } : {}),
    }), null, 2);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Template kèm gói skill vượt giới hạn 2 MB. Xuất từng gói skill riêng trong Thư viện.');
    return text;
  }
  import(text: string): Team {
    const template = parseTeamTemplate(text);
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


export function parseTeamTemplate(text: string) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Template vượt giới hạn 2 MB.');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('Tệp template không phải JSON hợp lệ.'); }
  const template = Template.parse(input);
  validateTemplateReferences(template);
  return template;
}
