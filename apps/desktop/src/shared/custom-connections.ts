import { z } from 'zod';

/**
 * Custom OpenAI-compatible connections (COD-242): a name and a base URL the person typed, such as LM Studio at
 * http://localhost:1234/v1, Groq or a company proxy. Each one is a provider of its own, named `custom:<id>`, so the
 * budget ledger, request slots, consent and the model-list cache keep one entry per connection without a second key.
 * The key, when there is one, lives in main's credential store under the same id; this record never holds it.
 */
export const CUSTOM_PROVIDER_PREFIX = 'custom:';
export const CustomProviderId = z.templateLiteral([CUSTOM_PROVIDER_PREFIX, z.uuid()]);
export type CustomProviderId = z.infer<typeof CustomProviderId>;

/** Enough for a handful of local servers and hosted APIs side by side; the settings list stays short. */
export const MAX_CUSTOM_CONNECTIONS = 16;
export const MAX_BASE_URL_LENGTH = 500;

export const CustomConnectionName = z.string().trim().min(1).max(60);

/** $1,000 per million tokens, far above any real price; a typo with extra zeros is refused rather than reserved. */
export const MAX_PRICE_MICROS_PER_MILLION = 1_000_000_000;
const MicrosPerMillion = z.number().int().min(0).max(MAX_PRICE_MICROS_PER_MILLION);

/** What the person says the server charges, in integer USD micros per million tokens. Both sides or neither. */
export const CustomConnectionPrice = z.object({
  inputMicrosPerMillion: MicrosPerMillion,
  outputMicrosPerMillion: MicrosPerMillion,
}).strict();
export type CustomConnectionPrice = z.infer<typeof CustomConnectionPrice>;

export const CustomConnection = z.object({
  id: z.uuid(),
  name: CustomConnectionName,
  baseUrl: z.string().min(1).max(MAX_BASE_URL_LENGTH),
  price: CustomConnectionPrice.optional(),
}).strict();
export type CustomConnection = z.infer<typeof CustomConnection>;

export const CustomConnectionInput = z.object({
  id: z.uuid().optional(),
  name: CustomConnectionName,
  baseUrl: z.string().trim().min(1).max(MAX_BASE_URL_LENGTH),
  // Absent or null: no price of its own, so a local server is free and a remote one is unknown.
  price: CustomConnectionPrice.nullable().optional(),
}).strict();
export type CustomConnectionInput = z.infer<typeof CustomConnectionInput>;

export function isCustomProvider(provider: string): provider is CustomProviderId {
  return CustomProviderId.safeParse(provider).success;
}

export function customProviderId(connectionId: string): CustomProviderId {
  return CustomProviderId.parse(`${CUSTOM_PROVIDER_PREFIX}${connectionId}`);
}

/** The connection id inside a `custom:<id>` provider, or undefined for any other provider. */
export function connectionIdOf(provider: string): string | undefined {
  if (!isCustomProvider(provider)) return undefined;
  return provider.slice(CUSTOM_PROVIDER_PREFIX.length);
}

export function findCustomConnection(connections: readonly CustomConnection[], provider: string): CustomConnection | undefined {
  const connectionId = connectionIdOf(provider);
  if (!connectionId) return undefined;
  return connections.find(connection => connection.id === connectionId);
}

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string };

export const BASE_URL_ERRORS = {
  invalid: 'Nhập địa chỉ đầy đủ, ví dụ http://localhost:1234/v1.',
  scheme: 'Địa chỉ phải bắt đầu bằng http:// hoặc https://.',
  credentials: 'Không đặt tên đăng nhập hay mật khẩu trong địa chỉ. Nhập API key vào ô riêng.',
  query: 'Bỏ phần ?… và #… khỏi địa chỉ. Nhập API key vào ô riêng.',
  insecureRemote: 'http:// chỉ dùng cho máy này hoặc mạng nội bộ. Máy chủ khác cần https://.',
  tooLong: 'Địa chỉ quá dài.',
} as const;

/**
 * The rule for a base URL. https goes anywhere. Plain http is allowed only to this computer and to private-network
 * addresses, where a local model server usually lives; to any other host it is refused rather than warned about,
 * because the key and every prompt would cross the internet unencrypted. The URL may not carry a user name, a
 * password, a query string or a fragment: a key belongs in the key field, where it is encrypted, never in an
 * address that is stored in plain text and backed up.
 */
export function checkBaseUrl(raw: string): BaseUrlCheck {
  const text = raw.trim();
  if (text.length > MAX_BASE_URL_LENGTH) return { ok: false, error: BASE_URL_ERRORS.tooLong };
  if (text.includes('?') || text.includes('#')) return { ok: false, error: BASE_URL_ERRORS.query };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: BASE_URL_ERRORS.invalid };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: BASE_URL_ERRORS.scheme };
  if (url.username || url.password) return { ok: false, error: BASE_URL_ERRORS.credentials };
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return { ok: false, error: BASE_URL_ERRORS.insecureRemote };
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.origin}${path}` };
}

/** Where a connection's price comes from, for the label beside it and the cost note in the orglet editor. */
export type ConnectionPricing =
  | { kind: 'entered'; price: CustomConnectionPrice }
  | { kind: 'local'; price: CustomConnectionPrice }
  | { kind: 'unknown' };

const FREE: CustomConnectionPrice = { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 };

/**
 * The price Orglet charges a connection's requests at. A price the person entered always wins. Without one, a server
 * on this computer or a private network costs nothing, which is a known price; any other server stays unknown.
 */
export function connectionPricing(connection: Pick<CustomConnection, 'baseUrl' | 'price'>): ConnectionPricing {
  if (connection.price) return { kind: 'entered', price: connection.price };
  if (isLocalConnection(connection)) return { kind: 'local', price: FREE };
  return { kind: 'unknown' };
}

/** A base URL on this computer or a private network: the same addresses plain http is allowed for. */
export function isLocalConnection(connection: Pick<CustomConnection, 'baseUrl'>): boolean {
  try {
    return isLocalHost(new URL(connection.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** Host part of a saved base URL, for a short line under the connection's name. */
export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * This computer or a private network, judged from the address as written (the WHATWG parser has already turned
 * decimal and hex IPv4 forms into dotted ones and compressed IPv6). A name other than localhost or an mDNS `.local`
 * name could resolve anywhere, so it counts as remote.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.startsWith('[') && host.endsWith(']')) return isLocalIpv6(host.slice(1, -1));
  const octets = ipv4Octets(host);
  return octets ? isLocalIpv4(octets) : false;
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map(part => /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN);
  return octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}

function isLocalIpv4([first, second]: number[]): boolean {
  if (first === 127 || first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  // Shared address space (100.64.0.0/10) is never routed on the internet; Tailscale gives machines these addresses.
  return first === 100 && second >= 64 && second <= 127;
}

function isLocalIpv6(address: string): boolean {
  if (address === '::1') return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return isLocalIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  const firstGroup = address.split(':')[0];
  if (!firstGroup) return false;
  const value = parseInt(firstGroup, 16);
  // fc00::/7 unique local addresses, fe80::/10 link-local.
  const uniqueLocal = (value & 0xfe00) === 0xfc00;
  const linkLocal = (value & 0xffc0) === 0xfe80;
  return firstGroup.length === 4 && (uniqueLocal || linkLocal);
}
