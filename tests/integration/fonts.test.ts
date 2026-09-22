import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, describe } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { BUNDLED_CODE_FONT, BUNDLED_INTERFACE_FONT, FontFamily, fontStack } from '../../apps/desktop/src/shared/fonts';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';

describe('fonts', () => {
  it('keeps the bundled font behind whatever the person picked', () => {
    expect(fontStack('interface')).toMatch(new RegExp(`^"${BUNDLED_INTERFACE_FONT}", ui-sans-serif`));
    expect(fontStack('code')).toMatch(new RegExp(`^"${BUNDLED_CODE_FONT}", ui-monospace`));
    // A chosen family comes first, and the bundled one stays as the next fallback rather than being replaced.
    expect(fontStack('interface', 'Segoe UI')).toBe(`"Segoe UI", "${BUNDLED_INTERFACE_FONT}", ${fontStack('interface').slice(`"${BUNDLED_INTERFACE_FONT}", `.length)}`);
    // Picking the bundled font by name is not the same family twice.
    expect(fontStack('code', BUNDLED_CODE_FONT)).toBe(fontStack('code'));
  });

  it('refuses a family name that could carry more CSS than a family name', () => {
    for (const name of ['Inter; color:red', 'Inter", x:url(http://a)', 'a, b', 'Inter}', '']) {
      expect(FontFamily.safeParse(name).success).toBe(false);
      // Whatever is refused never reaches the stylesheet: the stack falls back to the bundled font.
      expect(fontStack('interface', name)).toBe(fontStack('interface'));
    }
    expect(FontFamily.safeParse('IBM Plex Sans').success).toBe(true);
    expect(FontFamily.safeParse('Times New Roman 3.0').success).toBe(true);
  });

  it('stores a font choice and puts it back with null', async () => {
    const store = new Store(':memory:');
    const core = new CoreService(store, () => {}, async () => { throw new Error('No adapter in this test'); });
    const settings = (patch: object) => core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, ...patch });
    const workspace = () => store.workspace() as Workspace;

    expect(workspace().interfaceFont).toBeUndefined();
    await settings({ interfaceFont: 'Segoe UI', codeFont: 'Fira Code' });
    expect(workspace()).toEqual(expect.objectContaining({ interfaceFont: 'Segoe UI', codeFont: 'Fira Code' }));
    // An unrelated settings change leaves both alone.
    await settings({ theme: 'dark' });
    expect(workspace().interfaceFont).toBe('Segoe UI');
    await settings({ interfaceFont: null });
    expect(workspace().interfaceFont).toBeUndefined();
    expect(workspace().codeFont).toBe('Fira Code');
    await expect(settings({ codeFont: 'Fira, Code' })).rejects.toThrow();
    store.close();
  });

  it('ships every face it declares, with the licence beside it', () => {
    const styles = readFileSync('apps/desktop/src/renderer/styles.css', 'utf8');
    const declared = [...styles.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map(match => match[1]);
    expect(declared).toEqual(['InterVariable.woff2', 'JetBrainsMono-Regular.woff2', 'JetBrainsMono-SemiBold.woff2', 'JetBrainsMono-Italic.woff2']);
    for (const file of [...declared, 'Inter-OFL.txt', 'JetBrainsMono-OFL.txt']) {
      expect(statSync(join('apps/desktop/src/renderer/fonts', file)).size).toBeGreaterThan(1000);
    }
    // Both families are declared under the names shared/fonts.ts asks for, or the stack would fall straight through.
    for (const family of [BUNDLED_INTERFACE_FONT, BUNDLED_CODE_FONT]) expect(styles).toContain(`font-family:"${family}"`);
  });

  it('routes every monospace surface through the one token', () => {
    const styles = readFileSync('apps/desktop/src/renderer/styles.css', 'utf8');
    expect(styles).not.toMatch(/font-family:\s*ui-monospace/);
    expect(styles).toContain('--font-mono:');
  });
});
