import { existsSync } from 'node:fs';
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

describe('forge packaging', () => {
  const makers = config.makers ?? [];
  const packager = config.packagerConfig ?? {};

  it('zips Windows and macOS, and squirrels Windows only', () => {
    const zip = makers.find(maker => maker instanceof MakerZIP);
    const squirrel = makers.find(maker => maker instanceof MakerSquirrel);
    expect(zip?.platforms).toEqual(['win32', 'darwin']);
    expect(squirrel?.platforms).toEqual(['win32']);
  });

  it('packs DuckDB addons for Windows and macOS and leaves signing off by default', () => {
    const ignore = packager.ignore as (path: string) => boolean;
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-arm64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-x64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-win32-x64/duckdb.node')).toBe(false);
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
});
