import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

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

// A packaged app launched with this environment never reads this machine's sign-ins or asks a vendor for plan usage.
// The fake CLIs go first on PATH, but a real executable found anywhere outranks a .cmd shim (COD-170), so every CLI's
// own config folder also points at an empty one: a real CLI still found under the home folder reports itself signed
// out. APPDATA and LOCALAPPDATA hide the npm installs, the CLIs the Claude, Codex and Cursor apps bundle, and Cursor
// Agent's sign-in. USERPROFILE stays real: Electron cannot start without it.
export async function isolatedHarnessEnvironment(directory) {
  const bin = await fakeHarnessPath(directory);
  const emptyFolder = async name => {
    const folder = join(directory, name);
    await mkdir(folder, { recursive: true });
    return folder;
  };
  const pathValue = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
  const env = {
    ...process.env,
    APPDATA: directory,
    LOCALAPPDATA: await emptyFolder('local-app-data'),
    PATH: pathValue,
    Path: pathValue,
    GEMINI_CLI_HOME: await emptyFolder('gemini-home'),
    CODEX_HOME: await emptyFolder('codex-home'),
    CLAUDE_CONFIG_DIR: await emptyFolder('claude-config'),
    CURSOR_CONFIG_DIR: await emptyFolder('cursor-config'),
    XDG_CONFIG_HOME: await emptyFolder('xdg-config'),
    // The empty profile counts as a local install, so the first-run account question does not cover the app (COD-337).
    ORGLET_SKIP_ACCOUNT_CHOICE: '1',
  };
  // Variables a CLI would treat as a sign-in on their own.
  const signInVariables = [
    'ELECTRON_RUN_AS_NODE',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'CURSOR_API_KEY',
    'CURSOR_AUTH_TOKEN',
    'GEMINI_API_KEY',
    'GOOGLE_GENAI_USE_GCA',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_GEMINI_BASE_URL',
    'GEMINI_CLI_USE_COMPUTE_ADC',
    'CLOUD_SHELL',
  ];
  for (const name of signInVariables) delete env[name];
  return { bin, env };
}
