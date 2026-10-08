import { expect, it } from 'vitest';
import { z } from 'zod';
import { ModelReportSchema, MemberReportSchema, toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';

/**
 * OpenAI's strict function calling refuses a schema whose object leaves any property out of "required"
 * (measured 2026-10-09: submit_report came back 400 over review.checks[].processIds, so every report run on the
 * OpenAI API failed). Every strict tool, and the report schemas sent as a tool, must list every property.
 */
function looseObjects(schema: unknown, path = 'root'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const found: string[] = [];
  if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
    const required = new Set(Array.isArray(node.required) ? node.required as string[] : []);
    for (const key of Object.keys(node.properties)) if (!required.has(key)) found.push(`${path}.${key}`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) value.forEach((item, index) => found.push(...looseObjects(item, `${path}.${key}[${index}]`)));
    else if (value && typeof value === 'object') found.push(...looseObjects(value, key === 'properties' ? path : `${path}.${key}`));
  }
  return found;
}

it('lists every property as required in every strict tool schema', () => {
  const problems: string[] = [];
  for (const [name, definition] of Object.entries(toolDefinitions)) {
    if (definition.model.type !== 'function' || !definition.model.function.strict) continue;
    problems.push(...looseObjects(definition.model.function.parameters).map(path => `${name}: ${path}`));
  }
  for (const [name, schema] of [['report', ModelReportSchema], ['member report', MemberReportSchema]] as const) {
    problems.push(...looseObjects(z.toJSONSchema(schema, { target: 'draft-7' })).map(path => `${name}: ${path}`));
  }
  expect(problems).toEqual([]);
});
