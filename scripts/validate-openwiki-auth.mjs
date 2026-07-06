#!/usr/bin/env node
import { loadOpenWikiEnv } from "../dist/env.js";

const X_API_BASE_URL = "https://api.x.com/2";
const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";

const envKeys = {
  notion: {
    accessToken: "OPENWIKI_NOTION_MCP_ACCESS_TOKEN",
    clientId: "OPENWIKI_NOTION_MCP_CLIENT_ID",
    expiresAt: "OPENWIKI_NOTION_MCP_TOKEN_EXPIRES_AT",
    refreshToken: "OPENWIKI_NOTION_MCP_REFRESH_TOKEN",
    tokenType: "OPENWIKI_NOTION_MCP_TOKEN_TYPE",
  },
  x: {
    accessToken: "OPENWIKI_X_ACCESS_TOKEN",
    clientId: "OPENWIKI_X_CLIENT_ID",
    clientSecret: "OPENWIKI_X_CLIENT_SECRET",
    expiresAt: "OPENWIKI_X_TOKEN_EXPIRES_AT",
    refreshToken: "OPENWIKI_X_REFRESH_TOKEN",
    tokenType: "OPENWIKI_X_TOKEN_TYPE",
  },
};

const options = parseArgs(process.argv.slice(2));

await loadOpenWikiEnv();

if (options.help) {
  printHelp();
  process.exit(0);
}

const results = [];
if (options.provider === "all" || options.provider === "x") {
  results.push(await validateX(options));
}
if (options.provider === "all" || options.provider === "notion") {
  results.push(await validateNotion(options));
}

for (const result of results) {
  printProviderResult(result);
}

process.exitCode = results.every((result) => result.ok) ? 0 : 1;

function parseArgs(args) {
  const parsed = {
    consumeRefreshToken: false,
    help: false,
    provider: "all",
    refreshCheck: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--refresh-check") {
      parsed.refreshCheck = true;
      continue;
    }
    if (arg === "--consume-refresh-token") {
      parsed.consumeRefreshToken = true;
      continue;
    }
    if (arg === "--provider") {
      const provider = args[index + 1];
      if (!isProvider(provider)) {
        throw new Error("--provider must be one of: all, x, notion");
      }
      parsed.provider = provider;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  process.stdout
    .write(`Validate OpenWiki connector auth without printing tokens.

Usage:
  node scripts/validate-openwiki-auth.mjs [--provider all|x|notion] [--refresh-check] [--consume-refresh-token]

Options:
  --provider                Which connector auth to validate. Default: all.
  --refresh-check           Check whether refresh-token inputs are present.
  --consume-refresh-token   Actually call refresh-token grants. This can rotate
                            refresh tokens. Returned tokens are not saved.

The script loads ~/.openwiki/.env through OpenWiki's env loader and only prints
presence, expiry metadata, HTTP status, and sanitized provider error summaries.
`);
}

function isProvider(value) {
  return value === "all" || value === "x" || value === "notion";
}

async function validateX({ consumeRefreshToken, refreshCheck }) {
  const result = createProviderResult("X / Twitter", envKeys.x);
  if (!result.requiredPresent) {
    return result;
  }

  const response = await safeFetch(
    `${X_API_BASE_URL}/users/me?user.fields=id,username,name`,
    {
      headers: {
        Authorization: `Bearer ${process.env[envKeys.x.accessToken]}`,
      },
    },
  );
  result.checks.push(await summarizeHttpCheck("GET /2/users/me", response));

  if (refreshCheck) {
    result.checks.push(
      consumeRefreshToken
        ? await checkXRefresh()
        : summarizeRefreshInputs("X refresh-token inputs", envKeys.x),
    );
  }

  result.ok = result.checks.every((check) => check.ok);
  return result;
}

async function checkXRefresh() {
  if (
    !process.env[envKeys.x.refreshToken] ||
    !process.env[envKeys.x.clientId]
  ) {
    return {
      detail: "Missing refresh token or client id.",
      name: "POST /2/oauth2/token refresh_token",
      ok: false,
      status: "skipped",
    };
  }

  const body = new URLSearchParams({
    client_id: process.env[envKeys.x.clientId],
    grant_type: "refresh_token",
    refresh_token: process.env[envKeys.x.refreshToken],
  });

  const clientSecret = process.env[envKeys.x.clientSecret];
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${process.env[envKeys.x.clientId]}:${clientSecret}`,
    ).toString("base64")}`;
  }

  const response = await safeFetch("https://api.x.com/2/oauth2/token", {
    body,
    headers,
    method: "POST",
  });

  return await summarizeHttpCheck(
    "POST /2/oauth2/token refresh_token",
    response,
  );
}

async function validateNotion({ consumeRefreshToken, refreshCheck }) {
  const result = createProviderResult("Notion MCP", envKeys.notion);
  if (!result.requiredPresent) {
    return result;
  }

  const initialize = await notionMcpRequest("initialize", {
    capabilities: {},
    clientInfo: {
      name: "openwiki-auth-validator",
      version: "0.0.0",
    },
    protocolVersion: MCP_PROTOCOL_VERSION,
  });
  const initializeCheck = await summarizeHttpCheck(
    "MCP initialize",
    initialize,
  );
  result.checks.push(initializeCheck);

  if (initializeCheck.ok) {
    const sessionId = initialize.headers.get("mcp-session-id");
    if (sessionId) {
      await notionMcpNotify("notifications/initialized", sessionId);
    }

    const tools = await notionMcpRequest("tools/list", {}, sessionId);
    result.checks.push(await summarizeHttpCheck("MCP tools/list", tools));
  }

  if (refreshCheck) {
    result.checks.push(
      consumeRefreshToken
        ? await checkNotionRefresh()
        : summarizeRefreshInputs("Notion refresh-token inputs", envKeys.notion),
    );
  }

  result.ok = result.checks.every((check) => check.ok);
  return result;
}

async function notionMcpRequest(method, params, sessionId = null) {
  return await safeFetch(NOTION_MCP_URL, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: createNotionMcpHeaders(sessionId),
    method: "POST",
  });
}

async function notionMcpNotify(method, sessionId) {
  return await safeFetch(NOTION_MCP_URL, {
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
    }),
    headers: createNotionMcpHeaders(sessionId),
    method: "POST",
  });
}

function createNotionMcpHeaders(sessionId) {
  return removeEmptyValues({
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${process.env[envKeys.notion.accessToken]}`,
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Session-Id": sessionId ?? undefined,
  });
}

async function checkNotionRefresh() {
  if (
    !process.env[envKeys.notion.refreshToken] ||
    !process.env[envKeys.notion.clientId]
  ) {
    return {
      detail: "Missing refresh token or client id.",
      name: "OAuth refresh_token grant",
      ok: false,
      status: "skipped",
    };
  }

  const metadata = await discoverNotionOAuthMetadata();
  if (!metadata.ok) {
    return metadata;
  }

  const body = new URLSearchParams({
    client_id: process.env[envKeys.notion.clientId],
    grant_type: "refresh_token",
    refresh_token: process.env[envKeys.notion.refreshToken],
    resource: NOTION_MCP_URL,
  });

  const response = await safeFetch(metadata.tokenEndpoint, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  return await summarizeHttpCheck("OAuth refresh_token grant", response);
}

async function discoverNotionOAuthMetadata() {
  const protectedMetadataCandidates = [
    "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp",
    "https://mcp.notion.com/.well-known/oauth-protected-resource",
  ];

  for (const candidate of protectedMetadataCandidates) {
    const response = await safeFetch(candidate);
    if (!response.ok) {
      continue;
    }

    const body = await safeJson(response);
    const authServer = Array.isArray(body.authorization_servers)
      ? body.authorization_servers.find((value) => typeof value === "string")
      : null;
    if (!authServer) {
      continue;
    }

    const authMetadata = await fetchAuthorizationMetadata(authServer);
    if (authMetadata.ok) {
      return authMetadata;
    }
  }

  return {
    detail: "Could not discover Notion OAuth token endpoint.",
    name: "OAuth metadata discovery",
    ok: false,
    status: "failed",
  };
}

async function fetchAuthorizationMetadata(issuer) {
  const issuerUrl = new URL(issuer);
  const candidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname}`,
    `${issuerUrl.origin}/.well-known/openid-configuration${issuerUrl.pathname}`,
    `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    `${issuerUrl.origin}/.well-known/openid-configuration`,
  ];

  for (const candidate of candidates) {
    const response = await safeFetch(candidate);
    if (!response.ok) {
      continue;
    }

    const body = await safeJson(response);
    if (typeof body.token_endpoint === "string") {
      return {
        name: "OAuth metadata discovery",
        ok: true,
        status: response.status,
        tokenEndpoint: body.token_endpoint,
      };
    }
  }

  return {
    detail: "Authorization server metadata did not expose token_endpoint.",
    name: "OAuth metadata discovery",
    ok: false,
    status: "failed",
  };
}

function createProviderResult(name, keys) {
  const accessToken = process.env[keys.accessToken];
  const refreshToken = process.env[keys.refreshToken];
  const clientId = process.env[keys.clientId];
  const tokenType = process.env[keys.tokenType];
  const expiresAt = process.env[keys.expiresAt];

  return {
    checks: [],
    env: [
      formatPresence(keys.accessToken, accessToken),
      formatPresence(keys.refreshToken, refreshToken),
      formatPresence(keys.clientId, clientId),
      formatPresence(keys.tokenType, tokenType),
      formatExpiry(keys.expiresAt, expiresAt),
    ],
    name,
    ok: false,
    requiredPresent: Boolean(accessToken),
  };
}

function summarizeRefreshInputs(name, keys) {
  const hasRefreshToken = Boolean(process.env[keys.refreshToken]);
  const hasClientId = Boolean(process.env[keys.clientId]);

  return {
    detail:
      hasRefreshToken && hasClientId
        ? "Refresh token and client id are present. Token endpoint was not called; use --consume-refresh-token to test it."
        : "Missing refresh token or client id.",
    name,
    ok: hasRefreshToken && hasClientId,
    status: "not consumed",
  };
}

function formatPresence(key, value) {
  return {
    key,
    status: value ? "set" : "missing",
  };
}

function formatExpiry(key, value) {
  if (!value) {
    return { key, status: "missing" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { key, status: "invalid timestamp" };
  }

  const msRemaining = date.getTime() - Date.now();
  return {
    key,
    status: msRemaining > 0 ? "future" : "past",
    value,
  };
}

async function summarizeHttpCheck(name, response) {
  if (response.error) {
    return {
      detail: response.error,
      name,
      ok: false,
      status: "request failed",
    };
  }

  if (response.ok) {
    const body = await safeJson(response);
    return {
      detail: summarizeSuccessBody(body),
      name,
      ok: true,
      status: response.status,
    };
  }

  const body = await safeJson(response);
  return {
    detail: summarizeErrorBody(body),
    name,
    ok: false,
    status: `${response.status} ${response.statusText}`,
  };
}

async function safeFetch(url, init = {}) {
  try {
    return await fetch(url, init);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

async function safeJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return {};
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
}

function summarizeSuccessBody(body) {
  if (!body || typeof body !== "object") {
    return "OK";
  }

  if (Array.isArray(body.tools)) {
    return `OK; ${body.tools.length} tool(s) returned`;
  }

  if (body.result && typeof body.result === "object") {
    const result = body.result;
    if (Array.isArray(result.tools)) {
      return `OK; ${result.tools.length} tool(s) returned`;
    }
    if (typeof result.protocolVersion === "string") {
      return `OK; MCP protocol ${result.protocolVersion}`;
    }
  }

  if (body.data && typeof body.data === "object") {
    const fields = ["id", "username", "name"].filter(
      (field) => typeof body.data[field] === "string",
    );
    return fields.length > 0
      ? `OK; user data fields: ${fields.join(", ")}`
      : "OK; user data returned";
  }

  if (typeof body.access_token === "string") {
    return "OK; refresh grant returned an access token";
  }

  return "OK";
}

function summarizeErrorBody(body) {
  if (!body || typeof body !== "object") {
    return "No JSON error body returned.";
  }

  const pieces = [];
  if (typeof body.error === "string") {
    pieces.push(`error=${body.error}`);
  }
  if (typeof body.error_description === "string") {
    pieces.push(`description=${truncate(body.error_description)}`);
  }
  if (typeof body.title === "string") {
    pieces.push(`title=${truncate(body.title)}`);
  }
  if (typeof body.detail === "string") {
    pieces.push(`detail=${truncate(body.detail)}`);
  }
  if (Array.isArray(body.errors)) {
    pieces.push(`errors=${body.errors.length}`);
    const first = body.errors.find(
      (value) => value && typeof value === "object",
    );
    if (first) {
      if (typeof first.title === "string") {
        pieces.push(`firstTitle=${truncate(first.title)}`);
      }
      if (typeof first.detail === "string") {
        pieces.push(`firstDetail=${truncate(first.detail)}`);
      }
      if (typeof first.message === "string") {
        pieces.push(`firstMessage=${truncate(first.message)}`);
      }
    }
  }

  return pieces.length > 0 ? pieces.join("; ") : "JSON error body returned.";
}

function printProviderResult(result) {
  process.stdout.write(`\n${result.name}\n${"=".repeat(result.name.length)}\n`);

  for (const item of result.env) {
    const value = item.value ? ` (${item.value})` : "";
    process.stdout.write(`- ${item.key}: ${item.status}${value}\n`);
  }

  if (!result.requiredPresent) {
    process.stdout.write("- validation: skipped; access token is missing\n");
    return;
  }

  for (const check of result.checks) {
    process.stdout.write(
      `- ${check.name}: ${check.ok ? "ok" : "failed"} (${check.status})`,
    );
    if (check.detail) {
      process.stdout.write(` - ${check.detail}`);
    }
    process.stdout.write("\n");
  }
}

function removeEmptyValues(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function truncate(value) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
