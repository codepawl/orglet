# Orglet Connect

A Cloudflare Worker at `connect.orglet.codepawl.com`: the token broker for the Google connectors. Google's "Web application" OAuth clients need a client secret at the token endpoint, and a desktop app cannot keep one. The app signs in with CodePawl's public client ID and sends its two token requests here. The Worker adds the secret and returns Google's answer unchanged.

It stores nothing, logs no code, token or request body (observability logs sample invocations only, with query strings redacted), and serves one route.

## Route

`POST /google/token`, `application/x-www-form-urlencoded`, at most 4096 bytes. Anything else answers 404 (other paths), 405 (other methods), 413 (too large) or 415 (other content types).

| `grant_type` | Fields the app sends | Checked |
|---|---|---|
| `authorization_code` | `code`, `code_verifier`, `redirect_uri`, `client_id` | `client_id` is `GOOGLE_CLIENT_ID`; `redirect_uri` is exactly `GOOGLE_REDIRECT_URI` |
| `refresh_token` | `refresh_token`, `client_id` | `client_id` is `GOOGLE_CLIENT_ID` |

A request that carries a `client_secret`, repeats a field, or has another grant type is refused before Google is called. Only the fields above are forwarded, plus the secret. Google's status and JSON body come back as they are; an unreachable Google answers 502.

There is no per-address rate limit. The sync Worker's limits live in its Durable Object, and a broker with no state has nothing to count in; Cloudflare's rate limiting rules on the zone are the place to add one if it is ever needed.

## Configuration

| Name | Kind | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | var in `wrangler.jsonc` | CodePawl's public client ID |
| `GOOGLE_REDIRECT_URI` | var in `wrangler.jsonc` | `http://127.0.0.1:53127/callback`, the one address registered for the client |
| `GOOGLE_CLIENT_SECRET` | Worker secret | never in this repository |

## Deploy

```
pnpm --dir services/connect install --frozen-lockfile
pnpm --dir services/connect test
pnpm --dir services/connect typecheck
pnpm --dir services/connect exec wrangler login
pnpm --dir services/connect exec wrangler deploy
pnpm --dir services/connect exec wrangler secret put GOOGLE_CLIENT_SECRET
```

`wrangler secret put` asks for the value on the terminal; paste the client secret from Google Cloud Console (Google Auth Platform, Clients). Deploying attaches the custom domain `connect.orglet.codepawl.com` to the zone, as the sync Worker's `sync.orglet.codepawl.com` is. Until the secret is set the Worker answers 500 and the connector sign-in cannot finish.

To check it: `pnpm --dir services/connect check:deploy` bundles the Worker without uploading it.

## Development

`pnpm --dir services/connect dev` runs it locally; put `GOOGLE_CLIENT_SECRET=...` in a `.dev.vars` file (ignored by git). Point a development build of the app at it with `ORGLET_CONNECT_URL=http://127.0.0.1:8787`.
