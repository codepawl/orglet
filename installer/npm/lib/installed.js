import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Finds the `orglet` command the installed app provides, so this package forwards to it instead of shadowing it.
 * On Windows the app keeps `%LOCALAPPDATA%\Orglet\bin\orglet.cmd` (apps/desktop/src/main/cli-path.ts): it sets two
 * variables and starts Orglet.exe on the app's CLI script. Reading those three values and starting Orglet.exe directly
 * avoids passing the person's arguments through cmd.exe, whose quoting would change them.
 */

/** Where the app's command lives for this platform. */
export function appCommandPath(platform, environment) {
  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA;
    return localAppData ? join(localAppData, 'Orglet', 'bin', 'orglet.cmd') : undefined;
  }
  if (platform === 'darwin') return '/Applications/Orglet.app/Contents/Resources/bin/orglet';
  return undefined;
}

/** A path from the batch file with `%LOCALAPPDATA%` and friends filled in and `%%` read as one `%`. */
export function expandBatchPath(value, environment) {
  return value.replace(/%%|%([A-Za-z_]+)%/g, (match, name) => {
    if (!name) return '%';
    const folder = environment[name]?.replace(/[\\/]+$/, '');
    return folder ?? match;
  });
}

/** What the app's `orglet.cmd` starts, or undefined for a file the app did not write this way. */
export function shimLaunchOf(content, environment) {
  const userData = /^set "ORGLET_USER_DATA=(.*)"\r?$/m.exec(content)?.[1];
  const line = /^"([^"]+)" "([^"]+)" %\*\r?$/m.exec(content);
  if (userData === undefined || !line) return undefined;
  return {
    executable: expandBatchPath(line[1], environment),
    cliScript: expandBatchPath(line[2], environment),
    userData: expandBatchPath(userData, environment),
  };
}

/**
 * Whether Setup installed Orglet for this Windows user even though its command is gone (Settings → About → Remove from
 * PATH deletes it). Setup keeps Squirrel's `Update.exe` next to the app folders.
 */
export function windowsAppInstalled(environment) {
  const localAppData = environment.LOCALAPPDATA;
  return Boolean(localAppData) && existsSync(join(localAppData, 'Orglet', 'Update.exe'));
}

/**
 * How to run the installed app's command: `{ command, args, env }` to spawn with the person's arguments appended,
 * or undefined when Orglet is not installed (or its command was removed from PATH in Settings → About).
 */
export function installedLaunch(platform, environment) {
  const path = appCommandPath(platform, environment);
  if (!path || !existsSync(path)) return undefined;
  if (platform !== 'win32') return { command: path, args: [], env: environment };
  const launch = shimLaunchOf(readFileSync(path, 'utf8'), environment);
  if (!launch || !existsSync(launch.executable)) return undefined;
  return {
    command: launch.executable,
    args: [launch.cliScript],
    env: { ...environment, ORGLET_USER_DATA: launch.userData, ELECTRON_RUN_AS_NODE: '1' },
  };
}
