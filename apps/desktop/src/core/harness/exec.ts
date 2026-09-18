import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessId } from '../../shared/harness';
import { cleanEnv, commandLine } from './detect';
import { ClaudeStreamParser } from './claudeStream';
import { CodexStreamParser } from './codexStream';
import { claudeLimitWarning, claudeRejection, detectUsageLimit, usageLimitMessage, type ClaudeRateLimitInfo } from '../usageLimits';
import type { HarnessProgress } from '../../shared/progress';

export type HarnessRequest = {
  harness: HarnessId;
  executable: string;
  cwd: string;
  prompt: string;
  schema: object;
  signal: AbortSignal;
  maxBudgetUsd: number;
  /** Called as a streaming harness thinks, uses tools and writes. Harnesses that do not stream never call it. */
  onProgress?: (progress: HarnessProgress) => void;
};
export type HarnessResult = {
  output: unknown;
  costUsd: number | null;
  /** Something the user should know even though the run worked, such as a plan close to its limit. */
  notice?: string;
};
export type HarnessExecutor = (request: HarnessRequest) => Promise<HarnessResult>;
export class HarnessError extends Error {}

export const HARNESS_TIMEOUT_MS = 15 * 60_000;
// Streamed output repeats the answer as small events, so it is larger than the answer itself.
const OUTPUT_LIMIT = 32 * 1024 * 1024;
const SCHEMA_FILE = 'orglet-report.schema.json';
const LAST_MESSAGE_FILE = 'orglet-last-message.json';

/**
 * Read-only review settings per harness. Claude Code: restricted mode confines file tools to the task folder and
 * removes command tools; safe mode skips the user's hooks, plugins, skills and CLAUDE.md. Codex: its only file access
 * is shell commands, which its Windows read-only sandbox rejects, so the runner inlines source text in the prompt and
 * the shell tools are disabled outright; user config is ignored (no MCP servers or plugins) and apps/browser/computer
 * use are off. Cursor Agent: ask mode + sandbox, never --force/--yolo; report schema is embedded in the prompt.
 */
export function harnessArgs(request: Pick<HarnessRequest, 'harness' | 'cwd' | 'schema' | 'maxBudgetUsd'>): string[] {
  if (request.harness === 'claude-code') {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--json-schema', JSON.stringify(request.schema), '--restricted', '--safe-mode', '--strict-mcp-config', '--tools', 'Read,Grep,Glob', '--no-session-persistence', '--permission-prompts', 'none', '--disable-slash-commands', '--max-budget-usd', request.maxBudgetUsd.toFixed(4)];
  }
  if (request.harness === 'cursor') {
    return ['-p', '--mode=ask', '--sandbox', 'enabled', '--trust', '--workspace', request.cwd, '--output-format', 'json'];
  }
  return ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--disable', 'apps', '--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'shell_tool', '--disable', 'unified_exec', '-C', request.cwd, '--output-schema', join(request.cwd, SCHEMA_FILE), '-o', join(request.cwd, LAST_MESSAGE_FILE), '--json', '-'];
}

const authHint = (harness: HarnessId) => {
  const name = harness === 'claude-code' ? 'Claude Code' : harness === 'codex' ? 'Codex' : 'Cursor Agent';
  return `${name} chưa đăng nhập hoặc phiên đã hết hạn. Mở Cài đặt → Harness trên máy để xem lệnh đăng nhập với đúng đường dẫn, rồi thử lại.`;
};
const looksLikeAuth = (text: string) => /not logged in|please run \/login|please run.*login|token_expired|401 unauthorized|invalid api key|authentication|unauthenticated/i.test(text);

export function parseCursorOutput(stdout: string): HarnessResult {
  let data: unknown;
  try {
    data = JSON.parse(stdout.trim());
  } catch {
    if (looksLikeAuth(stdout)) throw new HarnessError(authHint('cursor'));
    throw new HarnessError('Cursor Agent không trả về JSON hợp lệ.');
  }
  if (looksLikeAuth(stdout)) throw new HarnessError(authHint('cursor'));
  if (data && typeof data === 'object') {
    const record = data as { result?: unknown; error?: string; is_error?: boolean };
    if (record.is_error || typeof record.error === 'string') {
      const message = typeof record.error === 'string' ? record.error : '';
      if (looksLikeAuth(message)) throw new HarnessError(authHint('cursor'));
      throw new HarnessError(`Cursor Agent báo lỗi: ${(message || 'không rõ').slice(0, 500)}`);
    }
    if ('result' in record) {
      const result = record.result;
      if (typeof result === 'string') {
        try {
          return { output: JSON.parse(result), costUsd: null };
        } catch {
          throw new HarnessError('Cursor Agent không trả về báo cáo đúng schema.');
        }
      }
      if (result && typeof result === 'object') return { output: result, costUsd: null };
    }
    return { output: data, costUsd: null };
  }
  throw new HarnessError('Cursor Agent không trả về báo cáo đúng schema.');
}

export function parseClaudeOutput(stdout: string, rateLimit: ClaudeRateLimitInfo | null = null): HarnessResult {
  let data: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number; subtype?: string };
  try {
    data = JSON.parse(stdout.trim());
  } catch {
    const limit = claudeRejection(rateLimit);
    if (limit) throw new HarnessError(usageLimitMessage('Claude Code', limit));
    throw new HarnessError('Claude Code không trả về JSON hợp lệ.');
  }

  const costUsd = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null;
  const notice = claudeLimitWarning(rateLimit) ?? undefined;

  if (data.is_error) {
    const errorText = data.result ?? data.subtype ?? '';
    if (looksLikeAuth(errorText)) throw new HarnessError(authHint('claude-code'));
    const limit = claudeRejection(rateLimit) ?? detectUsageLimit(errorText);
    if (limit) throw new HarnessError(usageLimitMessage('Claude Code', limit));
    throw new HarnessError(`Claude Code báo lỗi: ${(errorText || 'không rõ').slice(0, 500)}`);
  }

  if (data.structured_output !== undefined) return { output: data.structured_output, costUsd, notice };
  try {
    return { output: JSON.parse(data.result ?? ''), costUsd, notice };
  } catch {
    throw new HarnessError('Claude Code không trả về báo cáo đúng schema.');
  }
}

export function parseCodexOutput(jsonl: string, lastMessage: string | null): HarnessResult {
  for (const line of jsonl.split(/\r?\n/)) {
    let event: { type?: string; message?: string; error?: { message?: string } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'turn.failed' && event.type !== 'error') continue;

    const message = event.error?.message ?? event.message ?? '';
    if (looksLikeAuth(jsonl)) throw new HarnessError(authHint('codex'));
    const limit = detectUsageLimit(message);
    if (limit) throw new HarnessError(usageLimitMessage('Codex', limit));
    throw new HarnessError(`Codex báo lỗi: ${message.slice(0, 500)}`);
  }

  if (!lastMessage) throw new HarnessError(looksLikeAuth(jsonl) ? authHint('codex') : 'Codex kết thúc mà không có báo cáo.');
  try {
    return { output: JSON.parse(lastMessage), costUsd: null };
  } catch {
    throw new HarnessError('Codex không trả về báo cáo đúng schema.');
  }
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
}

export const executeHarness: HarnessExecutor = async request => {
  if (request.harness === 'codex') await writeFile(join(request.cwd, SCHEMA_FILE), JSON.stringify(request.schema));
  // Both harnesses print events as they work; each parser turns them into live progress for the window.
  const claudeStream = request.harness === 'claude-code' ? new ClaudeStreamParser(request.onProgress) : null;
  const codexStream = request.harness === 'codex' ? new CodexStreamParser(request.onProgress) : null;
  const prompt = request.harness === 'cursor'
    ? `${request.prompt}\n\nReturn only one JSON object that matches this schema (no markdown fences):\n${JSON.stringify(request.schema)}`
    : request.prompt;

  const stdout = await new Promise<string>((resolve, reject) => {
    request.signal.throwIfAborted();
    const command = commandLine(request.executable, harnessArgs(request));
    const child = spawn(command.file, command.args, { cwd: request.cwd, env: cleanEnv(process.env), windowsHide: true, windowsVerbatimArguments: command.verbatim, stdio: ['pipe', 'pipe', 'pipe'] });
    let outputBytes = 0;
    let collected = '';
    let errorOutput = '';
    let settled = false;

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      settle();
    };
    const abort = () => {
      killTree(child.pid);
      finish(() => reject(request.signal.reason));
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(() => reject(new HarnessError('Harness chạy quá 15 phút và đã bị dừng.')));
    }, HARNESS_TIMEOUT_MS);
    request.signal.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > OUTPUT_LIMIT) {
        killTree(child.pid);
        finish(() => reject(new HarnessError('Output của harness vượt giới hạn.')));
        return;
      }
      if (claudeStream) claudeStream.push(chunk);
      else if (codexStream) codexStream.push(chunk);
      else collected += chunk;
    });
    child.stderr.on('data', chunk => {
      if (errorOutput.length < 64_000) errorOutput += chunk;
    });
    child.on('error', error => finish(() => reject(new HarnessError(`Không chạy được harness: ${error.message}`))));
    child.on('close', code => finish(() => {
      if (claudeStream) {
        const output = claudeStream.finish();
        if (code !== 0 && !output.trim()) {
          reject(claudeExitError(code, errorOutput, claudeStream.rateLimit));
          return;
        }
        resolve(output);
        return;
      }
      if (codexStream) {
        resolve(codexStream.finish());
        return;
      }
      if (code !== 0 && !collected.trim()) {
        if (looksLikeAuth(errorOutput)) reject(new HarnessError(authHint('cursor')));
        else reject(new HarnessError(`Cursor Agent thoát với mã ${code}.`));
        return;
      }
      resolve(collected);
    }));
    child.stdin.end(prompt);
  });

  if (claudeStream) return parseClaudeOutput(stdout, claudeStream.rateLimit);
  if (request.harness === 'cursor') return parseCursorOutput(stdout);
  const lastMessage = await readFile(join(request.cwd, LAST_MESSAGE_FILE), 'utf8').catch(() => null);
  return parseCodexOutput(stdout, lastMessage);
};

/** Why Claude Code stopped without printing a result: signed out, out of plan usage, or an unknown failure. */
function claudeExitError(code: number | null, errorOutput: string, rateLimit: ClaudeRateLimitInfo | null) {
  if (looksLikeAuth(errorOutput)) return new HarnessError(authHint('claude-code'));
  const limit = claudeRejection(rateLimit) ?? detectUsageLimit(errorOutput);
  if (limit) return new HarnessError(usageLimitMessage('Claude Code', limit));
  return new HarnessError(`Claude Code thoát với mã ${code}.`);
}
