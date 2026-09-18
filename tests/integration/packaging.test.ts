import { describe, expect, it } from 'vitest';
import config from '../../forge.config';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';

describe('forge packaging', () => {
  const makers = config.makers ?? [];
  const packager = config.packagerConfig ?? {};

  it('zips Windows and macOS, and squirrels Windows only', () => {
    const zip = makers.find(maker => maker instanceof MakerZIP);
    const squirrel = makers.find(maker => maker instanceof MakerSquirrel);
    expect(zip?.platforms).toEqual(['win32', 'darwin']);
    expect(squirrel?.platforms).toEqual(['win32']);
  });

  it('packs DuckDB addons for Windows and macOS and does not claim signing or notarization', () => {
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
});
