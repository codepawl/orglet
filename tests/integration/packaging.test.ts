import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../forge.config';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import {
  DEVELOPER_ID_APPLICATION_IDENTITY,
  MACOS_ENTITLEMENTS,
  MACOS_ENTITLEMENTS_INHERIT,
  resolveOsxNotarize,
  resolveOsxSign,
} from '../../forge.macos';
import {
  assertPackageSigned,
  CERTUM_TIMESTAMP_SERVER,
  resolveSquirrelSign,
  resolveWindowsSign,
  signtoolParameters,
} from '../../forge.windows';

describe('forge packaging', () => {
  const makers = config.makers ?? [];
  const packager = config.packagerConfig ?? {};

  it('zips every desktop platform, and squirrels Windows only', () => {
    const zip = makers.find(maker => maker instanceof MakerZIP);
    const squirrel = makers.find(maker => maker instanceof MakerSquirrel);
    expect(zip?.platforms).toEqual(['win32', 'darwin', 'linux']);
    expect(squirrel?.platforms).toEqual(['win32']);
  });

  it('packs DuckDB addons for every desktop platform and leaves signing off by default', () => {
    const ignore = packager.ignore as (path: string) => boolean;
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-arm64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-x64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-win32-x64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-linux-x64/duckdb.node')).toBe(false);
    // A musl distribution needs its own addon, so the glibc one alone is not enough.
    expect(ignore('/node_modules/@duckdb/node-bindings-linux-x64-musl/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/left-pad')).toBe(true);
    expect(packager.osxSign).toBeUndefined();
    expect(packager.osxNotarize).toBeUndefined();
    const asar = packager.asar;
    expect(asar && typeof asar === 'object' ? asar.unpack : '').toMatch(/node.*dylib|dylib.*node/);
  });

  it('enables Developer ID signing only when APPLE_SIGNING_ENABLED=true', () => {
    expect(resolveOsxSign({})).toBeUndefined();
    expect(resolveOsxSign({ APPLE_SIGNING_ENABLED: 'false' })).toBeUndefined();
    const sign = resolveOsxSign({ APPLE_SIGNING_ENABLED: 'true' });
    expect(sign).toEqual(expect.objectContaining({
      identity: DEVELOPER_ID_APPLICATION_IDENTITY,
      preEmbedProvisioningProfile: false,
    }));
    expect(sign?.optionsForFile?.('/out/Orglet.app/Contents/MacOS/Orglet')).toEqual({
      hardenedRuntime: true,
      entitlements: MACOS_ENTITLEMENTS,
    });
    expect(sign?.optionsForFile?.('/out/Orglet.app/Contents/Frameworks/Orglet Helper (GPU).app/Contents/MacOS/Orglet Helper (GPU)')).toEqual({
      hardenedRuntime: true,
      entitlements: MACOS_ENTITLEMENTS_INHERIT,
    });
    expect(resolveOsxSign({
      APPLE_SIGNING_ENABLED: 'true',
      APPLE_IDENTITY: '  Developer ID Application: Other (TEAM)  ',
    })?.identity).toBe('Developer ID Application: Other (TEAM)');
    expect(existsSync(MACOS_ENTITLEMENTS)).toBe(true);
    expect(existsSync(MACOS_ENTITLEMENTS_INHERIT)).toBe(true);
  });

  it('does not notarize unless Apple ID or App Store Connect API key env is complete', () => {
    const signing = { APPLE_SIGNING_ENABLED: 'true' };
    expect(resolveOsxNotarize({})).toBeUndefined();
    expect(resolveOsxNotarize(signing)).toBeUndefined();
    expect(resolveOsxNotarize({ ...signing, APPLE_ID: 'an@example.com' })).toBeUndefined();
    expect(resolveOsxNotarize({
      ...signing,
      APPLE_API_KEY: '/tmp/AuthKey.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
    })).toBeUndefined();
    expect(resolveOsxNotarize({
      ...signing,
      APPLE_ID: 'an@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific',
    })).toEqual({
      appleId: 'an@example.com',
      appleIdPassword: 'app-specific',
      teamId: 'D884WZQ6N4',
    });
    expect(resolveOsxNotarize({
      ...signing,
      APPLE_API_KEY: '/tmp/AuthKey.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
      APPLE_ID: 'ignored@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'ignored',
    })).toEqual({
      appleApiKey: '/tmp/AuthKey.p8',
      appleApiKeyId: 'ABCDE12345',
      appleApiIssuer: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('signs Windows builds only when WINDOWS_SIGNING_ENABLED=true, by thumbprint, SHA-256 and timestamped', () => {
    const thumbprint = '0123456789ABCDEF0123456789ABCDEF01234567';
    expect(packager.windowsSign).toBeUndefined();
    expect(resolveWindowsSign({})).toBeUndefined();
    expect(resolveSquirrelSign({})).toBeUndefined();
    expect(resolveSquirrelSign({ WINDOWS_SIGNING_ENABLED: 'false', WINDOWS_CERTIFICATE_SHA1: thumbprint })).toBeUndefined();
    // Asking for signing without a certificate must fail the build rather than ship it unsigned.
    expect(() => resolveWindowsSign({ WINDOWS_SIGNING_ENABLED: 'true' })).toThrow(/WINDOWS_CERTIFICATE_SHA1/);
    const enabled = { WINDOWS_SIGNING_ENABLED: 'true', WINDOWS_CERTIFICATE_SHA1: ` ${thumbprint} ` };
    expect(typeof resolveWindowsSign(enabled)?.hookFunction).toBe('function');
    expect(resolveSquirrelSign(enabled)).toBe(`/sha1 ${thumbprint} /fd sha256 /tr ${CERTUM_TIMESTAMP_SERVER} /td sha256`);
    expect(signtoolParameters(thumbprint)).not.toContain('/a');
  });

  const microsoftSigned = 'node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe';
  it.runIf(process.platform === 'win32' && existsSync(microsoftSigned))('leaves a file that already carries a valid signature alone', async () => {
    // No certificate has this thumbprint, so an attempt to sign would make signtool fail and the hook throw.
    const sign = resolveWindowsSign({ WINDOWS_SIGNING_ENABLED: 'true', WINDOWS_CERTIFICATE_SHA1: '0'.repeat(40) });
    await expect(Promise.resolve(sign?.hookFunction?.(resolve(microsoftSigned)))).resolves.toBeUndefined();
  });

  it.runIf(process.platform === 'win32' && existsSync(microsoftSigned))('fails a package that holds an unsigned binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orglet-signing-'));
    try {
      mkdirSync(join(directory, 'resources'));
      copyFileSync(microsoftSigned, join(directory, 'resources', 'signed.exe'));
      expect(() => assertPackageSigned([directory])).not.toThrow();
      writeFileSync(join(directory, 'resources', 'unsigned.dll'), 'not a signed binary');
      expect(() => assertPackageSigned([directory])).toThrow(/unsigned\.dll/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
