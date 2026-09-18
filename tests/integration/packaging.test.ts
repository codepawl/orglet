import { describe, expect, it } from 'vitest';
import config from '../../forge.config';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';

describe('forge packaging', () => {
  it('zips Windows and macOS, and squirrels Windows only', () => {
    const zip = config.makers.find(maker => maker instanceof MakerZIP);
    const squirrel = config.makers.find(maker => maker instanceof MakerSquirrel);
    expect(zip?.platforms).toEqual(['win32', 'darwin']);
    expect(squirrel?.platforms).toEqual(['win32']);
  });

  it('packs DuckDB addons for Windows and macOS and does not claim signing or notarization', () => {
    const ignore = config.packagerConfig.ignore as (path: string) => boolean;
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-arm64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-darwin-x64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/@duckdb/node-bindings-win32-x64/duckdb.node')).toBe(false);
    expect(ignore('/node_modules/left-pad')).toBe(true);
    expect(config.packagerConfig.osxSign).toBeUndefined();
    expect(config.packagerConfig.osxNotarize).toBeUndefined();
    const asar = config.packagerConfig.asar;
    expect(asar && typeof asar === 'object' ? asar.unpack : '').toMatch(/node.*dylib|dylib.*node/);
  });
});
