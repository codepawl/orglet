import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, Reply } from '../shared/contracts';
import type { RunProgressUpdate } from '../shared/progress';

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const reply: Reply<T> = await ipcRenderer.invoke(channel, args);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
const bridge: Bridge = {
  call: (command, args) => invoke('orglet:command', { command, args }),
  pickSources: () => invoke('orglet:pick'),
  pickFolder: () => invoke('orglet:pick-folder'),
  openSource: (taskId, id) => invoke('orglet:open-source', { taskId, id }),
  pickWorkspace: (taskId, permissions) => invoke('orglet:pick-workspace', { taskId, permissions }),
  connections: () => invoke('orglet:connections'),
  connect: (provider, key) => invoke('orglet:connect', key === undefined ? { provider } : { provider, key }),
  disconnect: provider => invoke('orglet:disconnect', provider),
  exportArtifact: (id, format = 'markdown') => invoke('orglet:export', { id, format }),
  copyArtifact: (id, format) => invoke('orglet:copy', { id, format }),
  copyFeedback: id => invoke('orglet:copy-feedback', id),
  copyText: text => invoke('orglet:copy-text', text),
  exportTemplate: id => invoke('orglet:template-export', id),
  importTemplate: () => invoke('orglet:template-import'),
  importSkill: () => invoke('orglet:skill-import'),
  exportSkill: id => invoke('orglet:skill-export', id),
  openPricing: provider => invoke('orglet:open-pricing', provider),
  backup: () => invoke('orglet:backup'),
  restore: () => invoke('orglet:restore'),
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('orglet:changed', listener); return () => ipcRenderer.removeListener('orglet:changed', listener); },
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, update: RunProgressUpdate) => callback(update);
    ipcRenderer.on('orglet:progress', listener);
    return () => ipcRenderer.removeListener('orglet:progress', listener);
  },
};
contextBridge.exposeInMainWorld('orglet', bridge);
