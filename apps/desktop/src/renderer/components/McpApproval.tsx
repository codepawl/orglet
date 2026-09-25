import { useState } from 'react';
import { Blocks, Check, CheckCheck, ShieldCheck, X } from 'lucide-react';
import type { TaskDetail, Worker, Workspace } from '../../shared/contracts';
import type { McpApproval, McpApprovalChoice, McpGrant } from '../../shared/mcp';
import { Button } from './ui';
import { SwitchField } from './Switch';
import { t, tMessage, translated } from '../i18n';
import { orglet } from '../api';
import { toast } from './toast';

/** What each answer to an approval card reads as in the chat's decision history. */
export const approvalAnswerLabels: Record<McpApprovalChoice, string> = translated({
  once: 'Đã cho phép một lần',
  tool: 'Luôn cho phép công cụ này trong chat',
  server: 'Luôn cho phép máy chủ này trong chat',
  refuse: 'Đã từ chối',
});

/**
 * The card a solo chat shows when its orglet wants to call an MCP tool the chat has not allowed yet (COD-241): who
 * wants to call which tool of which server, the arguments it chose, and four answers. "Always" lasts for this chat
 * only and can be taken back in Details.
 */
export function McpApprovalCard({ approval, workerName, busy, onAnswer, sideThread = false }: { approval: McpApproval; workerName: string; busy: boolean; onAnswer: (choice: McpApprovalChoice) => void;
  /** A side thread can never allow more than its main chat (COD-247), so it offers only once and refuse. */ sideThread?: boolean }) {
  return <div className="mcp-approval" role="group" aria-label={t('Cho phép công cụ MCP')}>
    <p role="status" className="mcp-approval-question"><Blocks size={16} aria-hidden="true" />
      <span>{t('{0} muốn dùng {1} của {2}.', [workerName, approval.tool, approval.serverName])}</span></p>
    {approval.arguments && approval.arguments !== '{}' && <pre className="mcp-arguments" aria-label={t('Tham số')}>{approval.arguments}</pre>}
    <div className="actions">
      <Button variant="primary" disabled={busy} onClick={() => onAnswer('once')}><Check size={16} />{t('Cho phép một lần')}</Button>
      {!sideThread && <Button variant="outline" disabled={busy} onClick={() => onAnswer('tool')}><CheckCheck size={16} />{t('Luôn cho phép công cụ này')}</Button>}
      {!sideThread && <Button variant="outline" disabled={busy} onClick={() => onAnswer('server')}><ShieldCheck size={16} />{t('Luôn cho phép {0}', [approval.serverName])}</Button>}
      <Button variant="ghost" disabled={busy} onClick={() => onAnswer('refuse')}><X size={16} />{t('Từ chối')}</Button>
    </div>
    <p className="muted">{sideThread ? t('Chat phụ chỉ cho phép từng lần. Muốn luôn cho phép, bật ở chat chính.') : t('“Luôn cho phép” chỉ áp dụng cho chat này; tắt lại trong Chi tiết → Quyền công cụ.')}</p>
  </div>;
}

/**
 * The chat's standing MCP permissions in Details (COD-241): one switch per server its orglets may use (on = every
 * tool without asking), and one per tool allowed on its own. Turning one off stops nothing; the next call asks again.
 */
export function McpChatGrants({ detail, workers, workspace }: { detail: TaskDetail; workers: readonly Worker[]; workspace: Workspace }) {
  const [busy, setBusy] = useState(false);
  const serverIds = new Set(workers.flatMap(worker => worker.mcpServerIds ?? []));
  const servers = (workspace.mcpServers ?? []).filter(server => serverIds.has(server.id));
  const grants = detail.task.mcpGrants ?? [];
  const toolGrants = grants.filter(grant => grant.tool !== null && servers.some(server => server.id === grant.serverId));
  if (!servers.length) return null;
  const change = (grant: McpGrant, allowed: boolean) => {
    setBusy(true);
    void orglet.call('setMcpGrant', { taskId: detail.task.id, ...grant, allowed })
      .catch(error => toast(tMessage(String(error)), 'error', t('Quyền công cụ')))
      .finally(() => setBusy(false));
  };
  return <div className="permissions mcp-grants">
    <p className="permission-folder-title"><Blocks size={15} aria-hidden="true" />{t('Máy chủ MCP')}</p>
    {servers.map(server => <SwitchField key={server.id} checked={grants.some(grant => grant.serverId === server.id && grant.tool === null)} disabled={busy}
      onChange={allowed => change({ serverId: server.id, tool: null }, allowed)} description={t('Dùng mọi công cụ mà không hỏi lại trong chat này.')}>
      {server.name}
    </SwitchField>)}
    {toolGrants.map(grant => {
      const server = servers.find(item => item.id === grant.serverId)!;
      return <SwitchField key={`${grant.serverId}:${grant.tool}`} checked disabled={busy} onChange={allowed => change(grant, allowed)}
        description={t('Công cụ của {0}, không hỏi lại trong chat này.', [server.name])}>{grant.tool}</SwitchField>;
    })}
  </div>;
}
