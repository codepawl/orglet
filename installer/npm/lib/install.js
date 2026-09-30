import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { installerAssetFor, latestRelease, sha256Of } from './release.js';
import { PUBLISHER, readSignature, sha256OfFile, signatureAccepted } from './verify.js';

/*
 * Installs the latest Orglet release for this Windows user: downloads Setup from the GitHub Release, checks it, runs
 * it. Setup is Squirrel's per-user installer: no administrator prompt, it installs under %LOCALAPPDATA%\Orglet,
 * puts the `orglet` command on the user's PATH and starts the app. Other platforms are pointed at the release page.
 */

export const RELEASES_PAGE = 'https://github.com/codepawl/orglet/releases/latest';

async function download(url, destination, onProgress) {
  const response = await fetch(url, { headers: { 'user-agent': '@codepawl/orglet installer' } });
  if (!response.ok || !response.body) throw new Error(`The download failed: GitHub answered ${response.status}.`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', chunk => {
    received += chunk.length;
    onProgress(received, total);
  });
  await pipeline(body, createWriteStream(destination));
}

function runSetup(path) {
  return new Promise((resolve, reject) => {
    const setup = spawn(path, [], { stdio: 'ignore', windowsHide: false });
    setup.on('error', reject);
    setup.on('exit', code => (code === 0 ? resolve() : reject(new Error(`Setup stopped with exit code ${code}.`))));
  });
}

function megabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(0);
}

/** Installs or updates Orglet. `log` prints one line; `progress` redraws the download line. */
export async function install({ platform = process.platform, log, progress }) {
  if (platform !== 'win32') {
    log(`This installer covers Windows for now. Download Orglet for your computer from ${RELEASES_PAGE}`);
    return false;
  }
  const release = await latestRelease();
  const asset = installerAssetFor(release.assets, platform);
  if (!asset) throw new Error(`The latest release (${release.version}) has no Windows Setup. See ${RELEASES_PAGE}`);
  const expectedHash = sha256Of(asset);
  if (!expectedHash) throw new Error(`GitHub reports no SHA-256 for ${asset.name}, so it cannot be checked. See ${RELEASES_PAGE}`);

  const folder = await mkdtemp(join(tmpdir(), 'orglet-setup-'));
  const setupPath = join(folder, asset.name);
  try {
    log(`Downloading Orglet ${release.version} (${megabytes(asset.size)} MB)…`);
    await download(asset.browser_download_url, setupPath, progress);
    log('');
    const actualHash = await sha256OfFile(setupPath);
    if (actualHash !== expectedHash) throw new Error('The download does not match the release on GitHub (SHA-256 differs). Nothing was installed.');
    log('Checked: the file matches the release on GitHub.');
    const signature = await readSignature(setupPath);
    if (!signatureAccepted(signature)) {
      throw new Error(`Setup is not validly signed by ${PUBLISHER} (Windows says: ${signature.status || 'no signature'}). Nothing was installed.`);
    }
    log(`Checked: signed by ${PUBLISHER}.`);
    log('Running Setup. Orglet opens when it is done.');
    await runSetup(setupPath);
    log('Installed. Open a new terminal and run `orglet status`.');
    return true;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
