import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { WebTools } from '../../apps/desktop/src/core/tools/web-tools';
import type { WebNetwork } from '../../apps/desktop/src/core/tools/web-network';
import { OUT_OF_STEPS_LIMITATION } from '../../apps/desktop/src/core/orchestration/runner';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-256, found dogfooding a crew asked to look up three competitors on the web and write a launch post. The
 * researcher ran out of steps with three priced competitors in hand, handed its report in as a blocker, and the run
 * failed; the lead then told the person the research was incomplete and that the two members the plan never asked
 * had supplied nothing; and the card that said to see the saved report had no way to open it.
 */

const MEMBER_IDENTITY = 'This turn you answer only the brief the team gave you.';
const SYNTHESIS_IDENTITY = 'This turn you combine your teammates\' answers';
const FINDINGS = 'Zoho Invoice: free up to 500 invoices a year. Invoice Ninja: Pro $14/month. invoicely: Basic $9.99/month.';

type MemberBehaviour = 'readUntilWrapUp' | 'blockAtOnce';

let directory: string;
let store: Store;
let core: CoreService;
let memberBehaviour: MemberBehaviour;
let assignOnlyFirst: boolean;
let memberBodies: string[];
let synthesisBodies: string[];
let wrapUpInstructions: string[];

const bodyOf = (messages: ChatCompletionMessageParam[]) => messages.map(message => String(message.content)).join('\n');

/** The per-turn crew message a member or the lead gets: who works this turn, and what the lead is told about them. */
function crewMessage(body: string) {
  for (const line of body.split('\n')) {
    if (!line.startsWith('{"participants"')) continue;
    return JSON.parse(line) as { participants: { id: string; name: string }[]; notAssignedThisTurn?: { id: string; name: string }[]; instruction: string };
  }
  throw new Error('No crew message in this request');
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-crew-honesty-'));
  store = new Store(join(directory, 'state.sqlite'));
  memberBehaviour = 'readUntilWrapUp';
  assignOnlyFirst = false;
  memberBodies = [];
  synthesisBodies = [];
  wrapUpInstructions = [];
  const network: WebNetwork = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<title>Pricing</title><p>Pro $14/month.</p>') }),
  };
  const page = await new WebTools(network).read({ url: 'https://invoiceninja.com/pricing-plans/' }, new AbortController().signal);
  vi.spyOn(WebTools.prototype, 'read').mockResolvedValue(page);
  let calls = 0;
  const adapter: ModelAdapter = { async request(messages, tools) {
    calls++;
    if (isPlanRequest(tools)) return planReply(messages, assignOnlyFirst ? ids => ids.slice(0, 1) : undefined);
    const system = String(messages[0].content);
    const body = bodyOf(messages);
    if (system.includes(SYNTHESIS_IDENTITY)) {
      synthesisBodies.push(body);
      return { calls: [{ id: `answer-${calls}`, name: 'reply', arguments: JSON.stringify({ message: `Three competitors. ${FINDINGS}` }) }], usage: { input: 50, output: 20 } };
    }
    if (!system.includes(MEMBER_IDENTITY)) throw new Error('Unexpected request');
    memberBodies.push(body);
    const wrapUp = messages.find(message => message.role === 'user' && String(message.content).includes('almost out of steps'));
    if (memberBehaviour === 'readUntilWrapUp' && !wrapUp) {
      return { calls: [{ id: `read-${calls}`, name: 'web_read_url', arguments: '{"url":"https://invoiceninja.com/pricing-plans/"}' }], usage: { input: 50, output: 20 } };
    }
    if (wrapUp) wrapUpInstructions.push(String(wrapUp.content));
    // What the dogfood researcher did: a report with real findings, marked blocked because details stayed unverified.
    return { calls: [{ id: `report-${calls}`, name: 'submit_report', arguments: JSON.stringify({
      title: 'Competitor research', summary: FINDINGS, findings: [], limitations: ['Currency codes were not verified.'], assignmentOutcome: 'blocked',
    }) }], usage: { input: 50, output: 20 } };
  } };
  core = new CoreService(store, () => {}, async () => adapter);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function runCrewTurn() {
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Look up 3 competitors on the web, then write a 3-line launch post.',
    sourceIds: [], consent: true, budgetMicros: 20_000_000, toolCapabilities: ['network.web'] }) as string;
  for (let attempt = 0; attempt < 600 && core.teams.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
  return { team, taskId, detail: store.detail(taskId) };
}

const members = (runs: Run[]) => runs.filter(run => run.stage === 'member');
const synthesisOf = (runs: Run[]) => runs.find(run => run.stage === 'synthesis')!;

it('hands in a member that ran out of steps as a result with limitations, and the crew answer says it was cut short', async () => {
  assignOnlyFirst = true;
  const { team, detail } = await runCrewTurn();
  const researcher = members(detail.runs).find(run => run.snapshot.worker.id === team.memberIds[0])!;
  expect(researcher.status).toBe('completed');
  expect(researcher.error).toBeNull();
  // The member was told how to hand in: its findings are its result, and blocked is kept for having nothing.
  expect(wrapUpInstructions).toHaveLength(1);
  expect(wrapUpInstructions[0]).toContain('set assignmentOutcome to completed');
  const report = detail.artifacts.find(artifact => artifact.runId === researcher.id)!.report;
  expect(report.summary).toBe(FINDINGS);
  expect(report.limitations).toContain('Currency codes were not verified.');
  expect(report.limitations).toContain(OUT_OF_STEPS_LIMITATION);
  // The lead combines the member's report instead of being told the research failed.
  const synthesis = synthesisOf(detail.runs);
  expect(synthesis.snapshot.upstreamArtifactIds).toEqual([detail.artifacts.find(artifact => artifact.runId === researcher.id)!.id]);
  const answer = detail.artifacts.find(artifact => artifact.runId === synthesis.id)!.report;
  const cutShort = `${researcher.snapshot.worker.name} hết số bước trước khi xong phần việc; kết quả của Tí này là phần đã làm được.`;
  expect(answer.limitations).toEqual([cutShort]);
  expect(translateMessage(en, cutShort)).toBe(`${researcher.snapshot.worker.name} ran out of steps before finishing; its result is what it got done.`);
  expect(translateMessage(en, OUT_OF_STEPS_LIMITATION)).toBe('Ran out of steps before finishing the assignment; this is what was done.');
  expect(detail.task.status).toBe('completed');
});

it('tells the lead only about the members the plan assigned this turn', async () => {
  assignOnlyFirst = true;
  memberBehaviour = 'blockAtOnce';
  const { team } = await runCrewTurn();
  const lead = store.get<Worker>('workers', team.synthesizerId);
  const assigned = store.get<Worker>('workers', team.memberIds[0]);
  const skipped = store.get<Worker>('workers', team.memberIds[1]);
  const synthesis = crewMessage(synthesisBodies.at(-1)!);
  expect(synthesis.participants).toEqual([{ id: assigned.id, name: assigned.name }, { id: lead.id, name: lead.name }]);
  expect(synthesis.notAssignedThisTurn).toEqual([{ id: skipped.id, name: skipped.name }]);
  expect(synthesis.instruction).toContain('They were not asked, so no result of theirs is missing');
  // A member works with the people of this turn too, and has nothing to say about the rest.
  const member = crewMessage(memberBodies.at(-1)!);
  expect(member.participants.map(participant => participant.id)).toEqual([assigned.id, lead.id]);
  expect(member.notAssignedThisTurn).toBeUndefined();
});

it('keeps the lead prompt as before when every member was assigned', async () => {
  memberBehaviour = 'blockAtOnce';
  const { team } = await runCrewTurn();
  const synthesis = crewMessage(synthesisBodies.at(-1)!);
  expect(synthesis.participants.map(participant => participant.id)).toEqual([...team.memberIds, team.synthesizerId]);
  expect(synthesis.notAssignedThisTurn).toBeUndefined();
  expect(synthesis.instruction).not.toContain('notAssignedThisTurn');
});

it('opens a blocked member\'s saved report from the card that says to see it', async () => {
  assignOnlyFirst = true;
  memberBehaviour = 'blockAtOnce';
  const { taskId, detail } = await runCrewTurn();
  // Blocked at once, not out of steps: the blocker stands, and its report is saved though the run failed.
  const blocked = members(detail.runs).find(run => run.status === 'failed')!;
  expect(blocked.error).toBe('Phần việc bị chặn; xem báo cáo đã lưu.');
  expect(detail.artifacts.some(artifact => artifact.runId === blocked.id)).toBe(true);
  expect(detail.task.status).toBe('failed');

  const workspace = store.workspace();
  const html = renderToStaticMarkup(createElement(TaskThread, {
    detail: store.detail(taskId), workspace: { workers: workspace.workers, skills: workspace.skills, tasks: workspace.tasks }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
  expect(html).toContain('Assignment blocked; see the saved report.');
  expect(html).toContain(`Open ${blocked.snapshot.worker.name}’s report`);
});
