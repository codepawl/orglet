import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';

/*
 * Two checks before Setup runs: the file is byte for byte the one GitHub stored for the release (SHA-256), and
 * Windows accepts its Authenticode signature as valid and made by Orglet's publisher. Either failing stops the install.
 */

/** The name in the signing certificate's subject that every Orglet release carries (docs/windows-release-gates.md). */
export const PUBLISHER = 'Open Source Developer Xuan An Nguyen';

export function sha256OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Whether PowerShell's answer about a signature names a valid signature from Orglet's publisher. */
export function signatureAccepted(signature) {
  if (!signature || signature.status !== 'Valid') return false;
  const commonNames = (signature.subject ?? '').split(/,\s*/).filter(part => part.startsWith('CN='));
  return commonNames.includes(`CN=${PUBLISHER}`);
}

/** Asks Windows about a file's Authenticode signature: `{ status, subject }`. */
export function readSignature(path) {
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:ORGLET_SETUP_PATH',
    '[pscustomobject]@{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress',
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ORGLET_SETUP_PATH: path },
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`Windows could not read the signature of ${path}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Windows gave an unreadable answer about the signature of ${path}.`));
      }
    });
  });
}
