import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { permissionBlocker, permissionState, permissionsForLevel, workspaceLevelOf, workspaceLevels } from '../../apps/desktop/src/shared/capability-status';
import { PermissionControls } from '../../apps/desktop/src/renderer/components/PermissionControls';
import { hasCapability } from '../../apps/desktop/src/core/tools/policy';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import type { Run, Task } from '../../apps/desktop/src/shared/contracts';
import { WorkspacePermissions, type WorkspaceGrantView } from '../../apps/desktop/src/shared/workspace-access';
import type { ToolCapability } from '../../apps/desktop/src/shared/tool-policy';

const taskId = '11111111-1111-4111-8111-111111111111';
const grant: WorkspaceGrantView = { id: '22222222-2222-4222-8222-222222222222', taskId,
  revision: 1, permissions: ['read', 'write', 'execute'], name: 'project', revoked: false };
const codex = { id: 'w1', name: 'Minh', provider: 'codex' as const, connected: true };
const demo = { id: 'w2', name: 'Lan', provider: 'demo' as const, connected: true };
const noop = () => {};

const render = (props: Partial<Parameters<typeof PermissionControls>[0]>) => renderToStaticMarkup(createElement(PermissionControls, {
  workers: [codex], capabilities: ['source.read', 'skill.read'] as ToolCapability[], grant, taskId, sourceCount: 1, searchProvider: 'exa',
  onCapability: noop, onWorkspace: noop, ...props,
}));

it('names the web search provider under the web switch, so the person knows who sees a query (COD-266)', () => {
  expect(render({})).toContain('Search with Exa, read public pages.');
  expect(render({ searchProvider: 'duckduckgo' })).toContain('Search with DuckDuckGo, read public pages.');
});

it('maps every grant the schema allows onto one folder level and back', () => {
  for (const level of workspaceLevels) {
    const permissions = permissionsForLevel(level);
    if (level !== 'none') expect(WorkspacePermissions.safeParse(permissions).success).toBe(true);
    expect(workspaceLevelOf(permissions)).toBe(level);
  }
  // The schema refuses a grant that runs commands without editing, so the levels lose nothing.
  expect(WorkspacePermissions.safeParse(['read', 'execute']).success).toBe(false);
  expect(WorkspacePermissions.safeParse(['write']).success).toBe(false);
});

it('shows a folder level only while the current grant exists for this task', () => {
  const state = (override: Partial<Parameters<typeof permissionState>[0]> = {}) =>
    permissionState({ provider: 'codex', capabilities: ['source.read', 'skill.read'], grant, taskId, ...override });
  expect(state()).toMatchObject({ workspace: 'execute', folder: 'project', sources: true, dataset: false, web: false, propose: false });
  expect(state({ capabilities: ['app.propose'] })).toMatchObject({ sources: false, propose: true });
  expect(state({ grant: { ...grant, revoked: true } })).toMatchObject({ workspace: 'none' });
  expect(state({ grant: { ...grant, revoked: true } }).folder).toBeUndefined();
  expect(state({ grant: null }).workspace).toBe('none');
  expect(state({ taskId: '33333333-3333-4333-8333-333333333333' }).workspace).toBe('none');
  expect(state({ grant: { ...grant, permissions: ['read', 'write'] } }).workspace).toBe('write');
  // Without a stored policy the controls show the connection's defaults, the same ones core snapshots.
  expect(state({ provider: 'openai', capabilities: undefined })).toMatchObject({ sources: true, dataset: true, web: false });
  expect(state({ provider: 'codex', capabilities: undefined })).toMatchObject({ sources: true, dataset: false, web: false });
  expect(permissionBlocker('demo', true)).toBe('unsupported');
  expect(permissionBlocker('codex', false)).toBe('connection');
  expect(permissionBlocker('codex', true)).toBeUndefined();
});

it('renders a blocker as a disabled control with one reason, never as a third position', () => {
  const html = render({});
  expect(html).toContain('data-value="execute"');
  expect(html).toContain('project');
  expect(html).not.toContain(grant.id);
  expect(html).not.toContain('disabled=""');
  const demoOnly = render({ workers: [demo] });
  expect(demoOnly).toContain('A Demo worker uses no tools, so access cannot be turned on.');
  expect(demoOnly.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(4);
  expect(demoOnly).toMatch(/role="combobox"[^>]*disabled=""/);
  // The switch keeps its real value under the reason: Demo ignores the policy, it does not change it.
  expect(demoOnly).toMatch(/role="switch"[^>]*aria-checked="true"/);
  const disconnected = render({ workers: [{ ...codex, connected: false }], onConfigure: noop });
  expect(disconnected).toContain('The model is not connected, so access cannot be turned on.');
  expect(disconnected).toContain('Open connection settings');
  // A team keeps its controls when only some members are blocked, and names them.
  const mixed = render({ workers: [codex, demo] });
  expect(mixed).toContain('Does not apply to Lan: Demo uses no tools.');
  expect(mixed).not.toMatch(/role="switch"[^>]*disabled=""/);
  const loading = render({ grant: undefined });
  expect(loading).toMatch(/role="combobox"[^>]*disabled=""/);
  // A grant still on its way is the shape of the folder name, not a sentence and never a spinner (COD-218).
  expect(loading).toMatch(/permission-folder-pending"><span aria-hidden="true" class="org-skeleton org-skeleton-line"/);
  expect(loading).not.toMatch(/role="switch"[^>]*disabled=""/);
  const locked = render({ locked: 'Save first.', taskId: undefined, grant: null });
  expect(locked).toContain('Save first.');
  expect(locked.match(/role="switch"[^>]*disabled=""/g)).toHaveLength(4);
});

it('keeps task capability status aligned with the frozen execution policy on resume', () => {
  const task = { id: taskId, toolCapabilities: ['source.read', 'network.web'] } as Task;
  const run = { taskId, stage: 'member', snapshot: { worker: { provider: 'codex' },
    toolCapabilities: ['source.read'], workspaceGrant: { id: grant.id, taskId, revision: 1, permissions: ['read'] } } } as Run;
  // The control shows the current policy; the runtime intersects it with the run's frozen snapshot.
  expect(permissionState({ provider: 'codex', capabilities: task.toolCapabilities }).web).toBe(true);
  expect(hasCapability(run, task, 'network.web')).toBe(false);
  expect(toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === 'web_read_url')).toBe(false);
  task.toolCapabilities = [];
  expect(permissionState({ provider: 'codex', capabilities: task.toolCapabilities }).sources).toBe(false);
  expect(hasCapability(run, task, 'source.read')).toBe(false);
  expect(toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === 'read_source')).toBe(false);
});

it('offers to change the working folder in one step, only while the folder control can be used (COD-257)', () => {
  const html = render({});
  expect(html).toContain('aria-label="Change working folder project"');
  expect(html).toMatch(/project · <button type="button" class="text-link"[^>]*>Change<\/button>/);
  expect(render({ workers: [demo] })).not.toContain('Change working folder');
  expect(render({ busy: true })).not.toContain('Change working folder');
  expect(render({ grant: null })).not.toContain('Change working folder');
});
