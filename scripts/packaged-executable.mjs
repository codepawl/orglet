import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Packaged binary produced by `pnpm make` / `pnpm build` on this OS. */
export function packagedExecutable() {
  const arch = process.arch;
  const lookup = {
    win32: [
      resolve('out/Orglet-win32-x64/Orglet.exe'),
      resolve(`out/Orglet-win32-${arch}/Orglet.exe`),
    ],
    darwin: [
      resolve(`out/Orglet-darwin-${arch}/Orglet.app/Contents/MacOS/Orglet`),
      resolve('out/Orglet-darwin-arm64/Orglet.app/Contents/MacOS/Orglet'),
      resolve('out/Orglet-darwin-x64/Orglet.app/Contents/MacOS/Orglet'),
    ],
  }[process.platform];
  if (!lookup) throw new Error(`Packaged smoke has no executable path for ${process.platform}.`);
  const found = lookup.find(path => existsSync(path));
  if (!found) throw new Error(`Packaged Orglet not found. Run pnpm make first.\nLooked for:\n${lookup.join('\n')}`);
  return found;
}
