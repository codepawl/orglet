import { z } from 'zod';

export const StartWorkspaceProcess = z.object({
  program: z.enum(['node', 'shell']),
  arguments: z.array(z.string().max(12000)).max(64),
  timeoutMs: z.number().int().min(100).max(120000),
}).strict().refine(input => input.program !== 'shell' || input.arguments.length === 1,
  'Lệnh shell cần đúng một chuỗi lệnh.');
export const WorkspaceProcessId = z.object({ processId: z.uuid() }).strict();
export const WorkspaceProcessStatus = WorkspaceProcessId.extend({ waitMs: z.number().int().min(0).max(10000) });
export const WorkspaceProcessOutput = WorkspaceProcessId.extend({
  stream: z.enum(['stdout', 'stderr']), offset: z.number().int().min(0).max(262144),
});
export const WorkspaceProcess = z.object({
  id: z.uuid(), runId: z.uuid(), command: StartWorkspaceProcess,
  state: z.enum(['running', 'exited', 'cancelled', 'timeout', 'output_limit', 'uncertain']),
  exitCode: z.number().int().nullable(), stdout: z.string().max(262144), stderr: z.string().max(262144),
  error: z.string().max(4000).optional(),
  /** How many file changes the run's copy had when this command started (COD-189). Absent on older records. */
  copyEditsAtStart: z.number().int().min(0).optional(),
}).strict();
export type WorkspaceProcess = z.infer<typeof WorkspaceProcess>;
export type StartWorkspaceProcess = z.infer<typeof StartWorkspaceProcess>;

export function describeCommand(command: StartWorkspaceProcess, maxLength = 1000): string {
  return [command.program, ...command.arguments].join(' ').slice(0, maxLength);
}

/**
 * What a worker is told when its command could not reach a loopback address (COD-193). The Windows sandbox denies
 * every loopback connection, even to a server the same command started, and Orglet cannot open loopback for one
 * run only (docs/technical-guide.md, "Commands and loopback"), so the worker is pointed at in-process testing.
 */
export const LOOPBACK_BLOCKED_HINT = 'This command tried to connect to a loopback address (127.0.0.1, ::1 or localhost). The sandbox blocks every loopback connection, including to a server this or an earlier command started, and Orglet cannot enable it. Test the app in-process instead: import the app or its request handler and call it directly, or use a test client that injects requests without opening a socket (supertest-style injection, or a Node http handler called with a mock request and response). Do not retry the connection.';

/** A connect failure naming a loopback address, as Node (`connect EACCES 127.0.0.1:3123`) and curl print it. */
const LOOPBACK_FAILURE = /(EACCES|ECONNREFUSED|WinError 10013|WinError 10061|Failed to connect to)[^\n]{0,80}?(127\.0\.0\.1|localhost|::1)/i;

export function loopbackBlockedHint(output: Pick<WorkspaceProcess, 'stdout' | 'stderr'>): string | null {
  const blocked = LOOPBACK_FAILURE.test(output.stdout) || LOOPBACK_FAILURE.test(output.stderr);
  return blocked ? LOOPBACK_BLOCKED_HINT : null;
}
