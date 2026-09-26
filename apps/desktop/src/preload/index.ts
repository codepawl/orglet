import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, Reply } from '../shared/contracts';
import type { RunProgressUpdate } from '../shared/progress';
import type { UpdateState } from '../shared/updates';
import type { OpenChatTarget } from '../shared/cli';

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
  relinkSource: (taskId, id) => invoke('orglet:relink-source', { taskId, id }),
  pickWorkspace: (taskId, permissions) => invoke('orglet:pick-workspace', { taskId, permissions }),
  pickNewChatWorkspace: (chat, permissions) => invoke('orglet:pick-workspace', { ...chat, permissions }),
  pickWatchFolder: () => invoke('orglet:pick-workspace', { watch: true, permissions: ['read'] }),
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
  about: () => invoke('orglet:about'),
  openLink: link => invoke('orglet:open-link', link),
  changelog: (refresh = false) => invoke('orglet:changelog', refresh),
  updateState: () => invoke('orglet:update-state'),
  checkForUpdates: () => invoke('orglet:check-for-updates'),
  installUpdate: () => invoke('orglet:install-update'),
  onUpdate: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on('orglet:update', listener);
    return () => ipcRenderer.removeListener('orglet:update', listener);
  },
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('orglet:changed', listener); return () => ipcRenderer.removeListener('orglet:changed', listener); },
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, update: RunProgressUpdate) => callback(update);
    ipcRenderer.on('orglet:progress', listener);
    return () => ipcRenderer.removeListener('orglet:progress', listener);
  },
  onNavigate: callback => {
    const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward') => callback(direction);
    ipcRenderer.on('orglet:navigate', listener);
    return () => ipcRenderer.removeListener('orglet:navigate', listener);
  },
  saveMcpServer: draft => invoke('orglet:mcp-save', draft),
  removeMcpServer: id => invoke('orglet:mcp-remove', id),
  importMcpServers: () => invoke('orglet:mcp-import'),
  saveWebSearchKey: (provider, key) => invoke('orglet:web-search-key', { provider, key }),
  removeWebSearchKey: provider => invoke('orglet:web-search-key-remove', provider),
  cliState: () => invoke('orglet:cli-state'),
  setCliOnPath: enabled => invoke('orglet:cli-path', enabled),
  onOpenChat: callback => {
    const listener = (_event: Electron.IpcRendererEvent, target: OpenChatTarget) => callback(target);
    ipcRenderer.on('orglet:open-chat', listener);
    return () => ipcRenderer.removeListener('orglet:open-chat', listener);
  },
  notifyInBackground: notice => invoke('orglet:notify', notice),
  onOpenTask: callback => {
    const listener = (_event: Electron.IpcRendererEvent, taskId: string) => callback(taskId);
    ipcRenderer.on('orglet:open-task', listener);
    return () => ipcRenderer.removeListener('orglet:open-task', listener);
  },
  takeIncoming: () => invoke('orglet:incoming'),
  onIncoming: callback => {
    const listener = () => callback();
    ipcRenderer.on('orglet:incoming', listener);
    return () => ipcRenderer.removeListener('orglet:incoming', listener);
  },
  takeSentFiles: id => invoke('orglet:sent-files', id),
  dropSentFiles: id => invoke('orglet:drop-sent-files', id),
  sendToState: () => invoke('orglet:send-to-state'),
  setSendTo: enabled => invoke('orglet:send-to', enabled),
  browserState: () => invoke('orglet:browser-state'),
  createBrowserProfile: name => invoke('orglet:browser-create', name),
  openBrowserProfile: id => invoke('orglet:browser-open', id),
  closeBrowserProfile: id => invoke('orglet:browser-close', id),
  clearBrowserProfile: id => invoke('orglet:browser-clear', id),
  deleteBrowserProfile: id => invoke('orglet:browser-delete', id),
  watchBrowser: (runId, watching, width) => invoke('orglet:browser-watch', { runId, watching, width }),
  browserInput: (runId, event) => invoke('orglet:browser-input', { runId, event }),
  onBrowserLive: callback => {
    const listener = (_event: Electron.IpcRendererEvent, live: import('../shared/browser-live').BrowserLiveEvent) => callback(live);
    ipcRenderer.on('orglet:browser-live', listener);
    return () => ipcRenderer.removeListener('orglet:browser-live', listener);
  },
};
contextBridge.exposeInMainWorld('orglet', bridge);
