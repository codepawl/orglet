import { expect, it } from 'vitest';
import { codexOutputSchema, decodeCodexOutput } from '../../apps/desktop/src/core/harness/codex-output';
import { harnessAnswerSchema, HarnessAnswerSchema, ModelReportSchema, ModelReport } from '../../apps/desktop/src/core/tools/catalog';
import { z } from 'zod';
import { harnessPrompt } from '../../apps/desktop/src/core/orchestration/runner';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { TeamPlan, type Run, type Skill, type Worker } from '../../apps/desktop/src/shared/contracts';

it('gives Codex a strict outer schema even when the original report has nested optional fields', () => {
  const original = z.toJSONSchema(HarnessAnswerSchema, { target: 'draft-7' });
  expect(JSON.stringify(original)).toContain('processIds');
  expect(codexOutputSchema.required).toEqual(['payload']);
  expect(codexOutputSchema.properties.payload.type).toBe('string');
  const answer = { message: 'No check was run.', title: null, report: null };
  expect(HarnessAnswerSchema.parse(decodeCodexOutput({ payload: JSON.stringify(answer) }))).toEqual(answer);
});

it('still rejects malformed JSON and invalid reports after decoding', () => {
  expect(() => decodeCodexOutput({ payload: '{invalid' })).toThrow('JSON hợp lệ');
  expect(() => decodeCodexOutput({ payload: '{}', extra: true })).toThrow();
  const invalid = { message: 'Done', title: null, report: { title: 'Result', summary: 'Done', findings: [], limitations: [], knowledgeProposals: [], review: {
    checks: [{ name: 'Syntax', status: 'pass', coverage: 'No command ran', sourceIds: [], checkerIds: [], processIds: ['bad'] }],
    conflicts: [], recommendation: 'ready_for_human_review', draftFeedback: 'Feedback', upstreamFindingIds: [],
  } } };
  expect(() => HarnessAnswerSchema.parse(decodeCodexOutput({ payload: JSON.stringify(invalid) }))).toThrow();
});

// Team runs use the tool loop today. These test the existing one-shot prompt helper's shape guidance,
// while harness.test.ts captures the reachable standalone Codex dispatch and its saved artifact.
it.each(['member', 'plan', 'required-report'] as const)('composes canonical inner %s guidance without relaxing the payload envelope (COD-360)', shape => {
  const store = new Store(':memory:');
  try {
    const worker = store.all<Worker>('workers')[0];
    const run: Run = { id: id(), taskId: id(), stage: shape === 'required-report' ? 'synthesis' : shape, status: 'queued', startedAt: now(), error: null,
      snapshot: { worker, skill: store.get<Skill>('skills', worker.skillId) } };
    const innerSchema = z.toJSONSchema(shape === 'plan' ? TeamPlan : shape === 'required-report' ? ModelReportSchema : harnessAnswerSchema(run, false), { target: 'draft-7' });
    const prompt = harnessPrompt([], [], [], shape === 'plan', true, [], false, false, false, false, innerSchema);
    const marker = 'The JSON inside payload must match this inner JSON schema: ';
    expect(JSON.parse(prompt.split('\n\n').find(block => block.startsWith(marker))!.slice(marker.length))).toEqual(innerSchema);
    expect(prompt).toContain('The output schema has one payload string');
    if (shape === 'required-report') {
      expect(prompt).toContain('Your final answer must be the report object itself');
      expect(prompt).not.toContain('Set report to null unless');
    } else if (shape === 'member') {
      expect(JSON.stringify(innerSchema)).toContain('assignmentOutcome');
      expect(JSON.stringify(innerSchema)).toContain('blocked');
      expect(() => ModelReport.parse({ title: 'Partial', summary: 'Still working', findings: [], limitations: [], assignmentOutcome: 'partial' })).toThrow();
    } else {
      expect(prompt).toContain('Assign work with submit_plan fields');
    }
  } finally {
    store.close();
  }
});
