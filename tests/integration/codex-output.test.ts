import { expect, it } from 'vitest';
import { codexOutputSchema, decodeCodexOutput } from '../../apps/desktop/src/core/harness/codex-output';
import { HarnessAnswerSchema } from '../../apps/desktop/src/core/tools/catalog';
import { z } from 'zod';

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
