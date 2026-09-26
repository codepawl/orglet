import { z } from 'zod';
import { isHarness } from './harness';

/**
 * Only shipped capabilities can be granted. Adding a tool never grants it to old tasks. `browser.read` lets a chat's
 * orglets open and read pages in the browser Orglet manages (COD-261); a later `browser.act` will need it, the way
 * the folder's write level needs read.
 */
export const ToolCapability = z.enum(['source.read', 'dataset.check', 'skill.read', 'network.web', 'app.propose', 'browser.read']);
export type ToolCapability = z.infer<typeof ToolCapability>;
export const ToolCapabilities = z.array(ToolCapability).max(6).refine(
  capabilities => new Set(capabilities).size === capabilities.length,
  'Quyền công cụ bị trùng.',
);

export function supportedCapabilities(_provider: string): ToolCapability[] {
  return ['source.read', 'dataset.check', 'skill.read', 'network.web', 'app.propose', 'browser.read'];
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
