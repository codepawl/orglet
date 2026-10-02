import { MARKET_BODY_LIMIT } from '../../../apps/desktop/src/shared/market';

export const BODY_CHUNK_BYTES = 256 * 1024;

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bodyChunks(text: string): Uint8Array<ArrayBuffer>[] {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length || bytes.length > MARKET_BODY_LIMIT) throw new Error('market_body');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < bytes.length; offset += BODY_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + BODY_CHUNK_BYTES));
  }
  return chunks;
}

export async function joinBody(
  chunks: { ordinal: number; body: number[] }[],
  expected: { body_bytes: number; chunk_count: number; body_sha256: string },
): Promise<Uint8Array<ArrayBuffer>> {
  if (expected.body_bytes < 1 || expected.body_bytes > MARKET_BODY_LIMIT || expected.chunk_count < 1 || expected.chunk_count > 8) throw new Error('market_integrity');
  if (chunks.length !== expected.chunk_count) throw new Error('market_integrity');
  const bytes = new Uint8Array(expected.body_bytes);
  let offset = 0;
  for (const [ordinal, chunk] of chunks.entries()) {
    if (chunk.ordinal !== ordinal || !Array.isArray(chunk.body) || chunk.body.length < 1 || chunk.body.length > BODY_CHUNK_BYTES) throw new Error('market_integrity');
    if (chunk.body.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255) || offset + chunk.body.length > bytes.length) throw new Error('market_integrity');
    bytes.set(chunk.body, offset);
    offset += chunk.body.length;
  }
  if (offset !== bytes.length || await sha256(bytes) !== expected.body_sha256) throw new Error('market_integrity');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return bytes;
}
