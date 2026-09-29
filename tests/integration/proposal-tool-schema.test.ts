import { expect, it } from 'vitest';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';

it('advertises font bounds without Unicode regex escapes that xAI rejects', () => {
  const tool = toolDefinitions.propose_settings.model;
  if (tool.type !== 'function') throw new Error('Expected a function tool.');
  const parameters = tool.function.parameters;
  expect(JSON.stringify(parameters)).not.toContain('\\p{');
  expect(parameters).toMatchObject({
    properties: {
      interfaceFont: { anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }] },
      codeFont: { anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }] },
      accentColor: { anyOf: [{ pattern: '^#[0-9a-f]{6}$' }, { type: 'null' }] },
    },
  });
});

it('still validates font characters before accepting a settings proposal', () => {
  const schema = toolDefinitions.propose_settings.schema;
  expect(schema.safeParse({ interfaceFont: 'Noto Sans Tiếng Việt', codeFont: 'JetBrains Mono' }).success).toBe(true);
  expect(schema.safeParse({ interfaceFont: 'Font; color: red' }).success).toBe(false);
  expect(schema.safeParse({ codeFont: 'url(font.woff)' }).success).toBe(false);
  expect(schema.safeParse({ interfaceFont: 'a'.repeat(65) }).success).toBe(false);
});
