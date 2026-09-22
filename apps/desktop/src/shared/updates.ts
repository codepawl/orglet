import { z } from 'zod';

/**
 * What the About tab shows and how the app updates itself (COD-176). Everything here is pure: the main process
 * owns the Electron updater and the network, the renderer only shows the state it is pushed.
 */

/** The public GitHub repository the app is released from. update.electronjs.org serves feeds for it. */
export const RELEASE_REPOSITORY = 'codepawl/orglet';
export const UPDATE_FEED_HOST = 'https://update.electronjs.org';
export const CHANGELOG_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=10`;

/**
 * The only addresses the app ever opens in the browser from the About tab. The renderer names a link by key and
 * the main process looks the address up here, so no page content and no renderer state can pick a URL.
 */
export const ABOUT_LINKS = {
  website: 'https://orglet.codepawl.com',
  github: 'https://github.com/codepawl/orglet',
  discord: 'https://discord.gg/XTShcr4j75',
  x: 'https://x.com/codepawl',
  threads: 'https://www.threads.com/@codepawl',
  releases: 'https://github.com/codepawl/orglet/releases',
} as const;
export const AboutLink = z.enum(['website', 'github', 'discord', 'x', 'threads', 'releases']);
export type AboutLink = z.infer<typeof AboutLink>;

/** The feed update.electronjs.org answers for this build: 204 when it is the newest, the update otherwise. */
export function updateFeedUrl(platform: string, arch: string, version: string): string {
  return `${UPDATE_FEED_HOST}/${RELEASE_REPOSITORY}/${platform}-${arch}/${version}`;
}

/** How this copy of the app got onto the machine, which decides whether it can replace itself. */
export type InstallKind = 'dev' | 'squirrel' | 'portable' | 'macos-app' | 'linux';

export type UpdateEnvironment = {
  packaged: boolean;
  platform: string;
  /** Squirrel.Windows keeps Update.exe one folder above the app folder; a ZIP unpacked by hand has none. */
  squirrelUpdater: boolean;
  /** Set at build time from the signing flag; Squirrel.Mac refuses an unsigned app. */
  macosSigned: boolean;
};

export function installKind(environment: UpdateEnvironment): InstallKind {
  if (!environment.packaged) return 'dev';
  if (environment.platform === 'win32') return environment.squirrelUpdater ? 'squirrel' : 'portable';
  if (environment.platform === 'darwin') return 'macos-app';
  return 'linux';
}

export type UnsupportedReason = 'dev' | 'portable' | 'linux' | 'macos-unsigned';

/** Whether the built-in updater can work here, and if not, the one reason the About tab tells the person. */
export function updateSupport(environment: UpdateEnvironment): { supported: true } | { supported: false; reason: UnsupportedReason } {
  const kind = installKind(environment);
  if (kind === 'squirrel') return { supported: true };
  if (kind === 'macos-app') return environment.macosSigned ? { supported: true } : { supported: false, reason: 'macos-unsigned' };
  if (kind === 'dev') return { supported: false, reason: 'dev' };
  if (kind === 'portable') return { supported: false, reason: 'portable' };
  return { supported: false, reason: 'linux' };
}

/**
 * Where the updater is right now. The main process pushes every change to the renderer; the About row and the
 * notice both read from it, so neither can say more than the updater knows.
 */
export type UpdateState =
  | { status: 'unsupported'; reason: UnsupportedReason }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: string }
  | { status: 'downloading' }
  | { status: 'ready'; version: string | null }
  | { status: 'error'; message: string; checkedAt: string };

/** Versions and platform facts for the About tab and for a bug report. The SQLite version comes with the workspace. */
export type AboutInfo = {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  platform: string;
  osRelease: string;
  arch: string;
  install: InstallKind;
};

/** One GitHub Release, reduced to what the changelog shows. */
export const Release = z.object({
  version: z.string().min(1).max(64),
  name: z.string().max(300),
  notes: z.string().max(60_000),
  publishedAt: z.iso.datetime().nullable(),
  url: z.url(),
}).strict();
export type Release = z.infer<typeof Release>;

export const ChangelogCache = z.object({ fetchedAt: z.iso.datetime(), releases: z.array(Release).max(20) }).strict();
export type ChangelogCache = z.infer<typeof ChangelogCache>;

/** What the About tab gets: releases newest first, when they were fetched (never, with no cache), and why they may be old. */
export type Changelog = { releases: Release[]; fetchedAt: string | null; stale: boolean; error?: string };

/** The operating system's everyday name for the details block; an unknown platform keeps Node's word for it. */
export function osName(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/** The fields of GitHub's releases API the changelog reads; everything else is ignored rather than rejected. */
const GitHubRelease = z.object({
  tag_name: z.string().min(1).max(64),
  name: z.string().max(300).nullable().optional(),
  body: z.string().max(60_000).nullable().optional(),
  published_at: z.iso.datetime().nullable().optional(),
  html_url: z.url(),
  draft: z.boolean().optional(),
}).loose();

/** A tag `v0.2.3` names version `0.2.3`; the About tab compares that to the running version. */
export const releaseVersion = (tag: string) => tag.replace(/^v/i, '');

/** Turns GitHub's list into the changelog: drafts dropped, newest first, at most ten. */
export function parseReleases(body: unknown): Release[] {
  const listed = z.array(GitHubRelease).max(100).parse(body);
  return listed
    .filter(item => !item.draft)
    .map(item => ({ version: releaseVersion(item.tag_name), name: item.name?.trim() || item.tag_name, notes: item.body ?? '', publishedAt: item.published_at ?? null, url: item.html_url }))
    .sort((one, two) => (two.publishedAt ?? '').localeCompare(one.publishedAt ?? ''))
    .slice(0, 10)
    .map(item => Release.parse(item));
}

/** The plain-text block the Copy details button puts on the clipboard, one fact per line. */
export function aboutDetailsText(about: AboutInfo, sqliteVersion: string, installLabel: string): string {
  return [
    `Orglet ${about.version}`,
    `Electron ${about.electron}`,
    `Chromium ${about.chromium}`,
    `Node ${about.node}`,
    `SQLite ${sqliteVersion}`,
    `${osName(about.platform)} ${about.osRelease} ${about.arch}`,
    installLabel,
  ].join('\n');
}
