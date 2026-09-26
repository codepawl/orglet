import { z } from 'zod';
import { isHarness } from './harness';

/**
 * Only shipped capabilities can be granted. Adding a tool never grants it to old tasks. `browser.read` lets a chat's
 * orglets open and read pages in the browser Orglet manages (COD-261); `browser.act` also lets them click, type and
 * choose on those pages, and needs `browser.read`, the way the folder's write level needs read.
 */
export const ToolCapability = z.enum(['source.read', 'dataset.check', 'skill.read', 'network.web', 'app.propose', 'browser.read', 'browser.act']);
export type ToolCapability = z.infer<typeof ToolCapability>;
export const ToolCapabilities = z.array(ToolCapability).max(7)
  .refine(capabilities => new Set(capabilities).size === capabilities.length, 'Quyền công cụ bị trùng.')
  .refine(capabilities => !capabilities.includes('browser.act') || capabilities.includes('browser.read'), 'Thao tác trên trang cần quyền đọc trang.');

export function supportedCapabilities(_provider: string): ToolCapability[] {
  return ['source.read', 'dataset.check', 'skill.read', 'network.web', 'app.propose', 'browser.read', 'browser.act'];
}

/**
 * The capabilities with one switched on or off, keeping the browser's levels cumulative: acting brings reading with
 * it, and turning reading off takes acting with it.
 */
export function withCapability(previous: readonly ToolCapability[], capability: ToolCapability, enabled: boolean): ToolCapability[] {
  let next = previous.filter(item => item !== capability);
  if (enabled) next.push(capability);
  if (enabled && capability === 'browser.act' && !next.includes('browser.read')) next.push('browser.read');
  if (!enabled && capability === 'browser.read') next = next.filter(item => item !== 'browser.act');
  return next;
}

export function snapshotCapabilities(provider: string, requested?: ToolCapability[]): ToolCapability[] {
  const supported = supportedCapabilities(provider);
  // A new capability must never become an implicit grant on old tasks or checkpoints. `app.propose` is the one
  // exception (COD-199): it lets a worker store a change for the user to apply, never make one, so a chat has it
  // unless the user turned it off.
  const defaults: ToolCapability[] = isHarness(provider)
    ? ['source.read', 'skill.read', 'app.propose'] : ['source.read', 'dataset.check', 'skill.read', 'app.propose'];
  const capabilities = ToolCapabilities.parse(requested ?? defaults);
  if (capabilities.some(capability => !supported.includes(capability))) {
    throw new Error('Kết nối này chưa hỗ trợ quyền công cụ đã chọn.');
  }
  return [...capabilities];
}
