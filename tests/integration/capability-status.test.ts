import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { abilityStatuses } from '../../apps/desktop/src/shared/capability-status';
import { CapabilityView } from '../../apps/desktop/src/renderer/components/CapabilityView';
import { hasCapability } from '../../apps/desktop/src/core/tools/policy';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import type { Run, Task } from '../../apps/desktop/src/shared/contracts';
import type { WorkspaceGrantView } from '../../apps/desktop/src/shared/workspace-access';
import type { ToolCapability } from '../../apps/desktop/src/shared/tool-policy';

const taskId = '11111111-1111-4111-8111-111111111111';
const grant: WorkspaceGrantView = { id: '22222222-2222-4222-8222-222222222222', taskId,
  revision: 1, permissions: ['read', 'write', 'execute'], name: 'project', revoked: false };

const input = (override: Partial<Parameters<typeof abilityStatuses>[0]> = {}): Parameters<typeof abilityStatuses>[0] => ({
  provider: 'codex', connected: true, capabilities: ['source.read', 'skill.read'] as ToolCapability[],
  grant, sourceCount: 1, ...override,
});

it('shows a usable workspace only while the current grant exists and the model is connected', () => {
  const status = (override: Partial<Parameters<typeof abilityStatuses>[0]> = {}) =>
    Object.fromEntries(abilityStatuses(input(override)).map(row => [row.ability, row.state]));
  expect(status()['workspace-execute']).toBe('available');
  expect(status({ grant: { ...grant, revoked: true } })['workspace-execute']).toBe('permission');
  expect(status({ grant: null })['workspace-read']).toBe('permission');
  expect(status({ taskId: '33333333-3333-4333-8333-333333333333' })['workspace-read']).toBe('permission');
  expect(status({ connected: false })['workspace-execute']).toBe('connection');
  expect(status({ provider: 'demo' })['workspace-execute']).toBe('unsupported');
  const html = renderToStaticMarkup(createElement(CapabilityView, input({ grant: { ...grant, revoked: true } })));
  expect(html).toContain('Edit files in the working folder');
  expect(html).toContain('Grant access');
  expect(html).not.toContain(grant.id);
  const disconnected = renderToStaticMarkup(createElement(CapabilityView,
    { ...input({ connected: false }), onConfigure: () => {} }));
  expect(disconnected).toContain('Open connection settings');
});

it('keeps task capability status aligned with the frozen execution policy on resume', () => {
  const task = { id: taskId, toolCapabilities: ['source.read', 'network.web'] } as Task;
  const run = { taskId, stage: 'member', snapshot: { worker: { provider: 'codex' },
    toolCapabilities: ['source.read'], workspaceGrant: { id: grant.id, taskId, revision: 1, permissions: ['read'] } } } as Run;
  expect(abilityStatuses(input({ capabilities: task.toolCapabilities })).find(row => row.ability === 'web')?.state).toBe('available');
  expect(hasCapability(run, task, 'network.web')).toBe(false);
  expect(toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === 'web_read_url')).toBe(false);
  task.toolCapabilities = [];
  expect(abilityStatuses(input({ capabilities: task.toolCapabilities })).find(row => row.ability === 'sources')?.state).toBe('permission');
  expect(hasCapability(run, task, 'source.read')).toBe(false);
  expect(toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === 'read_source')).toBe(false);
});
