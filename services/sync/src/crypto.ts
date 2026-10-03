const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export type Ciphertext = { iv: string; body: string };
export type WrappedKey = Ciphertext & { version: number; generation: string };
export type MasterKeys = { active: number; keys: ReadonlyMap<number, CryptoKey> };

function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('Invalid encrypted value');
  const decoded = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (base64(decoded) !== value) throw new Error('Invalid encrypted value');
  return decoded;
}
function base64(value: Uint8Array): string {
  let encoded = '';
  for (const byte of value) encoded += String.fromCharCode(byte);
  return btoa(encoded);
}
async function aes(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);
}

/** Only the Worker secret carries master keys. Never persist or log this parsed configuration. */
export async function masterKeys(secret: string): Promise<MasterKeys> {
  const input: unknown = JSON.parse(secret);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid master key configuration');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== 'active' && key !== 'keys') || !Number.isSafeInteger(value.active)
    || Number(value.active) < 1 || !value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)) throw new Error('Invalid master key configuration');
  const keys = new Map<number, CryptoKey>();
  const entries = Object.entries(value.keys);
  if (!entries.length || entries.length > 8) throw new Error('Invalid master key configuration');
  for (const [version, encoded] of entries) {
    if (!/^[1-9][0-9]{0,8}$/.test(version) || typeof encoded !== 'string') throw new Error('Invalid master key configuration');
    keys.set(Number(version), await aes(bytes(encoded)));
  }
  if (!keys.has(Number(value.active))) throw new Error('Active master key is missing');
  return { active: Number(value.active), keys };
}

async function sealBytes(key: CryptoKey, value: Uint8Array<ArrayBuffer>, aad: string): Promise<Ciphertext> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 }, key, value);
  return { iv: base64(iv), body: base64(new Uint8Array(body)) };
}
async function openBytes(key: CryptoKey, value: Ciphertext, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = bytes(value.iv);
  if (iv.length !== 12) throw new Error('Invalid encrypted value');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 }, key, bytes(value.body)));
}
function keyContext(account: string, generation: string, version: number): string {
  return JSON.stringify(['orglet-sync-key', account, generation, version]);
}
export async function createAccountKey(account: string, masters: MasterKeys): Promise<{ key: CryptoKey; wrapped: WrappedKey }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const generation = crypto.randomUUID();
  const wrapped = await sealBytes(masters.keys.get(masters.active)!, raw, keyContext(account, generation, masters.active));
  return { key: await aes(raw), wrapped: { ...wrapped, generation, version: masters.active } };
}
export async function unwrapAccountKey(account: string, wrapped: WrappedKey, masters: MasterKeys): Promise<CryptoKey> {
  const master = masters.keys.get(wrapped.version);
  if (!master) throw new Error('Master key version is unavailable');
  return aes(await openBytes(master, wrapped, keyContext(account, wrapped.generation, wrapped.version)));
}
export async function rewrapAccountKey(account: string, wrapped: WrappedKey, masters: MasterKeys): Promise<WrappedKey> {
  const previous = masters.keys.get(wrapped.version);
  if (!previous) throw new Error('Master key version is unavailable');
  const raw = await openBytes(previous, wrapped, keyContext(account, wrapped.generation, wrapped.version));
  const next = await sealBytes(masters.keys.get(masters.active)!, raw, keyContext(account, wrapped.generation, masters.active));
  return { ...next, version: masters.active, generation: wrapped.generation };
}
export async function encryptRow(key: CryptoKey, value: string, context: readonly (string | number)[]): Promise<Ciphertext> {
  return sealBytes(key, encoder.encode(value), JSON.stringify(['orglet-sync-row', ...context]));
}
export async function decryptRow(key: CryptoKey, value: Ciphertext, context: readonly (string | number)[]): Promise<string> {
  return decoder.decode(await openBytes(key, value, JSON.stringify(['orglet-sync-row', ...context])));
}
function fileContext(context: readonly (string | number)[]): string {
  return JSON.stringify(['orglet-sync-file', ...context]);
}
/** A file is stored as its 12-byte nonce followed by the AES-GCM ciphertext, bound to the account, hash and size. */
export async function encryptFile(key: CryptoKey, value: Uint8Array<ArrayBuffer>, context: readonly (string | number)[]): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(fileContext(context)), tagLength: 128 }, key, value));
  const sealed = new Uint8Array(iv.length + body.length);
  sealed.set(iv);
  sealed.set(body, iv.length);
  return sealed;
}
export async function decryptFile(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, context: readonly (string | number)[]): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < 28) throw new Error('Invalid encrypted value');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: encoder.encode(fileContext(context)), tagLength: 128 },
    key, sealed.slice(12)));
}
