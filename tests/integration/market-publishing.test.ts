import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MarketSubmission, validateMarketSubmission } from '../../apps/desktop/src/shared/market-publishing';
import { MARKET_SEED_BODIES } from '../../apps/desktop/src/shared/market-seed';
import { inspectPackage, packageForExport, packageForImport, assertSkillReady } from '../../apps/desktop/src/core/skill-package';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { credentialLocations } from '../../apps/desktop/src/shared/secrets';
import { scrubText } from '../../apps/desktop/src/shared/analytics';

function submission(kind: 'orglet' | 'crew' = 'orglet') {
  return {
    kind, name: 'Research', summary: 'Research from evidence', tags: ['research'],
    language: 'en', license: 'CC-BY-4.0', changelog: 'First version',
    template: JSON.parse(MARKET_SEED_BODIES[kind === 'orglet' ? 'research-friend:1' : 'research-review:1']),
  };
}

function withPackage() {
  const published = submission();
  const packageInput = packageForExport({ id: 'fixture', revision: 1, name: 'research', content: 'Use this skill to research evidence.' });
  published.template.skill = packageForImport(packageInput);
  return published;
}

function packageFile(path: string, text: string | Uint8Array) {
  return { path, base64: Buffer.from(text).toString('base64') };
}

async function validate(input: unknown) {
  return validateMarketSubmission(JSON.stringify(input));
}

describe('public content boundary', () => {
  it('accepts curated orglet/crew shapes and semantic effort as a suggestion', async () => {
    for (const kind of ['orglet', 'crew'] as const) {
      expect((await validate(submission(kind))).ok).toBe(true);
    }
    const published = submission();
    published.template.worker.effort = 'max';
    expect((await validate(published)).ok).toBe(true);
  });

  it.each(['author', 'listingId', 'version', 'reviewedHash', 'accountId', 'permissions', 'chats'])('refuses server/local envelope field %s', async field => {
    expect((await validate({ ...submission(), [field]: 'private' })).ok).toBe(false);
  });

  it.each(['futureLocalSetting', 'id', 'skillId', 'mcpServerIds', 'autoApplyProposals', 'native', 'modelCapabilities', 'workspace', 'memories'])('refuses nested worker field %s', async field => {
    const published = submission();
    published.template.worker[field] = 'private';
    expect((await validate(published)).ok).toBe(false);
  });

  it('refuses private connections, wrong kinds and malformed references', async () => {
    const published = submission();
    published.template.worker.provider = 'custom:fixture';
    expect((await validate(published)).ok).toBe(false);
    expect((await validate({ ...submission(), kind: 'crew' })).ok).toBe(false);
    for (const mutate of [
      (template: any) => {
        template.workers[1].key = template.workers[0].key;
      },
      (template: any) => {
        template.team.memberKeys = ['missing'];
      },
      (template: any) => {
        template.workers[0].skillKey = 'missing';
      },
      (template: any) => {
        template.skills.push({ ...template.skills[0], key: 'unused' });
      },
    ]) {
      const crew = submission('crew');
      mutate(crew.template);
      const result = await validate(crew);
      expect(result).toMatchObject({ ok: false, diagnostics: [{ rule: 'references' }] });
    }
  });

  it('binds every authored metadata field to the complete review digest, separately from body integrity', async () => {
    const first = await validate(submission());
    const second = await validate({ ...submission(), summary: 'Changed summary' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw Error('Fixture did not validate');
    expect(first.sha256).toBe(second.sha256);
    expect(first.reviewDigest).not.toBe(second.reviewDigest);
    expect(first.sha256).toBe(createHash('sha256').update(first.templateText).digest('hex'));
    const reversed = Object.fromEntries(Object.entries(submission()).reverse());
    const reordered = await validate(reversed);
    expect(reordered.ok && reordered.reviewDigest).toBe(first.reviewDigest);
    for (const change of [
      { name: 'Different title' }, { tags: ['changed'] }, { language: 'vi' }, { changelog: 'Changed version note' },
    ]) {
      const changed = await validate({ ...submission(), ...change });
      expect(changed.ok && changed.sha256).toBe(first.sha256);
      expect(changed.ok && changed.reviewDigest).not.toBe(first.reviewDigest);
    }
  });

  it('enforces exact UTF-8 body caps and returns safe JSON/schema diagnostics', async () => {
    const text = JSON.stringify({ ...submission(), name: '🔎 tiếng Việt' });
    const bytes = Buffer.byteLength(text);
    expect((await validateMarketSubmission(text, { bodyBytes: bytes })).ok).toBe(true);
    expect(await validateMarketSubmission(text, { bodyBytes: bytes - 1 })).toMatchObject({ ok: false, diagnostics: [{ rule: 'body-size' }] });
    const hostile = 'sk-fixturesecret12345';
    for (const text of [`{"${hostile}":`, JSON.stringify({ ...submission(), [hostile]: hostile })]) {
      const result = await validateMarketSubmission(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(hostile);
    }
    expect(MarketSubmission.safeParse({ ...submission(), screenshot: 'image' }).success).toBe(false);
  });
});

describe('credential scan', () => {
  it('bounds repeated credential diagnostics while rejecting the complete input', async () => {
    const credentialText = Array.from({ length: 9000 }, () => 'sk-fixturesecret12345').join('\n');
    expect(credentialLocations(credentialText)).toHaveLength(100);
    const published = withPackage();
    const packageInput = published.template.skill.package;
    packageInput.files = packageInput.files.filter((file: { path: string }) => file.path !== 'orglet.json');
    packageInput.files.push(packageFile('references/large.md', credentialText));
    packageInput.hash = inspectPackage(packageInput).hash;
    const result = await validate(published);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw Error('Credential fixture was accepted');
    expect(result.diagnostics).toHaveLength(100);
    expect(result.diagnostics[99].line).toBe(100);
  });
  it.each([
    'sk-fixturesecret12345', 'ghp_fixturetoken12345',
    'eyJfixture123.fixturesegment123.fixturesignature123',
    'Authorization: Bearer fixtureCredential123', 'Authorization: Basic Zml4dHVyZTpwYXNz',
    'api_key = "fixtureCredential123"', ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  ])('blocks recognizable credential fixture %s without returning its value', async credential => {
    const result = await validate({ ...submission(), changelog: `Safe line\n${credential}` });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ path: 'request.changelog', line: 2 }] });
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(credentialLocations(credential)).toEqual(credentialLocations(credential));
  });

  it('accepts ordinary technical prose, model slugs, digests and emoji while preserving broad telemetry masking', async () => {
    const text = `token introspection; Basic authentication; gpt-6-sol; ${'a'.repeat(64)}; 🔎`;
    expect(credentialLocations(text)).toEqual([]);
    expect((await validate({ ...submission(), changelog: text })).ok).toBe(true);
    expect(scrubText('token introspection Basic authentication', {})).toBe('token [masked] Basic [masked]');
  });

  it('scans instructions, crew notes, frontmatter/resources and credential-shaped paths with safe file indexes', async () => {
    const credential = 'sk-fixturesecret12345';
    for (const mutate of [
      (published: any) => {
        published.template.worker.instructions = credential;
      },
      (published: any) => {
        published.template.skill.content = credential;
      },
      (published: any) => {
        published.tags = [credential];
      },
    ]) {
      const published = submission();
      mutate(published);
      expect((await validate(published)).ok).toBe(false);
    }
    const crew = submission('crew');
    crew.template.knowledge = [{ title: 'Note', content: credential, tags: [], pinned: false }];
    expect((await validate(crew)).ok).toBe(false);
    for (const location of ['frontmatter', 'resource', 'path']) {
      const published = withPackage();
      const packageInput = published.template.skill.package;
      if (location === 'frontmatter') {
        packageInput.files[0] = packageFile('SKILL.md', `---\nname: research\ndescription: ${credential}\n---\nUse this skill to research evidence.`);
      } else {
        packageInput.files.push(packageFile(location === 'path' ? `references/${credential}.md` : 'references/notes.md', location === 'resource' ? credential : 'Safe'));
      }
      packageInput.files = packageInput.files.filter((file: { path: string }) => file.path !== 'orglet.json');
      packageInput.hash = inspectPackage(packageInput).hash;
      const result = await validate(published);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(credential);
    }
  });
});

describe('portable package validation', () => {
  it('accepts a real exported package and keeps local review mandatory', async () => {
    const published = withPackage();
    expect((await validate(published)).ok).toBe(true);
    const store = new Store(':memory:');
    try {
      const skill = { ...published.template.skill, id: 'local', revision: 1 };
      expect(() => assertSkillReady(skill, store)).toThrow('review');
    } finally {
      store.close();
    }
  });

  it.each(['name', 'content', 'hash', 'reviewedHash'])('refuses package preview mismatch or client review receipt %s', async field => {
    const published = withPackage();
    if (field === 'hash' || field === 'reviewedHash') published.template.skill.package[field] = '0'.repeat(64);
    else published.template.skill[field] = 'different';
    expect((await validate(published)).ok).toBe(false);
  });

  it.each(['base64', 'utf8', 'nul', 'collision', 'directory', 'manifest', 'alias', 'tool'])('refuses malformed or unsupported package %s', async kind => {
    const published = withPackage();
    const packageInput = published.template.skill.package;
    if (kind === 'base64') packageInput.files.push({ path: 'references/x', base64: 'Zh==' });
    if (kind === 'utf8') packageInput.files.push(packageFile('references/x', new Uint8Array([0xff])));
    if (kind === 'nul') packageInput.files.push(packageFile('references/x', 'a\0b'));
    if (kind === 'collision') packageInput.files.push({ ...packageInput.files[0], path: 'skill.MD' });
    if (kind === 'directory') packageInput.files.push(packageFile('references', 'x'), packageFile('References/x', 'y'));
    if (kind === 'manifest') packageInput.files.find((file: { path: string }) => file.path === 'orglet.json').base64 = Buffer.from('{}').toString('base64');
    if (kind === 'alias' || kind === 'tool') {
      packageInput.files[0] = packageFile('SKILL.md', `---\nname: research\ndescription: ${kind === 'alias' ? '&description value\nlicense: *description' : 'Research\nallowed-tools: shell'}\n---\nUse this skill to research evidence.`);
    }
    expect((await validate(published)).ok).toBe(false);
  });

  it('checks decoded multibyte file/package limits without scanning encoded data', async () => {
    const published = withPackage();
    const packageInput = published.template.skill.package;
    packageInput.files = packageInput.files.filter((file: { path: string }) => file.path !== 'orglet.json');
    packageInput.files.push(packageFile('references/notes.md', 'é🔎'));
    packageInput.hash = inspectPackage(packageInput).hash;
    expect((await validateMarketSubmission(JSON.stringify(published), { fileBytes: 6 })).ok).toBe(false);
    const largest = Math.max(...inspectPackage(packageInput).files.map(file => file.bytes));
    const total = inspectPackage(packageInput).files.reduce((bytes, file) => bytes + file.bytes, 0);
    expect((await validateMarketSubmission(JSON.stringify(published), { fileBytes: largest, packageBytes: total })).ok).toBe(true);
    expect((await validateMarketSubmission(JSON.stringify(published), { packageBytes: total - 1 })).ok).toBe(false);
  });

  it('rejects exact decoded file cap plus one and cumulative package cap plus one', async () => {
    for (const boundary of ['file', 'package']) {
      const published = withPackage();
      const packageInput = published.template.skill.package;
      packageInput.files = packageInput.files.filter((file: { path: string }) => file.path !== 'orglet.json');
      const initialBytes = inspectPackage(packageInput).files.reduce((total, file) => total + file.bytes, 0);
      const targetBytes = boundary === 'file' ? 256 * 1024 : 1024 * 1024 - initialBytes;
      let remainingBytes = targetBytes;
      let fileIndex = 0;
      while (remainingBytes > 0) {
        const bytes = Math.min(remainingBytes, 256 * 1024);
        packageInput.files.push(packageFile(`references/part-${fileIndex++}.md`, 'x'.repeat(bytes)));
        remainingBytes -= bytes;
      }
      packageInput.hash = inspectPackage(packageInput).hash;
      expect((await validate(published)).ok).toBe(true);
      const lastFile = packageInput.files.at(-1);
      lastFile.base64 = Buffer.concat([Buffer.from(lastFile.base64, 'base64'), Buffer.from('x')]).toString('base64');
      expect((await validate(published)).ok).toBe(false);
    }
  });

  it('rejects unsupported tools/permissions and malformed manifests after matching identity, without executing resources', async () => {
    const published = withPackage();
    const packageInput = published.template.skill.package;
    packageInput.files = packageInput.files.filter((file: { path: string }) => file.path !== 'orglet.json');
    packageInput.files[0] = packageFile('SKILL.md', '---\nname: research\ndescription: Research\nallowed-tools: shell\n---\nUse this skill to research evidence.');
    packageInput.files.push(packageFile('scripts/run.js', "throw Error('Imported resource must never execute');"));
    packageInput.hash = inspectPackage(packageInput).hash;
    expect(await validate(published)).toMatchObject({ ok: false, diagnostics: [{ rule: 'unsupported-package' }] });
    const exported = withPackage();
    const extension = exported.template.skill.package.files.find((file: { path: string }) => file.path === 'orglet.json');
    const manifest = JSON.parse(Buffer.from(extension.base64, 'base64').toString());
    manifest.required_permissions = ['network:*'];
    extension.base64 = Buffer.from(JSON.stringify(manifest)).toString('base64');
    exported.template.skill.package.hash = inspectPackage(exported.template.skill.package).hash;
    expect(await validate(exported)).toMatchObject({ ok: false, diagnostics: [{ rule: 'unsupported-package' }] });
  });

  it('refuses explicit YAML tags in public content while retaining local inspection compatibility', async () => {
    const published = withPackage();
    const packageInput = published.template.skill.package;
    packageInput.files = [packageFile('SKILL.md', '---\nname: research\ndescription: !!str Research\n---\nUse this skill to research evidence.')];
    packageInput.hash = inspectPackage(packageInput).hash;
    expect(await validate(published)).toMatchObject({ ok: false, diagnostics: [{ rule: 'yaml-extension' }] });
  });
});
