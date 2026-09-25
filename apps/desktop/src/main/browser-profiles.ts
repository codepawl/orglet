import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { BrowserProfileName } from '../shared/browser';
import { readBoundedText, writeAtomicText } from './files';

/**
 * The named browser profiles the person made (COD-261). Main keeps the list and the host opens the folders; the
 * window sees names and dates only, and neither a backup nor a template carries a profile. Each profile is a folder
 * under `<userData>/browser/profiles/<id>` holding what that browser keeps: cookies, sign-ins and site data.
 */
const ProfileRecord = z.object({ id: z.uuid(), name: BrowserProfileName, createdAt: z.iso.datetime(), lastUsedAt: z.iso.datetime().nullable() }).strict();
export type BrowserProfileRecord = z.infer<typeof ProfileRecord>;
const ProfileFile = z.object({ profiles: z.array(ProfileRecord).max(20) }).strict();

export const MAX_BROWSER_PROFILES = 20;

export class BrowserProfiles {
  constructor(private root: string) {}

  /** The folder the host opens; its parent is what the host is given. */
  get profilesRoot() {
    return join(this.root, 'profiles');
  }

  folderOf(profileId: string) {
    return join(this.profilesRoot, z.uuid().parse(profileId));
  }

  private get listFile() {
    return join(this.root, 'profiles.json');
  }

  async list(): Promise<BrowserProfileRecord[]> {
    if (!existsSync(this.listFile)) return [];
    try {
      return ProfileFile.parse(JSON.parse(await readBoundedText(this.listFile, 256 * 1024))).profiles;
    } catch {
      return [];
    }
  }

  private async write(profiles: BrowserProfileRecord[]) {
    await mkdir(this.root, { recursive: true });
    await writeAtomicText(this.listFile, JSON.stringify({ profiles }, null, 2));
  }

  async has(profileId: string) {
    return (await this.list()).some(profile => profile.id === profileId);
  }

  async create(rawName: unknown): Promise<BrowserProfileRecord> {
    const name = BrowserProfileName.parse(rawName);
    const profiles = await this.list();
    if (profiles.length >= MAX_BROWSER_PROFILES) throw new Error(`Tối đa ${MAX_BROWSER_PROFILES} hồ sơ trình duyệt.`);
    if (profiles.some(profile => profile.name.toLowerCase() === name.toLowerCase())) throw new Error('Đã có hồ sơ cùng tên.');
    const profile: BrowserProfileRecord = { id: randomUUID(), name, createdAt: new Date().toISOString(), lastUsedAt: null };
    await mkdir(this.folderOf(profile.id), { recursive: true });
    await this.write([...profiles, profile]);
    return profile;
  }

  async touch(profileId: string) {
    const profiles = await this.list();
    const next = profiles.map(profile => profile.id === profileId ? { ...profile, lastUsedAt: new Date().toISOString() } : profile);
    await this.write(next);
  }

  /** Empties the folder: every sign-in, cookie and site's data in it. The profile itself stays. */
  async clear(profileId: string) {
    if (!await this.has(profileId)) throw new Error('Không tìm thấy hồ sơ trình duyệt này.');
    const folder = this.folderOf(profileId);
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await mkdir(folder, { recursive: true });
  }

  async remove(profileId: string) {
    const profiles = await this.list();
    if (!profiles.some(profile => profile.id === profileId)) throw new Error('Không tìm thấy hồ sơ trình duyệt này.');
    await rm(this.folderOf(profileId), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await this.write(profiles.filter(profile => profile.id !== profileId));
  }
}
