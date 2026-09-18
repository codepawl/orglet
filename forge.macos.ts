import type { NotaryToolCredentials } from '@electron/notarize/lib/types';
import type { OsxSignOptions } from '@electron/packager/dist/types';

/** Public Developer ID Application identity from the leaf certificate (Team ID D884WZQ6N4). */
export const DEVELOPER_ID_APPLICATION_IDENTITY =
  'Developer ID Application: Xuan An Nguyen (D884WZQ6N4)';

export const MACOS_ENTITLEMENTS = 'build/entitlements.darwin.plist';
export const MACOS_ENTITLEMENTS_INHERIT = 'build/entitlements.darwin.inherit.plist';

function trim(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/**
 * CI sets APPLE_SIGNING_ENABLED=true after importing the Developer ID P12.
 * Local `pnpm make` stays unsigned unless that flag is set and the identity is in the keychain.
 */
export function resolveOsxSign(env: NodeJS.ProcessEnv = process.env): OsxSignOptions | undefined {
  if (env.APPLE_SIGNING_ENABLED !== 'true') {
    return undefined;
  }
  const identity = trim(env.APPLE_IDENTITY) ?? DEVELOPER_ID_APPLICATION_IDENTITY;
  return {
    identity,
    preEmbedProvisioningProfile: false,
    optionsForFile: filePath => {
      const helper = filePath.includes(' Helper');
      return {
        hardenedRuntime: true,
        entitlements: helper ? MACOS_ENTITLEMENTS_INHERIT : MACOS_ENTITLEMENTS,
      };
    },
  };
}

/**
 * Notarization needs Apple ID + app-specific password + team ID, or an App Store Connect
 * API key (.p8 path + key id + issuer). Developer ID cert/P12 files are not enough.
 */
export function resolveOsxNotarize(env: NodeJS.ProcessEnv = process.env): NotaryToolCredentials | undefined {
  if (!resolveOsxSign(env)) {
    return undefined;
  }
  const appleApiKey = trim(env.APPLE_API_KEY);
  const appleApiKeyId = trim(env.APPLE_API_KEY_ID);
  const appleApiIssuer = trim(env.APPLE_API_ISSUER);
  if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    return { appleApiKey, appleApiKeyId, appleApiIssuer };
  }
  const appleId = trim(env.APPLE_ID);
  const appleIdPassword = trim(env.APPLE_APP_SPECIFIC_PASSWORD);
  const teamId = trim(env.APPLE_TEAM_ID) ?? 'D884WZQ6N4';
  if (appleId && appleIdPassword) {
    return { appleId, appleIdPassword, teamId };
  }
  return undefined;
}
