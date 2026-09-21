import { expect, it } from 'vitest';
import { harnessToolAdapter, harnessToolSchema } from '../../apps/desktop/src/core/harness/tool-adapter';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';
import { prepareHarnessToolPolicy } from '../../apps/desktop/src/core/harness/exec';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('writes Cursor native-tool denials in the private call directory and refuses to overwrite configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-cursor-policy-'));
  try {
    const request = { harness: 'cursor' as const, cwd: directory, coreToolsOnly: true };
    await prepareHarnessToolPolicy(request);
    const path = join(directory, '.cursor', 'cli.json');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ permissions: {
      allow: [], deny: ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)'],
    } });
    await writeFile(path, 'existing configuration');
    await expect(prepareHarnessToolPolicy(request)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('existing configuration');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.each(['claude-code', 'codex', 'cursor'] as const)('translates a %s structured request without executing its requested operation', async harness => {
  const tools = [toolDefinitions.workspace_read.model];
  let notices = 0;
  const adapter = harnessToolAdapter({ request: { harness, executable: 'fixture', cwd: 'fixture', maxBudgetUsd: 1 },
    execute: async request => {
      expect(request.schema).toEqual(harnessToolSchema(tools, harness));
      expect(request.prompt).toContain('Orglet executes');
      return { output: { call: { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } } }, costUsd: null };
    }, onResult: () => { notices++; },
  });
  const response = await adapter.request([{ role: 'user', content: 'Read note.txt' }], tools, new AbortController().signal, () => {});
  expect(response.calls).toHaveLength(1);
  expect(response.calls[0].name).toBe('workspace_read');
  expect(response.usage).toBeUndefined();
  expect(notices).toBe(1);
});

it.each(['claude-code', 'codex', 'cursor'] as const)('validates a %s reaction request through the shared tool schema', async harness => {
  const messageId = '00000000-0000-4000-8000-000000000001';
  const tools = [toolDefinitions.react_to_message.model];
  const adapter = harnessToolAdapter({ request: { harness, executable: 'fixture', cwd: 'fixture', maxBudgetUsd: 1 },
    execute: async () => ({ output: { call: { name: 'react_to_message', arguments: { messageId, emoji: 'agree', active: true } } }, costUsd: null }),
    onResult: () => {},
  });
  const result = await adapter.request([], tools, new AbortController().signal, () => {});
  expect(JSON.parse(result.calls[0].arguments)).toEqual({ messageId, emoji: 'agree', active: true });
});

it('gives Codex a strict schema even when a tool has optional fields, then validates its JSON arguments', async () => {
  const tools = [toolDefinitions.submit_plan.model];
  const schema = harnessToolSchema(tools, 'codex') as { properties: { call: { properties: { arguments: { type: string } }; required: string[] } } };
  expect(schema.properties.call.required).toEqual(['name', 'arguments']);
  expect(schema.properties.call.properties.arguments.type).toBe('string');
  const adapter = harnessToolAdapter({ request: { harness: 'codex', executable: 'fixture', cwd: 'fixture', maxBudgetUsd: 1 },
    execute: async () => ({ output: { call: { name: 'submit_plan', arguments: JSON.stringify({ assignments: [{ workerId: '00000000-0000-4000-8000-000000000000', brief: 'Check figures' }] }) } }, costUsd: null }),
    onResult: () => {},
  });
  const response = await adapter.request([], tools, new AbortController().signal, () => {});
  expect(response.calls[0].name).toBe('submit_plan');
  expect(JSON.parse(response.calls[0].arguments)).toEqual({ assignments: [{ workerId: '00000000-0000-4000-8000-000000000000', brief: 'Check figures' }] });
});

it.each([
  { name: 'workspace_write', arguments: {} },
  { name: 'workspace_read', arguments: { path: '../escape', offset: 0 } },
  { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0, execute: 'unapproved' } },
])('rejects unsupported or malformed CLI calls before dispatch: %j', async call => {
  const adapter = harnessToolAdapter({ request: { harness: 'codex', executable: 'fixture', cwd: 'fixture', maxBudgetUsd: 1 },
    execute: async () => ({ output: { call }, costUsd: null }), onResult: () => {},
  });
  await expect(adapter.request([], [toolDefinitions.workspace_read.model], new AbortController().signal, () => {})).rejects.toThrow();
});
