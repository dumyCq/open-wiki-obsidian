---
type: Integration
title: Auth and OAuth
description: How openwiki auth obtains, stores, and refreshes connector
  credentials, and how ngrok supports Slack's HTTPS OAuth requirement.
resource: /src/auth/oauth.ts
tags:
  - integrations
  - auth
  - oauth
  - connectors
timestamp: 2026-07-10T07:02:04.970Z
---

# Auth and OAuth

Four connectors — Gmail, Notion, Slack, and X/Twitter — authenticate through a shared local OAuth flow rather than pasted API keys. `AuthProviderId` (`src/auth/types.ts`) is `"gmail" | "notion" | "slack" | "x"`; Hacker News needs no auth, and Web Search uses a plain `TAVILY_API_KEY` instead of OAuth.

## Running auth

```sh
openwiki auth slack
openwiki auth gmail
openwiki auth x
openwiki auth notion
```

`runOAuthAuth()` (`src/auth/oauth.ts`) drives the flow for a given provider:

1. Load `~/.openwiki/.env` and look up the provider's `OAuthProviderConfig` from `src/auth/providers.ts` (`AUTH_PROVIDERS`).
2. Start a local HTTP callback server on `127.0.0.1:<port>` (default port `53682`, overridable via `OPENWIKI_OAUTH_CALLBACK_PORT`).
3. Generate PKCE `state` and `code_verifier`/`code_challenge` values.
4. Resolve client registration — either a static `clientIdEnvKey`/`clientSecretEnvKey` pair (Gmail, Slack, X) that must already exist in `~/.openwiki/.env`, or dynamic client registration against the provider's OAuth metadata (Notion, which has `clientAuth: "none"` and a hosted MCP resource URL instead of a static client).
5. Build the authorization URL (with provider-specific `extraAuthParams`, e.g. Slack's separate `scope`/`user_scope`, or Gmail's `access_type=offline`/`prompt=consent` for a refresh token) and open it in the browser, also printing it for headless/SSH use.
6. Wait for the OAuth redirect on the local callback, exchange the authorization code for tokens, and save them into `~/.openwiki/.env` using the provider's `tokenMapping` (access token, refresh token, expiry, token type, and — for Notion — the dynamically registered client ID).

Slack, Gmail, and X token/scopes are defined per-provider in `AUTH_PROVIDERS`; notably Slack requests a wide `user_scope` (channel/DM/history/search read scopes) because the Slack connector does self-message search plus bounded recent-conversation ingestion (see [Connectors](./connectors.md) and the Slack-specific guidance in the agent prompt).

## Token storage and refresh

`src/auth/tokens.ts` provides `getOAuthAccessToken(providerId)`, used by connector `ingest()` implementations that need a live token:

- Returns the cached access token if present and not expired (checked against the stored `expiresAtEnvKey` with a 60-second skew).
- Otherwise calls `refreshOAuthAccessToken()`, which POSTs to the provider's `tokenUrl` with the stored refresh token and client credentials, then saves the refreshed access token (and rotated refresh token, when returned) back to `~/.openwiki/.env`.

This mirrors the ChatGPT-login token refresh pattern used for the `openai-chatgpt` model provider (`src/agent/openai-chatgpt-oauth.ts`, refreshed automatically in `src/agent/index.ts` before model creation) — both are "OAuth tokens live in `~/.openwiki/.env` and refresh themselves transparently" patterns, just for different purposes (model billing vs. connector data access).

## Advanced/retry commands

- `openwiki auth configure <provider>` — regenerates connector config (e.g. rewriting MCP transport/`readOnlyOperations` defaults) without re-running the full OAuth dance. See `src/auth/configure.ts` for provider-specific config templates (for example, the Gmail template documents that `query` defaults to the last day of mail; the Slack template notes that direct-API ingestion is enabled by default).
- `openwiki auth tools <provider>` — inspects live MCP tools for MCP-backed providers, independent of a full ingestion run.

## ngrok for Slack's HTTPS callback

Slack's OAuth app configuration can require an HTTPS redirect URL (unlike Gmail/X, which accept the local loopback `http://127.0.0.1:<port>/callback`). `openwiki ngrok start` (`src/auth/ngrok.ts`) bridges this:

```sh
openwiki ngrok start
# or, with a fixed ngrok domain:
openwiki ngrok start https://<your-ngrok-domain>
```

`startNgrokTunnel()` spawns `ngrok http <port>` (optionally pinned to a fixed `--url`), polls ngrok's local inspection API (`http://127.0.0.1:4040/api/tunnels`) until the HTTPS forwarding URL is available, appends `/callback`, and saves it as `OPENWIKI_HTTPS_OAUTH_REDIRECT_URI` in `~/.openwiki/.env` alongside the callback port. The printed URL must be registered as the redirect URI in the Slack app configuration. X/Twitter and Gmail auth ignore `OPENWIKI_HTTPS_OAUTH_REDIRECT_URI` and always use the local loopback callback.

## Things to watch when editing

- Adding a new OAuth-backed connector means: a new `AuthProviderId` entry in `src/auth/types.ts`, a new `AUTH_PROVIDERS` entry in `src/auth/providers.ts` with `tokenMapping` env keys added to `src/constants.ts`, and wiring `getOAuthAccessToken()` into the connector's `ingest()`.
- Never print, log, or ask the user to paste raw token values — `openwiki auth <provider>` and `getOAuthAccessToken()` are the only supported paths for obtaining/refreshing these credentials.
- `openwiki auth` writes only to `~/.openwiki/.env` (mode `0600`) and, where applicable, connector `config.json` — never to source-controlled files.

## Related pages

- [Connectors](./connectors.md) — what each OAuth-backed connector does with its token.
- [Credentials and updates](../operations/credentials-and-updates.md) — the full `~/.openwiki/.env` key inventory and non-OAuth credentials.
