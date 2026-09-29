import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Puts three fake CLIs in `<directory>/bin` so a smoke always sees a logged-out Claude Code, an unreadable Codex login
// probe and a Gemini CLI whose empty config folder (GEMINI_CLI_HOME, set by the caller) holds no sign-in. Cursor stays
// whatever the machine has (usually not installed). Put the folder first on PATH. Nothing here starts a harness run.
export async function fakeHarnessPath(directory) {
  const bin = join(directory, 'bin');
  await mkdir(bin, { recursive: true });
  const node = process.execPath;
  const shim = async (name, source) => {
    const script = join(bin, `${name}.mjs`);
    await writeFile(script, source);
    await writeFile(join(bin, `${name}.cmd`), `@echo off\r\n"${node}" "${script}" %*\r\n`);
    await writeFile(join(bin, name), `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`, { mode: 0o755 });
  };
  await shim('claude', `
    const args = process.argv.slice(2);
    if (args[0] === '--version') { process.stdout.write('2.1.10 (Claude Code)\\n'); process.exit(0); }
    if (args[0] === 'auth' && args[1] === 'status') {
      process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
      process.exit(0);
    }
    process.exit(1);
  `);
  await shim('codex', `
    const args = process.argv.slice(2);
    if (args[0] === '--version') { process.stdout.write('codex-cli 0.154.0\\n'); process.exit(0); }
    if (args[0] === 'login' && args[1] === 'status') {
      process.stderr.write('Error checking login status\\n');
      process.exit(2);
    }
    process.exit(1);
  `);
  // Gemini CLI has no status command; Orglet reads its sign-in from GEMINI_CLI_HOME, which the caller leaves empty.
  await shim('gemini', `
    const args = process.argv.slice(2);
    if (args[0] === '--version') { process.stdout.write('0.61.0\\n'); process.exit(0); }
    process.exit(1);
  `);
  return bin;
}
