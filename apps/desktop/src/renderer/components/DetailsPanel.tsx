import { Clock, FileText, Users, Wallet, Wrench, X } from 'lucide-react';
import { t, currentLocale, tMessage } from '../i18n';
import { Avatar, RosterAvatars } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { ShowMore } from './SidebarTree';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { ContextManifestView } from './KnowledgeLibrary';
import { statusLabel } from './TaskThread';
import { statusMarkLabel } from './SidebarTree';
import { formatMoney } from './money';
import { Button } from './ui';
import { teamRoster } from '../assignees';
import type { Run, TaskDetail, Team, Worker, Workspace } from '../../shared/contracts';

/*
 * The panel beside a chat: who you are talking to, what this conversation has cost, and what happened in it.
 * It opens for a team or a worker even before anything has been sent (user, 2026-09-19), because who is in a
 * team is worth reading on its own.
 *
 * Plain words on the surface, machine detail underneath: run ids, revisions, model slugs, the context manifest
 * and token counts live in one collapsed block, so the panel reads like a person wrote it.
 */

// Not the bare 'tổng hợp', which the dictionary already uses for the synthesizer role rather than this stage.
const stageNames: Record<string, string> = { plan: 'phân việc', synthesis: 'gộp kết quả', member: 'phần việc', group: 'trả lời' };

/** A section with an icon beside its title, so the panel can be scanned rather than read. */
function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return <section className="details-section">
    <h3><Icon size={15} aria-hidden="true" />{title}</h3>
    {children}
  </section>;
}

/** The face and name of whoever this chat is with, and one line saying what they are. */
function ChatSubject({ team, worker, members }: { team?: Team; worker?: Worker; members: readonly Worker[] }) {
  if (team) {
    return <div className="details-subject">
      <RosterAvatars workers={members} size="sm" max={3} />
      <div>
        <strong>{team.name}</strong>
        <p className="muted">{t('{0} nhân viên · {1}', [members.length, team.workflow === 'parallel' ? t('làm song song') : t('làm lần lượt')])}</p>
        <p className="muted">{t('Ngân sách tháng {0}', [formatMoney(team.monthlyBudgetMicros)])}</p>
      </div>
    </div>;
  }
  if (!worker) return null;
  return <div className="details-subject">
    <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="lg" />
    <div>
      <strong>{worker.name}</strong>
      {worker.description && <p className="muted">{worker.description}</p>}
      <p className="muted details-runs-on"><ProviderMark provider={worker.provider} size="small" decorative />{worker.provider === 'demo' ? t('Demo · không gọi API') : worker.provider}</p>
      {worker.taskBudgetMicros != null && <p className="muted">{t('Ngân sách mỗi việc {0}', [formatMoney(worker.taskBudgetMicros)])}</p>}
    </div>
  </div>;
}

/** One run as a line of the story: who spoke, what part they were doing, and when. */
function RunEntry({ run, events }: { run: Run; events: { id: string; message: string; createdAt: string }[] }) {
  const person = run.snapshot.worker;
  const stage = run.stage && stageNames[run.stage] ? t(stageNames[run.stage]) : undefined;
  return <li className="details-run">
    <Avatar name={person.name} seed={person.id} mascot={person.avatar?.mascot} defaultMascot hint={person.description} color={person.avatar?.color} size="xs" />
    <div>
      <p className="details-run-who"><strong>{person.name}</strong>{stage && <small>{stage}</small>}</p>
      {events.map(event => <p key={event.id} className="muted">
        <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
        {tMessage(event.message)}
      </p>)}
    </div>
  </li>;
}

export function DetailsPanel({ workspace, team, worker, detail, workerStatus, onClose, onOpenSources, onExport }: {
  workspace: Workspace;
  team?: Team;
  worker?: Worker;
  detail?: TaskDetail;
  workerStatus: (id: string) => StatusMarkState;
  onClose: () => void;
  onOpenSources: () => void;
  onExport: (artifactId: string) => void;
}) {
  const members = team ? teamRoster(team, workspace.workers) : [];
  const spent = detail ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0;
  const tokens = detail ? detail.usage.inputTokens + detail.usage.outputTokens : 0;

  return <aside className="details-pane" aria-label={t('Chi tiết')}>
    <div className="details-head">
      <h2>{t('Chi tiết')}</h2>
      <Button size="icon" aria-label={t('Đóng panel')} onClick={onClose}><X size={18} /></Button>
    </div>
    <div className="details-body">
      <ChatSubject team={team} worker={worker} members={members} />

      {team && <Section icon={Users} title={t('Thành viên')}>
        <ShowMore items={members} empty={t('Nhóm chưa có nhân viên.')} render={member => {
          const mark = workerStatus(member.id);
          return <div key={member.id} className="details-member">
            <StatusMark variant={mark.variant} tone={mark.tone} label={statusMarkLabel(mark)} decorative />
            <Avatar name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size="xs"
              badge={member.provider === 'demo' ? undefined : <ProviderMark provider={member.provider} size="small" decorative />} />
            <div>
              <p className="details-member-name">{member.name}{member.id === team.synthesizerId && <small>{t('tổng hợp')}</small>}</p>
              {member.description && <p className="muted">{member.description}</p>}
            </div>
          </div>;
        }} />
      </Section>}

      {detail && <Section icon={Wallet} title={t('Cuộc trò chuyện này')}>
        <p className="details-status">{statusLabel[detail.task.status]}</p>
        {spent > 0 && <p className="muted">{t('Đã tiêu {0}', [formatMoney(spent)])}</p>}
        {detail.sources.length > 0 && <>
          <ShowMore items={detail.sources} limit={3} empty="" render={source => <p key={source.id} className="details-source"><FileText size={14} aria-hidden="true" />{source.name}</p>} />
          <Button variant="outline" onClick={onOpenSources}><FileText size={16} />{t('Xem nguồn')}</Button>
        </>}
        {detail.sources.length === 0 && <Button variant="outline" onClick={onOpenSources}><FileText size={16} />{t('Xem nguồn')}</Button>}
      </Section>}

      {detail && detail.runs.length > 0 && <Section icon={Clock} title={t('Diễn biến')}>
        <ol className="details-runs">
          {detail.runs.map(run => <RunEntry key={run.id} run={run} events={detail.events.filter(event => event.runId === run.id)} />)}
        </ol>
      </Section>}

      {detail && <details className="details-technical">
        <summary><Wrench size={15} aria-hidden="true" />{t('Chi tiết kỹ thuật')}</summary>
        {tokens > 0 && <p className="muted">{t('Đã dùng {0} token', [tokens.toLocaleString(currentLocale())])}</p>}
        {detail.runs.map(run => <section key={run.id}>
          <h4>{run.snapshot.worker.name} · v{run.snapshot.worker.revision}</h4>
          <p className="muted">{t('Skill v{0}', [run.snapshot.skill.revision])} · {run.snapshot.worker.provider}{run.snapshot.model ? ` · ${run.snapshot.model}` : ''}</p>
          <code className="hash">{run.id}</code>
          {run.snapshot.plan && <ul>{run.snapshot.plan.assignments.map(assignment => <li key={assignment.workerId}>
            {detail.runs.find(item => item.stage === 'member' && item.snapshot.worker.id === assignment.workerId)?.snapshot.worker.name ?? assignment.workerId}: {assignment.brief}
          </li>)}</ul>}
          <ContextManifestView run={run} workspace={workspace} />
          {detail.artifacts.filter(artifact => artifact.runId === run.id).map(artifact => <Button key={artifact.id} variant="outline" onClick={() => onExport(artifact.id)}>
            <FileText size={16} />{t('Xuất {0}', [tMessage(artifact.report.title)])}
          </Button>)}
        </section>)}
      </details>}
    </div>
  </aside>;
}
