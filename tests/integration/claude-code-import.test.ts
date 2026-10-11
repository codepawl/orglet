import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { inspectPackage } from '../../apps/desktop/src/core/skill-package';
import type { Skill, Worker } from '../../apps/desktop/src/shared/contracts';
import { splitMcpDraft } from '../../apps/desktop/src/shared/mcp';
import {
  agentCandidate, claudeJsonServers, claudeMcpEntries, commandName, dedupeMcp, nameList, parseFrontmatter, skillCandidate,
} from '../../apps/desktop/src/shared/claude-code-import';
import { orgletFromSubagent, type OrgletImportContext } from '../../apps/desktop/src/shared/claude-code-orglet';
import { importClaudeCodeEntries, scanClaudeCode, type ExistingNames } from '../../apps/desktop/src/main/claude-code-scan';

const nothingHere: ExistingNames = { skills: new Set(), workers: new Set(), mcp: new Set() };

describe('frontmatter', () => {
  it('reads a file without frontmatter as all body', () => {
    const parsed = parseFrontmatter('Just text\nmore');
    expect(parsed).toMatchObject({ fields: {}, body: 'Just text\nmore', present: false });
  });
  it('accepts a block with every field optional, empty or not', () => {
    expect(parseFrontmatter('---\n---\nBody').fields).toEqual({});
    expect(parseFrontmatter('---\nname: a\n---\nBody')).toMatchObject({ fields: { name: 'a' }, body: 'Body' });
  });
  it('reads CRLF files and a byte order mark', () => {
    const parsed = parseFrontmatter('\uFEFF---\r\nname: crlf\r\ndescription: Works\r\n---\r\n\r\nBody line\r\n');
    expect(parsed.fields).toEqual({ name: 'crlf', description: 'Works' });
    expect(parsed.body).toBe('Body line');
  });
  it('falls back to reading line by line when the YAML is not valid', () => {
    const parsed = parseFrontmatter('---\nname: x\ndescription: Use when: the thing happens\n---\nBody');
    expect(parsed.lenient).toBe(true);
    expect(parsed.fields).toMatchObject({ name: 'x', description: 'Use when: the thing happens' });
  });
  it('reads a list written as YAML items or as one comma-separated string', () => {
    expect(nameList(parseFrontmatter('---\ntools: [Read, Grep]\n---\n').fields.tools)).toEqual(['Read', 'Grep']);
    expect(nameList(parseFrontmatter('---\ntools:\n  - Read\n  - Grep\n---\n').fields.tools)).toEqual(['Read', 'Grep']);
    expect(nameList(parseFrontmatter('---\ntools: Read, Grep\n---\n').fields.tools)).toEqual(['Read', 'Grep']);
  });
});

describe('skills and commands', () => {
  it('takes the name from the folder, the description from the first body line, and appends when_to_use', () => {
    const plain = skillCandidate({ folderName: 'My_Skill', text: '---\n---\n\nDo the thing carefully.\n\nMore.' });
    expect(plain.name).toBe('my-skill');
    expect(plain.description).toBe('Do the thing carefully.');
    expect(plain.notes.join(' ')).toContain('my-skill');
    const withWhen = skillCandidate({ folderName: 'a', text: '---\ndescription: Does A.\nwhen_to_use: When A is asked.\n---\nBody' });
    expect(withWhen.description).toBe('Does A. When A is asked.');
  });
  it('produces a package the existing inspection accepts, with only the fields Orglet stores', () => {
    const text = '---\nname: reviewer\ndescription: Reviews.\nlicense: MIT\nmetadata:\n  author: me\n  count: 3\n  nested: {a: 1}\nhooks:\n  PreToolUse: []\nmodel: opus\nargument-hint: "[file]"\nallowed-tools: [Read, reply]\nsomething-new: 1\n---\nBody here';
    const candidate = skillCandidate({ folderName: 'reviewer', text });
    expect(candidate.blocked).toBeUndefined();
    const inspected = inspectPackage(candidate.skillPackage);
    expect(inspected.metadata).toEqual({ name: 'reviewer', description: 'Reviews.', license: 'MIT', metadata: { author: 'me', count: '3' }, 'allowed-tools': 'Read reply' });
    for (const field of ['hooks', 'model', 'argument-hint', 'something-new']) expect(candidate.notes).toContain(`${field}: Orglet không dùng`);
    expect(candidate.notes.some(note => note.startsWith('metadata.nested'))).toBe(true);
    expect(candidate.notes.some(note => note.includes('allowed-tools'))).toBe(true);
    expect(inspected.content).toBe('Body here');
  });
  it('notes command injection and $ARGUMENTS and leaves them as text', () => {
    const candidate = skillCandidate({ folderName: 'x', text: 'Run !`git status` then handle $ARGUMENTS.' });
    expect(candidate.notes.some(note => note.includes('dấu !'))).toBe(true);
    expect(candidate.notes.some(note => note.includes('$ARGUMENTS'))).toBe(true);
    expect(inspectPackage(candidate.skillPackage).content).toContain('!`git status`');
  });
  it('blocks what cannot fit', () => {
    expect(skillCandidate({ folderName: '日本語', text: 'body' }).blocked).toContain('Tên');
    expect(skillCandidate({ folderName: 'a', text: '---\nname: a\n---\n' }).blocked).toBeDefined();
    expect(skillCandidate({ folderName: 'a', text: `---\ndescription: d\n---\n${'x'.repeat(16001)}` }).blocked).toBeDefined();
  });
  it('names a nested command folder-file', () => {
    expect(commandName('git/commit.md')).toBe('git-commit');
    expect(commandName('review.md')).toBe('review');
  });
});

describe('subagents become orglets', () => {
  const context = (overrides: Partial<OrgletImportContext> = {}): OrgletImportContext => ({
    defaultProvider: 'openai', claudeCodeConnected: false, defaultSkillId: 'default-skill', usableSkills: new Map(), waitingSkills: new Set(), ...overrides,
  });
  const agent = (front: string) => agentCandidate('team/helper.md', `---\n${front}\n---\nYou are a helper.`);

  it('requires a name and a description', () => {
    expect(agentCandidate('a.md', '---\ndescription: d\n---\nbody').blocked).toContain('name');
    expect(agentCandidate('a.md', '---\nname: a\n---\nbody').blocked).toContain('description');
    expect(agentCandidate('a.md', '---\nname: a:b\ndescription: d\n---\nbody').blocked).toBeDefined();
  });
  it('names every field Orglet does not carry', () => {
    const candidate = agent('name: helper\ndescription: Helps.\ntools: Read, Grep\ndisallowedTools: Bash\npermissionMode: plan\nmcpServers: [x]\nhooks: {}\nmemory: user\nisolation: worktree\nbackground: true\nmaxTurns: 4\ncolor: red');
    for (const field of ['tools', 'disallowedTools', 'permissionMode', 'mcpServers', 'hooks', 'memory', 'isolation', 'background', 'maxTurns', 'color']) expect(candidate.notes).toContain(`${field}: Orglet không dùng`);
  });
  it('carries the model only when Claude Code is connected', () => {
    const candidate = agent('name: helper\ndescription: Helps.\nmodel: sonnet\neffort: xhigh');
    const connected = orgletFromSubagent(candidate.agent!, context({ claudeCodeConnected: true }));
    expect(connected.input).toMatchObject({ provider: 'claude-code', modelId: 'sonnet', effort: 'max', skillId: 'default-skill' });
    const apart = orgletFromSubagent(candidate.agent!, context());
    expect(apart.input.provider).toBe('openai');
    expect(apart.input.modelId).toBeUndefined();
    expect(apart.notes.some(note => note.startsWith('model: sonnet'))).toBe(true);
  });
  it('sets no model for inherit or when none is given', () => {
    const inherit = orgletFromSubagent(agent('name: h\ndescription: d\nmodel: inherit').agent!, context({ claudeCodeConnected: true }));
    expect(inherit.input.provider).toBe('openai');
    expect(inherit.input.modelId).toBeUndefined();
    expect(inherit.notes).toEqual([]);
  });
  it('links the first usable skill and names the others', () => {
    const candidate = agent('name: h\ndescription: d\nskills: [alpha, beta, gamma, pending]');
    const mapped = orgletFromSubagent(candidate.agent!, context({ usableSkills: new Map([['alpha', 'skill-a'], ['beta', 'skill-b']]), waitingSkills: new Set(['pending']) }));
    expect(mapped.input.skillId).toBe('skill-a');
    expect(mapped.notes.some(note => note.includes('pending') && note.includes('review'))).toBe(true);
    expect(mapped.notes.some(note => note.includes('beta') && note.includes('gamma'))).toBe(true);
  });
  it('gives no permission, folder or MCP grant', () => {
    const mapped = orgletFromSubagent(agent('name: h\ndescription: d\nmcpServers: [x]').agent!, context());
    expect(Object.keys(mapped.input).sort()).toEqual(['description', 'instructions', 'name', 'provider', 'skillId']);
  });
});

describe('MCP servers', () => {
  it('turns streamable-http and sse into http and ws into a note', () => {
    const entries = claudeMcpEntries({
      a: { type: 'streamable-http', url: 'https://api.example.com/mcp' },
      b: { type: 'ws', url: 'wss://example.com' },
      c: { type: 'sse', url: 'https://sse.example.com/sse' },
    }, 'user', '.claude.json', new Set());
    expect(entries[0].mcpDraft?.transport.kind).toBe('http');
    expect(entries[0].item.description).toBe('streamable-http (api.example.com)');
    expect(entries[1].item.blocked).toContain('WebSocket');
    expect(entries[2].mcpDraft?.transport.kind).toBe('http');
    expect(entries[2].item.notes.some(note => note.includes('SSE'))).toBe(true);
  });
  it('resolves only the :-default form and never reads this app\'s environment', () => {
    process.env.CLAUDE_IMPORT_TEST_TOKEN = 'from-this-process';
    const [entry] = claudeMcpEntries({ s: { command: 'npx', args: ['-y', 'pkg', '--root', '${HOME_DIR}'], env: { A: '${CLAUDE_IMPORT_TEST_TOKEN}', B: '${B_VALUE:-fallback}', C: 'plain-value' } } }, 'user', 'x', new Set());
    delete process.env.CLAUDE_IMPORT_TEST_TOKEN;
    const draft = entry.mcpDraft!;
    if (draft.transport.kind !== 'stdio') throw new Error('expected stdio');
    expect(draft.transport.args).toContain('${HOME_DIR}');
    expect(draft.transport.env).toEqual([{ name: 'B', value: 'fallback' }, { name: 'C', value: 'plain-value' }]);
    expect(entry.item.notes.join(' ')).toContain('CLAUDE_IMPORT_TEST_TOKEN');
    expect(entry.item.notes.join(' ')).toContain('HOME_DIR');
    expect(JSON.stringify(entry.item)).not.toContain('from-this-process');
  });
  it('turns an Authorization bearer header into the bearer token and drops an unresolved one', () => {
    const [good, bad] = claudeMcpEntries({
      good: { type: 'http', url: 'https://x.example.com', headers: { Authorization: 'Bearer ${TOKEN:-abc123456}' } },
      bad: { type: 'http', url: 'https://y.example.com', headers: { Authorization: 'Bearer ${TOKEN}' } },
    }, 'project', '.mcp.json', new Set());
    expect(good.mcpDraft?.transport).toMatchObject({ kind: 'http', bearer: 'abc123456', headers: [] });
    expect(bad.mcpDraft?.transport).toMatchObject({ kind: 'http', headers: [] });
    expect(bad.item.notes.join(' ')).toContain('TOKEN');
  });
  it('shows no secret in the item and keeps the most local scope for a repeated name', () => {
    const secret = 'sk-very-secret-value-123';
    const user = claudeMcpEntries({ same: { command: 'node', args: ['a.js'], env: { KEY: secret } }, other: { type: 'http', url: 'https://o.example.com', headers: { 'X-Key': secret } } }, 'user', 'x', new Set());
    const local = claudeMcpEntries({ same: { command: 'deno', args: [] } }, 'local', 'x', new Set());
    expect(JSON.stringify(user.map(entry => entry.item))).not.toContain(secret);
    const merged = dedupeMcp([...user.map(entry => ({ scope: 'user' as const, entry })), ...local.map(entry => ({ scope: 'local' as const, entry }))]);
    expect(merged.map(entry => entry.item.description).sort()).toEqual(['http (o.example.com)', 'stdio (deno)']);
  });
  it('picks only the mcpServers objects out of the account file', () => {
    const file = { oauthAccount: { email: 'x@example.com' }, mcpServers: { u: {} }, projects: { 'C:\\work\\app': { mcpServers: { l: {} }, history: ['private'] }, 'C:\\other': { mcpServers: { o: {} } } } };
    expect(claudeJsonServers(file, undefined)).toEqual({ user: { u: {} } });
    expect(claudeJsonServers(file, 'c:/work/app/')).toEqual({ local: { l: {} } });
  });
});

describe('scanner and import on a fake folder', () => {
  let temp: string; let home: string; let outside: string;
  let store: Store; let core: CoreService;
  const write = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };
  const secret = 'ghp_totally_secret_value';

  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'orglet-claude-import-'));
    home = join(temp, 'home');
    outside = join(temp, 'outside');
    await mkdir(home, { recursive: true });
    await mkdir(outside, { recursive: true });
    store = new Store(':memory:');
    core = new CoreService(store, () => {}, async () => { throw new Error('no model'); });
  });
  afterEach(async () => { store.close(); await rm(temp, { recursive: true, force: true }); });

  async function build() {
    const claude = join(home, '.claude');
    await write(join(claude, 'skills', 'pdf-notes', 'SKILL.md'), '---\ndescription: Notes from PDFs.\nhooks: {}\n---\nRead the PDF.');
    await write(join(claude, 'skills', 'pdf-notes', 'references', 'tips.md'), 'tip');
    await write(join(claude, 'skills', 'synced', 'cloud', 'SKILL.md'), 'cloud');
    await write(join(claude, 'skills', 'anthropic-skills', 'x', 'SKILL.md'), 'reserved');
    await write(join(claude, 'skills', 'no-skill-file', 'README.md'), 'not a skill');
    await write(join(claude, 'commands', 'git', 'commit.md'), '---\ndescription: Commit.\n---\nCommit with $ARGUMENTS');
    await write(join(claude, 'commands', 'huge.md'), 'x'.repeat(300 * 1024));
    await write(join(claude, 'agents', 'nested', 'deep', 'reviewer.md'), '---\nname: code-reviewer\ndescription: Reviews code.\nmodel: sonnet\nskills: [pdf-notes]\ntools: Read\n---\nReview carefully.');
    await write(join(home, '.claude.json'), JSON.stringify({
      oauthAccount: { emailAddress: 'owner@example.com' },
      mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'], env: { GITHUB_TOKEN: secret } }, remote: { type: 'http', url: 'https://mcp.example.com/x', headers: { Authorization: `Bearer ${secret}` } } },
      projects: { [join(temp, 'project')]: { mcpServers: { localone: { command: 'node', args: ['s.js'] } } } },
    }));
  }

  it('lists skills, commands, subagents and servers, skipping reserved folders, and imports nothing', async () => {
    await build();
    const { listing } = await scanClaudeCode({ home, existing: nothingHere });
    const byName = new Map(listing.items.map(item => [item.name, item]));
    expect([...byName.keys()].sort()).toEqual(['code-reviewer', 'git-commit', 'github', 'huge', 'pdf-notes', 'remote']);
    expect(byName.get('pdf-notes')?.notes).toContain('hooks: Orglet không dùng');
    expect(byName.get('git-commit')?.source).toBe('commands/git/commit.md');
    expect(byName.get('huge')?.blocked).toContain('256 KB');
    expect(byName.get('code-reviewer')?.agent?.skills).toEqual(['pdf-notes']);
    expect(byName.get('github')?.description).toBe('stdio (npx)');
    expect(byName.get('remote')?.description).toBe('http (mcp.example.com)');
    expect(JSON.stringify(listing)).not.toContain(secret);
    expect(JSON.stringify(listing)).not.toContain('owner@example.com');
    expect(listing.folder).toBe('~/.claude');
    expect(store.all<Skill>('skills').filter(skill => skill.package)).toEqual([]);
  });

  it('gives an empty listing for a missing root', async () => {
    const { listing, entries } = await scanClaudeCode({ home, existing: nothingHere });
    expect(listing.items).toEqual([]);
    expect(entries).toEqual([]);
  });

  it('reads the folder CLAUDE_CONFIG_DIR names instead of ~/.claude and ~/.claude.json', async () => {
    await build();
    const config = join(temp, 'config');
    await write(join(config, 'commands', 'tidy.md'), '---\ndescription: Tidies.\n---\nTidy up.');
    await write(join(config, '.claude.json'), JSON.stringify({ mcpServers: { moved: { command: 'node', args: ['m.js'] } } }));
    const { listing } = await scanClaudeCode({ home, configFolder: config, existing: nothingHere });
    expect(listing.items.map(item => item.name).sort()).toEqual(['moved', 'tidy']);
    expect(listing.folder).toBe(config);
  });

  it('reads a project: its .claude, its .mcp.json and the local servers of that project only', async () => {
    const project = join(temp, 'project');
    await build();
    await write(join(project, '.claude', 'agents', 'p.md'), '---\nname: project-agent\ndescription: In project.\n---\nBody');
    await write(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { command: 'node', args: [] } } }));
    const { listing } = await scanClaudeCode({ home, projectFolder: project, existing: nothingHere });
    expect(listing.project).toBe(true);
    expect(listing.items.map(item => item.name).sort()).toEqual(['localone', 'project-agent', 'shared']);
  });

  it('does not follow a link that leaves the folder and the home folder', async () => {
    await mkdir(join(home, '.claude', 'skills'), { recursive: true });
    await write(join(outside, 'sneaky', 'SKILL.md'), 'secret outside');
    try {
      await symlink(join(outside, 'sneaky'), join(home, '.claude', 'skills', 'sneaky'), 'junction');
    } catch {
      return; // This machine does not allow links for tests.
    }
    const { listing } = await scanClaudeCode({ home, existing: nothingHere });
    expect(listing.items).toEqual([]);
    expect(listing.warnings.join(' ')).toContain('skills/sneaky');
  });

  it('follows a link that stays inside the home folder', async () => {
    await mkdir(join(home, '.claude', 'skills'), { recursive: true });
    await write(join(home, 'shared', 'linked', 'SKILL.md'), '---\ndescription: Linked.\n---\nBody');
    try {
      await symlink(join(home, 'shared', 'linked'), join(home, '.claude', 'skills', 'linked'), 'junction');
    } catch {
      return;
    }
    const { listing } = await scanClaudeCode({ home, existing: nothingHere });
    expect(listing.items.map(item => item.name)).toEqual(['linked']);
  });

  it('imports a skill, a subagent and a server end to end, then reports them as already here', async () => {
    await build();
    const { entries } = await scanClaudeCode({ home, existing: nothingHere });
    const saved: string[] = [];
    const hooks = {
      importSkill: async (skillPackage: Parameters<CoreService['importSkill']>[0]) => core.importSkill(skillPackage),
      saveMcpServer: async (draft: Parameters<typeof splitMcpDraft>[0]) => {
        const { config } = splitMcpDraft(draft, randomUUID(), { env: {}, headers: {} });
        saved.push(config.name);
        return core.saveMcpServer(config);
      },
    };
    const ids = entries.map(entry => entry.item.id);
    const results = await importClaudeCodeEntries(entries, ids, hooks);
    const status = Object.fromEntries(results.map(result => [result.name, result.status]));
    expect(status).toMatchObject({ 'pdf-notes': 'imported', 'git-commit': 'imported', github: 'imported', remote: 'imported', huge: 'skipped' });
    expect(results.find(result => result.name === 'code-reviewer')).toBeUndefined();
    const skills = store.all<Skill>('skills').filter(skill => skill.package);
    expect(skills.map(skill => skill.name).sort()).toEqual(['git-commit', 'pdf-notes']);
    expect(skills.every(skill => skill.package?.reviewedHash === undefined)).toBe(true);
    expect(saved.sort()).toEqual(['github', 'remote']);
    expect(JSON.stringify(results)).not.toContain(secret);

    const base = await core.command('saveSkill', { name: 'Base', content: 'Base instructions.' }) as Skill;
    const reviewer = entries.find(entry => entry.item.kind === 'agent')!.item.agent!;
    const mapped = orgletFromSubagent(reviewer, { defaultProvider: 'openai', claudeCodeConnected: true, defaultSkillId: base.id, usableSkills: new Map(), waitingSkills: new Set(['pdf-notes']) });
    const worker = await core.command('saveWorker', mapped.input) as Worker;
    expect(worker).toMatchObject({ name: 'code-reviewer', provider: 'claude-code', modelId: 'sonnet', skillId: base.id });
    expect(worker.mcpServerIds).toBeUndefined();

    const names: ExistingNames = {
      skills: new Set(store.all<Skill>('skills').map(skill => skill.name)),
      workers: new Set(['code-reviewer']),
      mcp: new Set(saved),
    };
    const again = await scanClaudeCode({ home, existing: names });
    expect(again.listing.items.filter(item => item.alreadyHere).map(item => item.name).sort()).toEqual(['code-reviewer', 'git-commit', 'github', 'pdf-notes', 'remote']);
    const second = await importClaudeCodeEntries(again.entries, again.entries.map(entry => entry.item.id), hooks);
    expect(second.filter(result => result.status === 'imported')).toEqual([]);
    expect(second.find(result => result.name === 'github')?.reason).toBe('Đã có trong Orglet.');
  });

  it('never repeats a secret in a failure', async () => {
    await build();
    const { entries } = await scanClaudeCode({ home, existing: nothingHere });
    const results = await importClaudeCodeEntries(entries, ['mcp:user:github', 'mcp:user:remote'], {
      importSkill: async () => { throw new Error('unused'); },
      saveMcpServer: async () => { throw new Error(`could not start with ${secret} in it`); },
    });
    expect(results.map(result => result.status)).toEqual(['failed', 'failed']);
    expect(JSON.stringify(results)).not.toContain(secret);
  });
});
