import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error The installer is plain JavaScript published on its own (installer/npm); it has no type declarations.
import { installerAssetFor, sha256Of, versionOfTag } from '../../installer/npm/lib/release.js';
// @ts-expect-error Same package.
import { signatureAccepted, sha256OfFile } from '../../installer/npm/lib/verify.js';
// @ts-expect-error Same package.
import { expandBatchPath, installedLaunch, shimLaunchOf } from '../../installer/npm/lib/installed.js';

/*
 * COD-343: `npx @codepawl/orglet` installs the release's Setup only when it matches GitHub's SHA-256 and carries the
 * publisher's valid signature, and once Orglet is installed it starts exactly what the app's own `orglet.cmd` starts.
 */

const releaseAssets = [
  { name: 'orglet-0.9.0-full.nupkg', digest: 'sha256:' + 'a'.repeat(64) },
  { name: 'Orglet-0.9.0.Setup.exe', digest: 'sha256:' + 'B'.repeat(64) },
  { name: 'Orglet-win32-x64-0.9.0.zip', digest: 'sha256:' + 'c'.repeat(64) },
  { name: 'RELEASES', digest: 'sha256:' + 'd'.repeat(64) },
];

const temporaryFolders: string[] = [];
afterEach(async () => {
  for (const folder of temporaryFolders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it('installs from the Windows Setup and nothing on other platforms', () => {
  expect(installerAssetFor(releaseAssets, 'win32')?.name).toBe('Orglet-0.9.0.Setup.exe');
  expect(installerAssetFor(releaseAssets, 'darwin')).toBeUndefined();
  expect(installerAssetFor(releaseAssets, 'linux')).toBeUndefined();
  expect(installerAssetFor([{ name: 'Orglet-evil.Setup.exe.zip' }], 'win32')).toBeUndefined();
});

it('reads the SHA-256 GitHub reports, and nothing from a missing or malformed digest', () => {
  expect(sha256Of(releaseAssets[1])).toBe('b'.repeat(64));
  expect(sha256Of({ name: 'x' })).toBeUndefined();
  expect(sha256Of({ digest: 'sha1:' + 'a'.repeat(40) })).toBeUndefined();
  expect(sha256Of({ digest: 'sha256:abc' })).toBeUndefined();
  expect(versionOfTag('v0.9.0')).toBe('0.9.0');
});

it('hashes a file the way GitHub does', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'orglet-npm-test-'));
  temporaryFolders.push(folder);
  const file = join(folder, 'setup.bin');
  await writeFile(file, 'orglet');
  expect(await sha256OfFile(file)).toBe(createHash('sha256').update('orglet').digest('hex'));
});

it('accepts only a valid signature whose common name is the publisher', () => {
  const subject = 'CN=Open Source Developer Xuan An Nguyen, O=Open Source Developer, L=Ho Chi Minh, C=VN';
  expect(signatureAccepted({ status: 'Valid', subject })).toBe(true);
  expect(signatureAccepted({ status: 'NotSigned', subject: '' })).toBe(false);
  expect(signatureAccepted({ status: 'HashMismatch', subject })).toBe(false);
  expect(signatureAccepted({ status: 'Valid', subject: 'CN=Open Source Developer Xuan An Nguyen Fake, O=Other' })).toBe(false);
  expect(signatureAccepted({ status: 'Valid', subject: 'CN=Someone, O=Open Source Developer Xuan An Nguyen' })).toBe(false);
  expect(signatureAccepted(undefined)).toBe(false);
});

// The app's command file exists on Windows only, and its paths are Windows paths.
it.runIf(process.platform === 'win32')('starts what the app\'s orglet.cmd starts, without cmd.exe', async () => {
  const localAppData = await mkdtemp(join(tmpdir(), 'orglet-npm-local-'));
  temporaryFolders.push(localAppData);
  const appFolder = join(localAppData, 'orglet', 'app-0.9.0');
  await mkdir(appFolder, { recursive: true });
  await writeFile(join(appFolder, 'Orglet.exe'), '');
  await mkdir(join(localAppData, 'Orglet', 'bin'), { recursive: true });
  const shim = [
    '@echo off',
    'setlocal',
    'set "ORGLET_USER_DATA=%APPDATA%\\Orglet"',
    'set "ELECTRON_RUN_AS_NODE=1"',
    '"%LOCALAPPDATA%\\orglet\\app-0.9.0\\Orglet.exe" "%LOCALAPPDATA%\\orglet\\app-0.9.0\\resources\\orglet-cli.cjs" %*',
    'endlocal & exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  await writeFile(join(localAppData, 'Orglet', 'bin', 'orglet.cmd'), shim);
  const environment = { LOCALAPPDATA: localAppData, APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' };

  expect(shimLaunchOf(shim, environment)).toEqual({
    executable: `${localAppData}\\orglet\\app-0.9.0\\Orglet.exe`,
    cliScript: `${localAppData}\\orglet\\app-0.9.0\\resources\\orglet-cli.cjs`,
    userData: 'C:\\Users\\someone\\AppData\\Roaming\\Orglet',
  });
  const launch = installedLaunch('win32', environment);
  expect(launch?.args).toEqual([`${localAppData}\\orglet\\app-0.9.0\\resources\\orglet-cli.cjs`]);
  expect(launch?.env.ELECTRON_RUN_AS_NODE).toBe('1');
  expect(launch?.env.ORGLET_USER_DATA).toBe('C:\\Users\\someone\\AppData\\Roaming\\Orglet');

  expect(shimLaunchOf('@echo off\r\necho hello\r\n', environment)).toBeUndefined();
  expect(installedLaunch('win32', { LOCALAPPDATA: join(localAppData, 'missing') })).toBeUndefined();
  expect(expandBatchPath('100%% %UNKNOWN%', environment)).toBe('100% %UNKNOWN%');
});
