import type { WindowsSignOptions } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Certum's RFC 3161 timestamp service. A timestamp keeps a signature valid after the certificate expires. */
export const CERTUM_TIMESTAMP_SERVER = 'http://time.certum.pl';

/** The signtool.exe that @electron/windows-sign ships, so local and CI builds sign with the same tool. */
export const SIGNTOOL_PATH = join(__dirname, 'node_modules/@electron/windows-sign/vendor/signtool.exe');

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/**
 * CI sets WINDOWS_SIGNING_ENABLED=true after SimplySign Desktop has logged in and put the Certum certificate in the
 * CurrentUser\My store. Local `pnpm make` stays unsigned unless that flag is set.
 */
export function resolveWindowsCertificate(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.WINDOWS_SIGNING_ENABLED !== 'true') {
    return undefined;
  }
  const thumbprint = trim(env.WINDOWS_CERTIFICATE_SHA1);
  if (!thumbprint) {
    // Signing was asked for, so a silent unsigned build would be the wrong outcome.
    throw new Error('WINDOWS_SIGNING_ENABLED=true needs WINDOWS_CERTIFICATE_SHA1, the certificate thumbprint.');
  }
  return thumbprint;
}

/** SHA-256 only: SHA-1 dual signing serves Windows 7 and would double the use of the monthly signature quota. */
export function signtoolParameters(thumbprint: string): string[] {
  return ['/sha1', thumbprint, '/fd', 'sha256', '/tr', CERTUM_TIMESTAMP_SERVER, '/td', 'sha256'];
}

function hasValidSignature(file: string): boolean {
  const result = spawnSync(SIGNTOOL_PATH, ['verify', '/pa', '/q', file], { windowsHide: true });
  return result.status === 0;
}

function signFile(thumbprint: string, file: string): void {
  // Microsoft's and DuckDB's own binaries ship signed. Signing over them would name Orglet as their publisher.
  if (hasValidSignature(file)) {
    return;
  }
  const result = spawnSync(SIGNTOOL_PATH, ['sign', ...signtoolParameters(thumbprint), file], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`signtool could not sign ${file}: ${result.stderr || result.stdout || result.error?.message}`);
  }
}

const SIGNED_EXTENSIONS = ['.exe', '.dll', '.node'];

function portableExecutables(directory: string): string[] {
  const entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && SIGNED_EXTENSIONS.includes(extname(entry.name).toLowerCase()))
    .map(entry => join(entry.parentPath, entry.name));
}

/**
 * @electron/windows-sign logs a failed hook call and carries on, so a build could come out unsigned and still succeed.
 * This checks the result instead: after packaging, every executable, DLL and native addon must carry a valid signature.
 */
export function assertPackageSigned(outputPaths: string[]): void {
  const unsigned = outputPaths.flatMap(portableExecutables).filter(file => !hasValidSignature(file));
  if (unsigned.length > 0) {
    throw new Error(`These files are not signed:\n${unsigned.join('\n')}`);
  }
}

/** Signs the packaged app: Orglet.exe, the helper tools, and the DLLs and native addons that are not signed yet. */
export function resolveWindowsSign(env: NodeJS.ProcessEnv = process.env): WindowsSignOptions | undefined {
  const thumbprint = resolveWindowsCertificate(env);
  if (!thumbprint) {
    return undefined;
  }
  return { hookFunction: file => signFile(thumbprint, file) };
}

/**
 * Signs Squirrel's Setup.exe and Update.exe through Squirrel's own signtool. Squirrel skips files that are already
 * signed, so the app files signed above keep their signatures.
 */
export function resolveSquirrelSign(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const thumbprint = resolveWindowsCertificate(env);
  if (!thumbprint) {
    return undefined;
  }
  return signtoolParameters(thumbprint).join(' ');
}
