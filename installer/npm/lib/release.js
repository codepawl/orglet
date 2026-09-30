/*
 * Which file of the latest GitHub Release this computer needs, and the SHA-256 GitHub reports for it. GitHub computes
 * the digest itself when the file is uploaded, so it does not depend on anything the release notes say.
 */

export const RELEASES_API = 'https://api.github.com/repos/codepawl/orglet/releases/latest';

/** The asset this platform installs from, or undefined when there is no installer for it. Releases ship Windows only. */
export function installerAssetFor(assets, platform) {
  if (platform !== 'win32') return undefined;
  return assets.find(asset => /^Orglet-\d+\.\d+\.\d+\.Setup\.exe$/.test(asset.name));
}

/** The hex SHA-256 from GitHub's `digest` field (`sha256:<hex>`), or undefined when the release has none. */
export function sha256Of(asset) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '');
  return match ? match[1].toLowerCase() : undefined;
}

/** `v0.9.0` → `0.9.0`. */
export function versionOfTag(tag) {
  return String(tag ?? '').replace(/^v/, '');
}

/**
 * What to say when GitHub refuses. Without a token GitHub allows 60 API requests an hour per address, and it can also
 * refuse bursts for a short while; both answer 403 or 429, and saying so beats a bare status code.
 */
export function releaseErrorMessage(status, headers) {
  if (status !== 403 && status !== 429) return `GitHub answered ${status} for the latest Orglet release.`;
  const resetSeconds = Number(headers.get('x-ratelimit-reset'));
  const remaining = headers.get('x-ratelimit-remaining');
  if (remaining === '0' && resetSeconds > 0) {
    const resetTime = new Date(resetSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `GitHub's limit for requests without an account is used up on this network. Try again after ${resetTime}.`;
  }
  return 'GitHub turned the request away for now (too many requests). Try again in a minute.';
}

/** Reads the latest release: its version and assets. */
export async function latestRelease(fetchImplementation = fetch) {
  const response = await fetchImplementation(RELEASES_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'orglet installer' },
  });
  if (!response.ok) throw new Error(releaseErrorMessage(response.status, response.headers));
  const release = await response.json();
  return { version: versionOfTag(release.tag_name), assets: release.assets ?? [] };
}
