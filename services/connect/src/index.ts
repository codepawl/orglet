/**
 * Orglet's token broker for Google (connect.orglet.codepawl.com). Google's "Web application" OAuth clients need a
 * client secret at the token endpoint, and a secret cannot ship in a desktop app. The app signs in with CodePawl's
 * public client ID, and this Worker adds the secret to the two token requests the app makes (the code exchange and the
 * refresh) and returns Google's answer unchanged. It stores nothing and never logs a body, a code or a token.
 */
export type Env = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_REDIRECT_URI: string;
  /** Set with `wrangler secret put GOOGLE_CLIENT_SECRET`; never in this repo. */
  GOOGLE_CLIENT_SECRET: string;
};

export type FetchGoogle = (url: string, init: RequestInit) => Promise<Response>;

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const TOKEN_PATH = '/google/token';
/** A real token request is a few hundred bytes; the longest field is an authorization code or a PKCE verifier. */
export const MAX_BODY_BYTES = 4096;

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

function oauthError(status: number, error: string, description?: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, ...(description ? { error_description: description } : {}) }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
  });
}

/** Reads the body up to the cap, so an oversized upload is dropped without being held in memory. */
async function readCappedText(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function singleValue(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  return values.length === 1 && values[0] ? values[0] : undefined;
}

/** The fields Google gets, copied one by one, so nothing else the app (or anyone) sends is forwarded. */
function googleFormFor(form: URLSearchParams, env: Env): URLSearchParams | Response {
  if (form.has('client_secret')) return oauthError(400, 'invalid_request', 'The app does not send a client secret.');
  if (singleValue(form, 'client_id') !== env.GOOGLE_CLIENT_ID) return oauthError(400, 'invalid_client');
  const grantType = singleValue(form, 'grant_type');
  const outgoing = new URLSearchParams({ grant_type: grantType ?? '', client_id: env.GOOGLE_CLIENT_ID });
  if (grantType === 'authorization_code') {
    const code = singleValue(form, 'code');
    const verifier = singleValue(form, 'code_verifier');
    if (!code || !verifier) return oauthError(400, 'invalid_request');
    if (singleValue(form, 'redirect_uri') !== env.GOOGLE_REDIRECT_URI) return oauthError(400, 'invalid_request', 'Unexpected redirect_uri.');
    outgoing.set('code', code);
    outgoing.set('code_verifier', verifier);
    outgoing.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  } else if (grantType === 'refresh_token') {
    const refreshToken = singleValue(form, 'refresh_token');
    if (!refreshToken) return oauthError(400, 'invalid_request');
    outgoing.set('refresh_token', refreshToken);
  } else {
    return oauthError(400, 'unsupported_grant_type');
  }
  outgoing.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  return outgoing;
}

export async function handleRequest(request: Request, env: Env, fetchGoogle: FetchGoogle = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== TOKEN_PATH) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return oauthError(405, 'invalid_request', undefined, { allow: 'POST' });
  if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) return oauthError(500, 'server_error');
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== FORM_CONTENT_TYPE) return oauthError(415, 'invalid_request');
  const text = await readCappedText(request);
  if (text === undefined) return oauthError(413, 'invalid_request');
  const outgoing = googleFormFor(new URLSearchParams(text), env);
  if (outgoing instanceof Response) return outgoing;
  let upstream: Response;
  try {
    upstream = await fetchGoogle(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': FORM_CONTENT_TYPE }, body: outgoing.toString() });
  } catch {
    return oauthError(502, 'temporarily_unavailable');
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
};
