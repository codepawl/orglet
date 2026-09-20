import { z } from 'zod';

/** Only shipped capabilities can be granted. Adding a tool never grants it to old tasks. */
export const ToolCapability = z.enum(['source.read', 'dataset.check', 'skill.read', 'network.web']);
export type ToolCapability = z.infer<typeof ToolCapability>;
export const ToolCapabilities = z.array(ToolCapability).max(4).refine(
  capabilities => new Set(capabilities).size === capabilities.length,
  'Quyền công cụ bị trùng.',
);

export function supportedCapabilities(provider: string): ToolCapability[] {
  return ['claude-code', 'codex', 'cursor'].includes(provider) ? ['source.read', 'skill.read'] : ['source.read', 'dataset.check', 'skill.read'];
}

export function snapshotCapabilities(provider: string, requested?: ToolCapability[]): ToolCapability[] {
  const supported = supportedCapabilities(provider);
  // A new capability must never become an implicit grant on old tasks or checkpoints.
  const defaults: ToolCapability[] = ['claude-code', 'codex', 'cursor'].includes(provider)
    ? ['source.read', 'skill.read'] : ['source.read', 'dataset.check', 'skill.read'];
  const capabilities = ToolCapabilities.parse(requested ?? defaults);
  if (capabilities.some(capability => !supported.includes(capability))) {
    throw new Error('Kết nối này chưa hỗ trợ quyền công cụ đã chọn.');
  }
  return [...capabilities];
}
