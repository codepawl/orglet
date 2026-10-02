/** Shared recognizers; telemetry deliberately masks more broadly than publishing refuses. */
export const KEY_PREFIXES = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs]|glpat|AKIA|AIza|ya29)[-_][A-Za-z0-9_\-]{8,}/g;
export const TELEMETRY_BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
export const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

const PUBLISHING_RULES = [
  { rule: 'credential-key', pattern: KEY_PREFIXES },
  { rule: 'credential-key', pattern: /\b(?:AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})\b/g },
  { rule: 'credential-jwt', pattern: JWT },
  { rule: 'credential-authorization', pattern: /\bauthorization\s*[:=]\s*["']?(?:Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  // Standalone Bearer needs an opaque token shape; ordinary authentication prose remains valid.
  { rule: 'credential-authorization', pattern: /\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+(?:(?=[A-Za-z0-9._~+/=-]*[0-9=])|(?=[A-Za-z0-9._~+/=-]*[._~+/-][A-Za-z0-9])|(?=[A-Za-z0-9._~+/=-]*[a-z])(?=[A-Za-z0-9._~+/=-]*[A-Z]))[A-Za-z0-9._~+/=-]{8,}/g },
  { rule: 'credential-assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*["']?[^\s"'`;,]{8,}/gi },
  { rule: 'credential-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
] as const;

/** Return locations only. Fresh regexp instances make repeated scans deterministic. */
export const MAX_CREDENTIAL_DIAGNOSTICS = 100;
export function credentialLocations(text: string, limit = MAX_CREDENTIAL_DIAGNOSTICS): { rule: string; line: number }[] {
  const locations: { rule: string; line: number }[] = [];
  const seen = new Set<string>();
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') lineStarts.push(index + 1);
  }
  const budget = Math.min(limit, MAX_CREDENTIAL_DIAGNOSTICS);
  for (const { rule, pattern } of PUBLISHING_RULES) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      let lower = 0;
      let upper = lineStarts.length;
      while (lower + 1 < upper) {
        const middle = Math.floor((lower + upper) / 2);
        if (lineStarts[middle] <= match.index) lower = middle;
        else upper = middle;
      }
      const line = lower + 1;
      const identity = `${rule}:${line}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        locations.push({ rule, line });
        if (locations.length >= budget) return locations;
      }
    }
  }
  return locations;
}
