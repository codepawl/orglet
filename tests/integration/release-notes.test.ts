import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseHighlights } from '../../apps/desktop/src/shared/release-notes';

/** The body of a real GitHub Release, as `gh release view <tag> --json body` printed it on 2026-09-25. */
function releaseBody(tag: string): string {
  return readFileSync(`tests/fixtures/releases/${tag}.md`, 'utf8');
}

const boilerplate = [/\*\*Orglet \d/, /If you (run|installed) 0\.2\.4/, /Before you install/, /not signed/, /AGPL-3\.0/, /windows-release-gates/];

describe('releaseHighlights (COD-237)', () => {
  it.each(['v0.3.1', 'v0.3.0', 'v0.2.11', 'v0.2.9', 'v0.2.5'])('keeps only what changed in %s', tag => {
    const highlights = releaseHighlights(releaseBody(tag));
    for (const pattern of boilerplate) expect(highlights).not.toMatch(pattern);
    expect(highlights.startsWith('### ')).toBe(true);
    expect(highlights).toBe(highlights.trim());
  });

  it('keeps every section and paragraph of 0.3.1 that says what changed', () => {
    expect(releaseHighlights(releaseBody('v0.3.1'))).toBe([
      '### `orglet` is on your PATH without a click',
      '',
      'Setup now puts the `orglet` command on your PATH when it installs or updates Orglet, the way VS Code\'s installer does. After this update, open a new terminal and `orglet status` works. A terminal that was already open still has the old PATH.',
      '',
      'It only touches your own user PATH. If you would rather not have it, **Settings → About → Remove from PATH** takes it off, and later updates leave it off. Uninstalling Orglet now removes the PATH entry too; in 0.3.0 it stayed behind.',
    ].join('\n'));
  });

  it('keeps code blocks, lists and links inside the sections', () => {
    const release030 = releaseHighlights(releaseBody('v0.3.0'));
    expect(release030).toContain('orglet send "summarize this" --to Researcher --file notes.md');
    expect(release030).toContain('How it works: [cli.md](https://github.com/codepawl/orglet/blob/main/docs/cli.md).');
    expect(release030.match(/^### /gm)).toHaveLength(3);
    const release029 = releaseHighlights(releaseBody('v0.2.9'));
    expect(release029).toContain('### Fixes');
    expect(release029).toContain('- A signed-out Cursor Agent shows as signed out instead of a sign-in error.');
  });

  it('keeps an opening paragraph that is not about how the update arrives', () => {
    const highlights = releaseHighlights(releaseBody('v0.2.4'));
    expect(highlights.startsWith('This is the first build that updates itself.')).toBe(true);
    expect(highlights).toContain('### Runs that finish');
    expect(highlights).not.toContain('0.2.3 and earlier don\'t update themselves');
  });

  it('leaves notes it does not recognise as they are', () => {
    const body = releaseBody('v0.2.2');
    expect(releaseHighlights(body)).toBe(body.trim());
  });

  it('matches the boilerplate whatever the case, spacing and line endings', () => {
    const notes = [
      '  ** ORGLET v1.2.3 **   FOR Windows and macOS.',
      '',
      'if  you RUN 1.0 or later, it arrives by itself.',
      'It is used the next time you start Orglet.',
      '',
      '##  What changed',
      '',
      'Something new.',
      '',
      '###   before   YOU  install  ###',
      '',
      'Advice.',
    ].join('\r\n');
    expect(releaseHighlights(notes)).toBe('##  What changed\n\nSomething new.');
  });

  it('leaves nothing when a release is only boilerplate', () => {
    const notes = '**Orglet 0.2.12** for Windows.\n\nIf you run 0.2.4 or later from Setup, this update arrives by itself.\n\n### Before you install\n\nThe installer is still not signed.\n';
    expect(releaseHighlights(notes)).toBe('');
    expect(releaseHighlights('')).toBe('');
  });

  it('does not cut inside a code block or drop a later paragraph that starts the same way', () => {
    const notes = [
      '### Scripts',
      '',
      'If you run a script, it now waits.',
      '',
      '```',
      '### Before you install',
      '```',
      '',
      'Last line.',
    ].join('\n');
    expect(releaseHighlights(notes)).toBe(notes);
  });
});
