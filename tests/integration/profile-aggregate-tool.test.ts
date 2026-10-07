import { expect, it } from 'vitest';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';
import { ProfileArgs } from '../../apps/desktop/src/shared/profiles';

const sourceId = '8d0a7a39-3b3e-4a39-9b1a-0c6c3c1d2e4f';
const parameters = (toolDefinitions.profile_dataset.model as { function: { parameters: unknown } }).function.parameters as { required: string[]; properties: Record<string, unknown> };

// profile_dataset can total a data file by group, so a chart is drawn from a few rows (2026-10-07).
it('shows the model aggregate as a required nullable field, as strict function schemas need', () => {
  expect(parameters.required).toEqual(expect.arrayContaining(['sourceIds', 'idColumn', 'aggregate']));
  expect(parameters.properties.aggregate).toBeDefined();
});

it('still accepts a call that leaves aggregate out, and rejects a function outside the fixed set', () => {
  expect(ProfileArgs.parse({ sourceIds: [sourceId], idColumn: null })).toEqual({ sourceIds: [sourceId], idColumn: null });
  const measure = (fn: string) => ({ sourceIds: [sourceId], idColumn: null, aggregate: { groupBy: 'month', dateBucket: null, measures: [{ column: 'revenue', fn }], sort: 'group', limit: 12 } });
  expect(ProfileArgs.parse(measure('sum')).aggregate?.measures[0].fn).toBe('sum');
  expect(() => ProfileArgs.parse(measure('median'))).toThrow();
  expect(() => ProfileArgs.parse({ ...measure('sum'), aggregate: { ...measure('sum').aggregate, limit: 5000 } })).toThrow();
});

it('tells the model to chart aggregated rows from an attached file', () => {
  expect((toolDefinitions.reply.model as { function: { description: string } }).function.description).toContain('profile_dataset with aggregate');
});
