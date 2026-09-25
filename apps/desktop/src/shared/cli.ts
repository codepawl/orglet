/**
 * What Settings shows about the `orglet` command (COD-234). The renderer gets how the command can be installed and
 * whether it is, never a path it could hand back: adding and removing are two fixed IPC calls with no arguments
 * beyond on or off.
 */
export type CliInstallState =
  /** A packaged Windows build: Orglet writes the shim and edits the user Path itself. */
  | { mode: 'windows'; installed: boolean }
  /** A packaged macOS or Linux build: the person adds the command with the line shown. */
  | { mode: 'manual'; command: string }
  /** Running from source: the command works from a packaged install; `pnpm orglet` tries it from the repository. */
  | { mode: 'dev' };

/** A chat the `orglet open --to` command asks the window to show. */
export type OpenChatTarget = { kind: 'worker' | 'team'; id: string };
