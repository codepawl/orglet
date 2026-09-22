import { readFile } from 'node:fs/promises';
import { writeAtomicText } from './files';
import { CHANGELOG_URL, ChangelogCache, parseReleases, type Changelog } from '../shared/updates';

/** GitHub allows sixty anonymous requests an hour per address; an hour-old list is still the current list. */
export const CHANGELOG_MAX_AGE_MS = 60 * 60 * 1000;

export type FetchJson = (url: string) => Promise<unknown>;

/** The request carries nothing about the person or the workspace: a content type and the app's name. */
export const fetchGitHubJson: FetchJson = async url => {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Orglet' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub trả lỗi ${response.status}.`);
  return response.json();
};

export type ChangelogOptions = {
  /** Where the last successful list is kept, so the About tab has something to show offline. */
  cacheFile: string;
  fetchJson?: FetchJson;
  clock?: () => Date;
};

/**
 * The release notes the About tab shows (COD-176). Fetched by the main process from GitHub's releases API,
 * validated, and kept on disk: offline, the last list is shown and marked as old; with no list at all, the
 * failure is reported rather than an empty page pretending to be the changelog.
 */
export class ChangelogFeed {
  private readonly cacheFile: string;
  private readonly fetchJson: FetchJson;
  private readonly clock: () => Date;
  private cache: ChangelogCache | null | undefined;

  constructor(options: ChangelogOptions) {
    this.cacheFile = options.cacheFile;
    this.fetchJson = options.fetchJson ?? fetchGitHubJson;
    this.clock = options.clock ?? (() => new Date());
  }

  async read(refresh = false): Promise<Changelog> {
    const cached = await this.loadCache();
    if (cached && !refresh && this.isFresh(cached)) return { ...cached, stale: false };
    try {
      const releases = parseReleases(await this.fetchJson(CHANGELOG_URL));
      const next: ChangelogCache = { fetchedAt: this.clock().toISOString(), releases };
      this.cache = next;
      await writeAtomicText(this.cacheFile, JSON.stringify(next)).catch(() => undefined);
      return { ...next, stale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không tải được danh sách phát hành.';
      if (cached) return { ...cached, stale: true, error: message };
      return { fetchedAt: null, releases: [], stale: true, error: message };
    }
  }

  private isFresh(cached: ChangelogCache): boolean {
    return this.clock().getTime() - new Date(cached.fetchedAt).getTime() < CHANGELOG_MAX_AGE_MS;
  }

  private async loadCache(): Promise<ChangelogCache | null> {
    if (this.cache !== undefined) return this.cache;
    try {
      const parsed = ChangelogCache.safeParse(JSON.parse(await readFile(this.cacheFile, 'utf8')));
      this.cache = parsed.success ? parsed.data : null;
    } catch {
      // No cache yet, or one this build cannot read: the next fetch writes a fresh one.
      this.cache = null;
    }
    return this.cache;
  }
}
