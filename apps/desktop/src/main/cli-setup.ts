import { ZodError } from 'zod';
import { BrowserChoice, BrowserProfileId, CLEAN_BROWSER_PROFILE, capabilitiesWithBrowserLevel, defaultBrowserChoice, normalizeBrowserSite, type BrowserSite } from '../shared/browser';
import { capabilitiesWithDesktopLevel, defaultDesktopChoice, DesktopChoice, DesktopProgram, neverDesktopProgram, type DesktopWindowsView } from '../shared/desktop';
import { McpServerDraft } from '../shared/mcp';
import { commands, ApiProvider, CredentialProvider, type Task, type Workspace } from '../shared/contracts';
import { customProviderId, isCustomProvider } from '../shared/custom-connections';
import { HarnessCatalogId, type HarnessInfo } from '../shared/harness';
import { TerminalUndo } from '../shared/terminal-access';
import { ToolCapabilities } from '../shared/tool-policy';
import { WebSearchKeyProvider } from '../shared/web-tools';
import { GrantWorkspace, WorkspacePermissions, type WorkspaceGrantView } from '../shared/workspace-access';
import { SpaceDefaults } from '../shared/spaces';
import type { SetupBody } from '../cli/held-protocol';
import { assigneeOf } from './cli-chat-admin';
import { chatsOf, CliFailure, liveChatTask, matchChat, targetChat, type CoreRequest } from './cli-chats';
import { checkedBackupPath, checkedFolder } from './cli-folders';
import { spaceNamed } from './cli-spaces';
import type { CliDependencies, CliSetupApp } from './cli-turns';

/**
 * Stages C and D of docs/cli-held-actions-design.md: grants and secrets. Every operation here ends in the same core
 * command or main function the window's control calls, with the same refusals, plus the folder refusals the native picker
 * made unnecessary. The server has already checked the elevation by the time `perform` runs. A secret arrives in the
 * body, goes to the credential store and is dropped: nothing here returns it, logs it or throws it.
 */

export type SetupOutcome = {
  /** What the grant touched, in the journal's words. Never a secret. */
  subject?: string;
  /** How Settings can take the grant back, when the core can. */
  undo?: TerminalUndo;
  /** Lines for the terminal to print under the summary. Never a secret. */
  report?: string[];
  /** The hash of the skill package a `skill-show` printed, so the terminal can send exactly that hash to approve. */
  skillHash?: string;
};

type ChatTarget = { taskId: string } | { workerId: string } | { teamId: string };
const NOT_AVAILABLE = 'Bản Orglet này chưa hỗ trợ cấp quyền từ terminal.';
const KEY_NOT_SAVED = 'Không lưu được khóa.';

/** A schema's refusal as the window words it, without the library's raw issue list. */
function parsedOrRefused<Value>(parse: () => Value): Value {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) throw new CliFailure('invalid', error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.');
    throw error;
  }
}

function siteOf(text: string): string {
  const site = normalizeBrowserSite(text);
  if (!site) throw new CliFailure('invalid', 'Nhập một địa chỉ như example.com hoặc localhost:3000.');
  return site;
}

/** The site list after the same edits the window's list makes: a site is dropped, or put at the end with its new decision. */
function editedSites(current: readonly BrowserSite[], change: { allow?: string[]; block?: string[]; remove?: string[] }): BrowserSite[] {
  const addedAt = new Date().toISOString();
  let sites = current.filter(entry => !(change.remove ?? []).some(text => siteOf(text) === entry.site));
  for (const [texts, decision] of [[change.allow ?? [], 'allowed'], [change.block ?? [], 'blocked']] as const) {
    for (const text of texts) {
      const site = siteOf(text);
      sites = [...sites.filter(entry => entry.site !== site), { site, decision, addedAt }];
    }
  }
  return sites;
}

/** A program as the list keeps it: lowercase, with .exe. */
function programOf(typed: string): string {
  const lower = typed.trim().toLowerCase();
  const program = lower.endsWith('.exe') ? lower : `${lower}.exe`;
  if (!DesktopProgram.safeParse(program).success) throw new CliFailure('invalid', 'Tên chương trình không hợp lệ.');
  return program;
}

/**
 * The draft Settings' form would send: the file's names plus the values typed at the terminal. An `Authorization` entry is
 * the bearer token, as the window's import reads it. A new server needs every value; an existing one keeps a value left untyped.
 */
function draftWithSecrets(server: McpServerDraft, typed: Record<string, string>, existingId: string | undefined): McpServerDraft {
  const { id: _namedByTerminal, ...base } = server;
  const withTyped = (entry: { name: string }) => ({ name: entry.name, ...(typed[entry.name] !== undefined ? { value: typed[entry.name] } : {}) });
  const identity = existingId ? { id: existingId } : {};
  if (server.transport.kind === 'stdio') {
    const env = server.transport.env.map(withTyped);
    if (!existingId) requireTyped(env);
    return McpServerDraft.parse({ ...base, ...identity, transport: { ...server.transport, env } });
  }
  const tokenEntry = server.transport.headers.find(entry => entry.name.toLowerCase() === 'authorization');
  const headers = server.transport.headers.filter(entry => entry !== tokenEntry).map(withTyped);
  const typedToken = tokenEntry ? typed[tokenEntry.name]?.replace(/^Bearer\s+/i, '').trim() : undefined;
  if (!existingId) requireTyped([...headers, ...(tokenEntry ? [{ name: tokenEntry.name, value: typedToken }] : [])]);
  return McpServerDraft.parse({ ...base, ...identity, transport: { ...server.transport, headers, ...(typedToken ? { bearer: typedToken } : {}) } });
}

function requireTyped(entries: readonly { name: string; value?: string }[]): void {
  const missing = entries.filter(entry => !entry.value).map(entry => entry.name);
  if (missing.length) throw new Error(`Thiếu giá trị cho: ${missing.join(', ')}.`);
}

/** A failure's message with every typed value cut out, so no refusal can carry a secret back to the terminal. */
function scrubbed(error: unknown, values: readonly string[]): string {
  if (error instanceof ZodError) return 'Dữ liệu không hợp lệ.';
  let message = error instanceof Error ? error.message : 'Không lưu được.';
  for (const value of values) message = message.split(value).join('…');
  return message.slice(0, 300);
}

export class CliSetup {
  constructor(private readonly dependencies: CliDependencies) {}

  private get request(): CoreRequest {
    return this.dependencies.request;
  }

  private app(): CliSetupApp {
    if (!this.dependencies.setup) throw new CliFailure('failed', NOT_AVAILABLE);
    return this.dependencies.setup;
  }

  private workspace(): Promise<Workspace> {
    return this.request('workspace', {}) as Promise<Workspace>;
  }

  async perform(body: SetupBody): Promise<SetupOutcome> {
    switch (body.action) {
      case 'tools': return this.setTools(body);
      case 'folder': return this.grantFolder(body);
      case 'schedule-folder': return this.grantScheduleFolder(body);
      case 'folder-level': return this.setFolderLevel(body);
      case 'folder-revoke': return this.revokeFolder(body);
      case 'file-revoke': return this.revokeFile(body);
      case 'mcp-enable': return this.enableMcp(body);
      case 'mcp-grant': return this.grantMcp(body);
      case 'mcp-remove': return this.removeMcp(body);
      case 'mcp-sign-in': return this.signInMcp(body);
      case 'limit': return this.setLimit(body);
      case 'space-tools': return this.setSpaceTools(body);
      case 'decision-model': return this.setDecisionModel(body);
      case 'switch': return this.setSwitch(body);
      case 'backup': return this.backup(body);
      case 'sync': return this.startSync(body);
      case 'browser-profile': return this.changeBrowserProfile(body);
      case 'harness': return this.changeHarness(body);
      case 'account': return this.changeAccount(body);
      case 'custom-connection': return this.changeCustomConnection(body);
      case 'disconnect': return this.disconnect(body);
      case 'search-key-remove': return this.removeSearchKey(body);
      case 'connect': return this.connect(body);
      case 'search-key': return this.saveSearchKey(body);
      case 'browser-choice': return this.changeBrowser(body);
      case 'desktop-choice': return this.changeDesktop(body);
      case 'mcp-save':
      case 'mcp-import': return this.saveMcpServers(body);
    }
  }

  /** What the window's browser settings do: the profile it lists, the site list it edits, and the level the capabilities say. */
  private async changeBrowser(body: Extract<SetupBody, { action: 'browser-choice' }>): Promise<SetupOutcome> {
    const { task, name } = await this.existingChat(await this.workspace(), body);
    const current = task.browser ?? defaultBrowserChoice();
    const profileId = body.profile === undefined ? current.profileId : await this.browserProfileId(body.profile);
    const choice = parsedOrRefused(() => BrowserChoice.parse({ profileId, sites: editedSites(current.sites, body) }));
    await this.request('setBrowser', { taskId: task.id, browser: choice });
    if (body.mode) await this.request('setToolCapabilities', { taskId: task.id, capabilities: ToolCapabilities.parse(capabilitiesWithBrowserLevel(task.toolCapabilities ?? [], body.mode)) });
    return { subject: name };
  }

  /** The profile a typed name means, among the ones main keeps; the window's list is the same list. */
  private async browserProfileId(typed: string): Promise<BrowserProfileId> {
    if (typed.toLowerCase() === CLEAN_BROWSER_PROFILE) return CLEAN_BROWSER_PROFILE;
    const profile = (await this.app().browserProfiles.list()).find(item => item.name.toLowerCase() === typed.toLowerCase());
    if (!profile) throw new CliFailure('not_found', 'Không tìm thấy hồ sơ trình duyệt này.');
    return BrowserProfileId.parse(profile.id);
  }

  /** Grants programs by executable name with the window's refusals: the fixed never-list, Orglet's own programs, and administrator windows. */
  private async changeDesktop(body: Extract<SetupBody, { action: 'desktop-choice' }>): Promise<SetupOutcome> {
    const { task, name } = await this.existingChat(await this.workspace(), body);
    const current = task.desktop ?? defaultDesktopChoice();
    const open = (await this.request('desktopWindows', {}) as DesktopWindowsView | undefined)?.windows ?? [];
    let apps = current.apps.filter(app => !(body.remove ?? []).some(typed => programOf(typed) === app.program));
    for (const typed of body.add ?? []) {
      const program = programOf(typed);
      if (neverDesktopProgram(program)) throw new CliFailure('failed', 'Orglet không bao giờ dùng ứng dụng này.');
      const windows = open.filter(window => window.program === program);
      if (windows.length > 0 && windows.every(window => window.elevated)) throw new CliFailure('failed', 'Ứng dụng này chạy bằng quyền quản trị nên Tí không dùng được.');
      if (apps.some(app => app.program === program)) continue;
      apps = [...apps, { program, name: (windows[0]?.title ?? program).slice(0, 120), addedAt: new Date().toISOString() }];
    }
    const desktop = parsedOrRefused(() => DesktopChoice.parse({ apps }));
    await this.request('setDesktop', { taskId: task.id, desktop });
    if (body.mode) await this.request('setToolCapabilities', { taskId: task.id, capabilities: ToolCapabilities.parse(capabilitiesWithDesktopLevel(task.toolCapabilities ?? [], body.mode)) });
    return { subject: name };
  }

  /**
   * Saves servers from a file whose secrets are only named. The values typed at the terminal arrive in `secrets`, go to the
   * same main function Settings' form uses, and are dropped; any message that could carry one is cleaned before it leaves.
   */
  private async saveMcpServers(body: Extract<SetupBody, { action: 'mcp-save' | 'mcp-import' }>): Promise<SetupOutcome> {
    if (body.action === 'mcp-save' && body.servers.length !== 1) throw new CliFailure('invalid', 'Tệp để lưu một máy chủ chỉ được có đúng một máy chủ. Dùng mcp-import cho nhiều máy chủ.');
    const existing = (await this.workspace()).mcpServers;
    const typedValues = Object.values(body.secrets ?? {}).flatMap(entries => Object.values(entries));
    const saved: string[] = [];
    const skipped: string[] = [];
    for (const server of body.servers) {
      try {
        const known = existing.find(item => item.name.toLowerCase() === server.name.toLowerCase());
        await this.app().saveMcpServer(draftWithSecrets(server, body.secrets?.[server.name] ?? {}, known?.id));
        saved.push(server.name);
      } catch (error) {
        const reason = scrubbed(error, typedValues);
        if (body.action === 'mcp-save') throw new CliFailure('failed', reason);
        skipped.push(`${server.name}: ${reason}`);
      }
    }
    if (saved.length === 0) throw new CliFailure('failed', skipped.join(' '));
    return { subject: saved.join(', '), report: [...saved.map(item => `+ ${item}`), ...skipped.map(item => `! ${item}`)] };
  }

  /** The chat a request names: its row when it has one, else the orglet or crew whose empty chat it is. */
  private async chatTarget(workspace: Workspace, request: { to?: string; chat?: string }): Promise<{ target: ChatTarget; name: string; task?: Task }> {
    if (request.to !== undefined && request.chat === undefined) {
      const chat = matchChat(request.to, chatsOf(workspace));
      const task = liveChatTask(workspace, chat);
      if (task) return { target: { taskId: task.id }, name: chat.name, task };
      return { target: chat.kind === 'team' ? { teamId: chat.id } : { workerId: chat.id }, name: chat.name };
    }
    const { chat, task } = targetChat(workspace, request);
    return { target: { taskId: task.id }, name: chat.name, task };
  }

  private async existingChat(workspace: Workspace, request: { to?: string; chat?: string }): Promise<{ task: Task; name: string }> {
    const { chat, task } = targetChat(workspace, request);
    return { task, name: chat.name };
  }

  private async setTools(body: Extract<SetupBody, { action: 'tools' }>): Promise<SetupOutcome> {
    const capabilities = ToolCapabilities.parse(body.capabilities);
    const { target, name, task } = await this.chatTarget(await this.workspace(), body);
    await this.request('setToolCapabilities', { ...target, capabilities });
    const previous = task?.toolCapabilities;
    return { subject: name, ...(task && previous ? { undo: { kind: 'restore-tools', taskId: task.id, capabilities: previous } } : {}) };
  }

  private async grantFolder(body: Extract<SetupBody, { action: 'folder' }>): Promise<SetupOutcome> {
    const permissions = WorkspacePermissions.parse(body.permissions);
    const directory = await checkedFolder(body.path, this.places());
    const { target, name, task } = await this.chatTarget(await this.workspace(), body);
    const previous = task ? await this.request('workspaceAccess', { taskId: task.id }) as WorkspaceGrantView | null : null;
    const grant = GrantWorkspace.parse({ ...target, permissions, directory });
    await this.request('grantWorkspace', grant);
    const keptNothing = !previous || previous.revoked;
    return { subject: name, ...(task && keptNothing ? { undo: { kind: 'revoke-folder', taskId: task.id } } : {}) };
  }

  private async grantScheduleFolder(body: Extract<SetupBody, { action: 'schedule-folder' }>): Promise<SetupOutcome> {
    const directory = await checkedFolder(body.path, this.places());
    const grant = body.kind === 'watch'
      ? GrantWorkspace.parse({ watch: true, permissions: ['read'], directory })
      : GrantWorkspace.parse({ routine: true, permissions: WorkspacePermissions.parse(body.permissions), directory });
    await this.request('grantWorkspace', grant);
    return { subject: body.kind === 'watch' ? 'watch' : 'work' };
  }

  private async setFolderLevel(body: Extract<SetupBody, { action: 'folder-level' }>): Promise<SetupOutcome> {
    const permissions = WorkspacePermissions.parse(body.permissions);
    const { target, name, task } = await this.chatTarget(await this.workspace(), body);
    const previous = task ? await this.request('workspaceAccess', { taskId: task.id }) as WorkspaceGrantView | null : null;
    await this.request('setWorkspaceLevel', { ...target, permissions });
    return { subject: name, ...(task && previous && !previous.revoked ? { undo: { kind: 'restore-level', taskId: task.id, permissions: previous.permissions } } : {}) };
  }

  private async revokeFolder(body: Extract<SetupBody, { action: 'folder-revoke' }>): Promise<SetupOutcome> {
    const { target, name } = await this.chatTarget(await this.workspace(), body);
    await this.request('revokeWorkspace', target);
    return { subject: name };
  }

  private async revokeFile(body: Extract<SetupBody, { action: 'file-revoke' }>): Promise<SetupOutcome> {
    await this.request('revoke', { id: body.sourceId });
    return {};
  }

  private findMcpServer(workspace: Workspace, name: string) {
    const server = workspace.mcpServers.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!server) throw new CliFailure('not_found', 'Không tìm thấy máy chủ MCP với tên này.');
    return server;
  }

  private async enableMcp(body: Extract<SetupBody, { action: 'mcp-enable' }>): Promise<SetupOutcome> {
    const server = this.findMcpServer(await this.workspace(), body.server);
    await this.request('setMcpServerEnabled', { id: server.id, enabled: body.enabled });
    return { subject: server.name, undo: { kind: 'restore-mcp-enabled', serverId: server.id, enabled: server.enabled } };
  }

  private async grantMcp(body: Extract<SetupBody, { action: 'mcp-grant' }>): Promise<SetupOutcome> {
    const workspace = await this.workspace();
    const server = this.findMcpServer(workspace, body.server);
    const { task, name } = await this.existingChat(workspace, body);
    const tool = body.tool ?? null;
    await this.request('setMcpGrant', { taskId: task.id, serverId: server.id, tool, allowed: body.allowed });
    return { subject: `${name} / ${server.name}`, undo: { kind: 'restore-mcp-grant', taskId: task.id, serverId: server.id, tool, allowed: !body.allowed } };
  }

  private async removeMcp(body: Extract<SetupBody, { action: 'mcp-remove' }>): Promise<SetupOutcome> {
    const server = this.findMcpServer(await this.workspace(), body.server);
    await this.app().removeMcpServer(server.id);
    return { subject: server.name };
  }

  private async signInMcp(body: Extract<SetupBody, { action: 'mcp-sign-in' }>): Promise<SetupOutcome> {
    const server = this.findMcpServer(await this.workspace(), body.server);
    if (body.cancel) this.app().cancelMcpSignIn(server.id);
    else await this.app().signInMcpServer(server.id);
    return { subject: server.name };
  }

  private async setLimit(body: Extract<SetupBody, { action: 'limit' }>): Promise<SetupOutcome> {
    const workspace = await this.workspace();
    const { task, name } = await this.existingChat(workspace, body);
    if (task.sideOf || task.routineId) throw new CliFailure('failed', 'Chỉ đổi được giới hạn của chat chính hoặc kênh.');
    await this.request('updateTask', { id: task.id, title: task.title ?? '', assignee: assigneeOf(workspace, task, undefined), budgetMicros: body.budgetMicros });
    return { subject: name };
  }

  private async setSpaceTools(body: Extract<SetupBody, { action: 'space-tools' }>): Promise<SetupOutcome> {
    const workspace = await this.workspace();
    const space = spaceNamed(workspace, body.space);
    const defaults = SpaceDefaults.parse({ capabilities: body.capabilities });
    await this.request('updateSpace', { id: space.id, name: space.name, ...(space.color ? { color: space.color } : {}), orgletIds: space.orgletIds, categories: space.categories, defaults });
    return { subject: space.name };
  }

  private async setDecisionModel(body: Extract<SetupBody, { action: 'decision-model' }>): Promise<SetupOutcome> {
    await this.request('saveDecisionModelSetting', commands.saveDecisionModelSetting.parse(body.entries));
    return {};
  }

  private async setSwitch(body: Extract<SetupBody, { action: 'switch' }>): Promise<SetupOutcome> {
    await this.app().setSwitch(body.what, body.enabled);
    return { subject: body.what };
  }

  private async backup(body: Extract<SetupBody, { action: 'backup' }>): Promise<SetupOutcome> {
    const path = await checkedBackupPath(body.path, this.places());
    await this.app().writeText(path, String(await this.request('backupExport', undefined)));
    return {};
  }

  private async startSync(body: Extract<SetupBody, { action: 'sync' }>): Promise<SetupOutcome> {
    const label = this.app().account.label();
    if (!label) throw new CliFailure('failed', 'Chưa đăng nhập tài khoản CodePawl.');
    if (body.confirm.trim().toLowerCase() !== label.trim().toLowerCase()) throw new CliFailure('failed', 'Gõ đúng tên tài khoản để xác nhận nối máy này.');
    await this.app().startSync(body.choice);
    return {};
  }

  private async changeBrowserProfile(body: Extract<SetupBody, { action: 'browser-profile' }>): Promise<SetupOutcome> {
    const profiles = await this.app().browserProfiles.list();
    const profile = profiles.find(item => item.name.toLowerCase() === body.profile.toLowerCase());
    if (!profile) throw new CliFailure('not_found', 'Không tìm thấy hồ sơ trình duyệt với tên này.');
    if (body.confirm.trim() !== profile.name) throw new CliFailure('failed', 'Gõ đúng tên hồ sơ để xác nhận.');
    if (body.change === 'clear') await this.app().browserProfiles.clear(profile.id);
    else await this.app().browserProfiles.remove(profile.id);
    return { subject: profile.name };
  }

  private async changeHarness(body: Extract<SetupBody, { action: 'harness' }>): Promise<SetupOutcome> {
    const harness = HarnessCatalogId.parse(body.harness);
    if (body.change === 'add') {
      if (!body.label) throw new CliFailure('invalid', 'Gõ tên cho tài khoản mới.');
      await this.request('saveHarnessAccount', { harness, label: body.label });
    } else if (body.change === 'cancel') {
      await this.request('cancelHarnessSignIn', { harness });
    } else {
      const id = await this.harnessAccountId(harness, body.account);
      const command = { remove: 'removeHarnessAccount', select: 'selectHarnessAccount', 'sign-in': 'startHarnessSignIn', 'sign-out': 'signOutHarness' }[body.change];
      await this.request(command, { harness, id });
    }
    return { subject: harness };
  }

  private async harnessAccountId(harness: string, account: string | undefined): Promise<string> {
    if (!account) throw new CliFailure('invalid', 'Gõ tên tài khoản của harness này.');
    const infos = await this.request('harnesses', { refresh: false }) as HarnessInfo[];
    const accounts = infos.find(info => info.id === harness)?.accounts ?? [];
    const found = accounts.find(item => item.label.toLowerCase() === account.toLowerCase() || item.id === account);
    if (!found) throw new CliFailure('not_found', 'Không tìm thấy tài khoản này của harness.');
    return found.id;
  }

  private async changeAccount(body: Extract<SetupBody, { action: 'account' }>): Promise<SetupOutcome> {
    const { account } = this.app();
    if (body.change === 'sign-in') await account.signIn();
    else if (body.change === 'sign-out') await account.signOut();
    else if (body.change === 'cancel') account.cancelSignIn();
    else await account.reopenSignIn();
    return {};
  }

  /** The connection a typed name means: an API provider by its id, or a custom connection by its name. */
  private async providerOf(typed: string): Promise<string> {
    if (ApiProvider.safeParse(typed).success) return typed;
    if (isCustomProvider(typed)) return CredentialProvider.parse(typed);
    const workspace = await this.workspace();
    const connection = (workspace.customConnections ?? []).find(item => item.name.toLowerCase() === typed.toLowerCase());
    if (!connection) throw new CliFailure('not_found', 'Không tìm thấy kết nối này. Gõ tên nhà cung cấp (như openai) hoặc tên kết nối tùy chỉnh.');
    return customProviderId(connection.id);
  }

  private async changeCustomConnection(body: Extract<SetupBody, { action: 'custom-connection' }>): Promise<SetupOutcome> {
    const workspace = await this.workspace();
    const existing = (workspace.customConnections ?? []).find(item => item.name.toLowerCase() === body.name.toLowerCase());
    if (body.change === 'delete') {
      if (!existing) throw new CliFailure('not_found', 'Không tìm thấy kết nối tùy chỉnh với tên này.');
      await this.request('deleteCustomConnection', { id: existing.id });
      await this.app().forgetKey(customProviderId(existing.id));
      return { subject: existing.name };
    }
    if (!body.baseUrl) throw new CliFailure('invalid', 'Gõ địa chỉ gốc (base URL) của kết nối.');
    await this.request('saveCustomConnection', { ...(existing ? { id: existing.id } : {}), name: body.name, baseUrl: body.baseUrl });
    return { subject: body.name };
  }

  private async disconnect(body: Extract<SetupBody, { action: 'disconnect' }>): Promise<SetupOutcome> {
    const provider = await this.providerOf(body.provider);
    await this.app().disconnect(provider);
    return { subject: body.provider };
  }

  private async removeSearchKey(body: Extract<SetupBody, { action: 'search-key-remove' }>): Promise<SetupOutcome> {
    await this.app().removeSearchKey(WebSearchKeyProvider.parse(body.provider));
    return { subject: body.provider };
  }

  /** The key goes to the credential store the window's Connect uses; a failure says only that it was not saved. */
  private async connect(body: Extract<SetupBody, { action: 'connect' }>): Promise<SetupOutcome> {
    const provider = await this.providerOf(body.provider);
    if (body.secret === undefined && provider !== 'ollama') throw new CliFailure('invalid', 'Thiếu khóa để lưu.');
    await this.guardingSecret(() => this.app().connect(provider, body.secret?.trim()));
    return { subject: body.provider };
  }

  private async saveSearchKey(body: Extract<SetupBody, { action: 'search-key' }>): Promise<SetupOutcome> {
    const provider = WebSearchKeyProvider.parse(body.provider);
    if (body.secret === undefined) throw new CliFailure('invalid', 'Thiếu khóa để lưu.');
    const secret = body.secret.trim();
    await this.guardingSecret(() => this.app().saveSearchKey(provider, secret));
    return { subject: body.provider };
  }

  /** Whatever the store throws, the terminal hears one sentence: an error message must never carry the key. */
  private async guardingSecret(save: () => Promise<void>): Promise<void> {
    try {
      await save();
    } catch {
      throw new CliFailure('failed', KEY_NOT_SAVED);
    }
  }

  private places() {
    const { dataFolder, homeFolder } = this.app();
    return { dataFolder, homeFolder };
  }

  /** Takes a grant back from Settings. Runs only the shapes in `TerminalUndo`, checked again here. */
  async undo(recipe: TerminalUndo): Promise<void> {
    const undo = TerminalUndo.parse(recipe);
    switch (undo.kind) {
      case 'revoke-folder':
        await this.request('revokeWorkspace', { taskId: undo.taskId });
        return;
      case 'restore-tools':
        await this.request('setToolCapabilities', { taskId: undo.taskId, capabilities: ToolCapabilities.parse(undo.capabilities) });
        return;
      case 'restore-level':
        await this.request('setWorkspaceLevel', { taskId: undo.taskId, permissions: WorkspacePermissions.parse(undo.permissions) });
        return;
      case 'restore-mcp-enabled':
        await this.request('setMcpServerEnabled', { id: undo.serverId, enabled: undo.enabled });
        return;
      case 'restore-mcp-grant':
        await this.request('setMcpGrant', { taskId: undo.taskId, serverId: undo.serverId, tool: undo.tool, allowed: undo.allowed });
        return;
    }
  }
}

