import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrowserInfo, BrowserKind } from '../shared/browser';

/** The browser Orglet drives, with the executable only the host process ever sees. */
export type DetectedBrowser = BrowserInfo & { executable: string };

type Candidate = { kind: BrowserKind; executable: string };

const NAMES: Record<BrowserKind, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge' };

/**
 * Where Chrome and Edge install themselves, Chrome first. A fresh Edge profile signs in to Microsoft sites with the
 * Windows account on its own (measured for COD-261), so a signed-in profile the person makes is cleaner on Chrome.
 * Only the standard install folders are checked; nothing is searched for.
 */
function candidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Candidate[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = env.LOCALAPPDATA;
    const chrome = [
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...(localAppData ? [join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
    ];
    const edge = [
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    return [...chrome.map(executable => ({ kind: 'chrome' as const, executable })), ...edge.map(executable => ({ kind: 'edge' as const, executable }))];
  }
  if (platform === 'darwin') {
    return [
      { kind: 'chrome', executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { kind: 'edge', executable: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    ];
  }
  return [
    { kind: 'chrome', executable: '/usr/bin/google-chrome' },
    { kind: 'chrome', executable: '/usr/bin/google-chrome-stable' },
    { kind: 'edge', executable: '/usr/bin/microsoft-edge' },
  ];
}

/** On Windows the installed version is the name of the folder next to the executable, such as 153.0.4234.48. */
function versionNextTo(executable: string, list: (path: string) => string[]): string | null {
  try {
    const versions = list(dirname(executable)).filter(name => /^\d+\.\d+\.\d+\.\d+$/.test(name));
    versions.sort((first, second) => compareVersions(second, first));
    return versions[0] ?? null;
  } catch {
    return null;
  }
}

function compareVersions(first: string, second: string): number {
  const firstParts = first.split('.').map(Number);
  const secondParts = second.split('.').map(Number);
  for (let index = 0; index < firstParts.length; index++) {
    if (firstParts[index] !== secondParts[index]) return firstParts[index] - secondParts[index];
  }
  return 0;
}

export function detectBrowser(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync, list: (path: string) => string[] = path => readdirSync(path)): DetectedBrowser | null {
  for (const candidate of candidates(platform, env)) {
    if (!exists(candidate.executable)) continue;
    const version = platform === 'win32' ? versionNextTo(candidate.executable, list) : null;
    return { kind: candidate.kind, name: NAMES[candidate.kind], version, executable: candidate.executable };
  }
  return null;
}
