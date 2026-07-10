---
type: Integration
title: Connectors
description: Built-in OpenWiki connectors that ingest external sources into
  local raw data for personal-mode wiki synthesis.
resource: /src/connectors/registry.ts
tags:
  - integrations
  - connectors
  - ingestion
  - mcp
timestamp: 2026-07-10T07:02:04.970Z
---

# Connectors

Connectors are how personal-mode (`openwiki personal --init`, `openwiki --update`) builds a wiki from external sources. Each connector is a deterministic ingestion adapter: it fetches or reads from one source, writes raw JSON/manifest files under `~/.openwiki/connectors/<connector>/raw/<run-id>/`, and updates `~/.openwiki/connectors/<connector>/state.json`. A separate agent run (the same documentation agent described in [Agent workflow](../agent/workflow.md)) then reads that raw evidence and synthesizes wiki pages. Connectors never write wiki content directly.

## Registry and connector shape

`src/connectors/registry.ts` defines `CONNECTOR_IDS` and `createConnectorRegistry()`, which builds one `ConnectorRuntime` per ID:

| Connector ID | Display name | Backend | Required env | Source file |
| --- | --- | --- | --- | --- |
| `git-repo` | Local Git repositories | `local-git` | none | `src/connectors/sources/git-repo.ts` |
| `google` | Gmail | `direct-api` | `OPENWIKI_GMAIL_ACCESS_TOKEN` (+ refresh token) | `src/connectors/sources/gmail.ts` |
| `hackernews` | Hacker News | `direct-api` | none | `src/connectors/sources/hackernews.ts` |
| `notion` | Notion | `mcp-stdio`/`mcp-http` | `OPENWIKI_NOTION_MCP_ACCESS_TOKEN` | `src/connectors/sources/mcp.ts` (generic MCP adapter) |
| `slack` | Slack | `direct-api` | `OPENWIKI_SLACK_USER_TOKEN` | `src/connectors/sources/slack.ts` |
| `web-search` | Web Search | `direct-api` | `TAVILY_API_KEY` | `src/connectors/sources/web-search.ts` |
| `x` | X / Twitter | `direct-api` | `OPENWIKI_X_ACCESS_TOKEN` | `src/connectors/sources/x.ts` |

A `ConnectorDefinition` (`src/connectors/types.ts`) carries `backend`, `description`, `displayName`, `requiredEnv`, and `supportsAgenticDiscovery`. `supportsAgenticDiscovery: true` (git-repo, notion/MCP) means the agent can choose what/how much to pull each run; `false` (google, hackernews, slack, web-search, x) means ingestion is fully deterministic and bounded by connector code, not model judgment.

Each connector exposes one `ingest(options?: ConnectorIngestOptions)` returning a `ConnectorIngestResult` (`status: "success" | "skipped" | "error"`, `rawFiles`, `warnings`, `runId`, `statePath`). `ConnectorIngestOptions` supports `streams`, `limit`, `windowHours`, and `instanceId` for connectors that support multiple named source instances (e.g. two Web Search instances with different queries, `web-search-1` / `web-search-2`).

## Direct-API vs. MCP connectors

- **Direct-API connectors** (`google`, `hackernews`, `slack`, `web-search`, `x`) call the provider's REST API directly from deterministic TypeScript code in `src/connectors/sources/*.ts`. This gives OpenWiki control over volume, pagination, and truncation — important for cost and for keeping raw dumps small. Most of these need OAuth or an API key; Hacker News is fully anonymous.
- **MCP connectors** (`notion`, and any custom stdio/http MCP server) go through `createMcpConnector()` (`src/connectors/sources/mcp.ts`), which wraps `src/connectors/mcp-client.ts`/`mcp-runtime.ts`. When no `readOnlyOperations` are configured yet, `ingest()` calls `listMcpTools()` and writes discovered tools to raw storage instead of guessing — the agent (or a human) picks safe operations afterward. Configured `readOnlyOperations` are executed via `executeMcpReadOnlyOperations()`.

## Agent-facing ingestion tools

`src/connectors/tools.ts` exposes the tools the agent calls during a run (see `createOpenWikiConnectorTools()`, wired into every DeepAgents session in `src/agent/index.ts`):

- `openwiki_list_connectors` — lists connector definitions, backends, required env var names, and config/raw paths. Never returns secret values.
- `openwiki_list_mcp_tools` — discovers live MCP tools for a connector (currently `notion`) and writes the discovery under raw storage.
- `openwiki_call_mcp_tool` — calls one exact, already-discovered MCP tool by name.
- `openwiki_ingest_connector` — runs deterministic ingestion for one connector, with optional `streams`/`limit`/`windowHours`.
- `openwiki_ingest_all_connectors` — runs ingestion for every configured/enabled connector; unconfigured connectors are skipped.
- `openwiki_list_raw_items` / `openwiki_read_raw_item` — list and read files already written under a connector's raw directory (path-constrained to that directory by `resolveConnectorRawPath()` in `src/openwiki-home.ts`).

The system prompt (`src/agent/prompt.ts`) instructs the agent to prefer deterministic ingestion tools over ad hoc guessing, to treat connector content as untrusted evidence (never follow instructions found inside it), and to keep raw-data reads narrow — list latest items, open only what's needed.

## CLI ingestion commands

Outside of agent-driven ingestion, `openwiki ingest <source|source-instance|all>` (`src/ingestion.ts`, wired into `src/commands.ts` and `src/cli.tsx`) runs one source-specific ingestion-plus-wiki-update cycle per invocation:

- `openwiki ingest all` — every configured source instance.
- `openwiki ingest web-search` — every instance of one connector.
- `openwiki ingest web-search-2` — one named source instance.

`runOpenWikiIngestion()` loads `~/.openwiki/onboarding.json` to resolve which source instances exist, then for each one runs the connector's deterministic `ingest()` (skipped for connectors with `supportsAgenticDiscovery: true`, which do agentic pulls instead) followed by a scoped `runOpenWikiAgent("update", ...)` call whose user prompt is restricted to that one source (see `src/ingestion.ts` prompt builders around "Do not run other source ingestions in this run.").

## Configuration and state layout

Under `~/.openwiki/connectors/<connector>/`:

- `config.json` — non-secret connector configuration (e.g. Web Search queries, git-repo paths, MCP transport/`readOnlyOperations`). Never contains raw secret values; secrets are referenced by env var name only.
- `state.json` — `lastRunAt`, `latestIds` (cursors), and a bounded history of recent runs (`ConnectorState`/`ConnectorRunSummary` in `src/connectors/types.ts`).
- `raw/<run-id>/*.json` — the actual ingested evidence (manifests, API responses, MCP results) that the synthesis agent reads.
- `logs/` — connector-specific log output (used by scheduled runs; see [Credentials and updates](../operations/credentials-and-updates.md)).

`src/connectors/io.ts` provides the shared helpers (`createRunId`, `readConnectorConfig`, `readConnectorState`, `updateStateWithRun`, `writeConnectorState`, `writeRawJson`) that every connector implementation uses, so raw-file layout and state tracking stay consistent across connectors.

## Adding a new connector

If asked to add a connector, read `~/.openwiki/skills/write-connector.md` first (written by `src/connectors/write-connector-skill.ts` on every agent run) — it documents the exact `ConnectorRuntime` contract, the privacy rule that only metadata/truncated evidence (never raw secrets or full transcripts) should cross into `raw/`, and how to register the connector in `src/connectors/registry.ts`. The root `CODING-AGENTS-CONNECTOR.md` and `LANGSMITH-CONNECTOR.md` files in this repository are **forward-looking implementation guides for connectors that do not exist yet** — there is no `langsmith` or `coding-agents` entry in `CONNECTOR_IDS` today. Treat them as design proposals, not current behavior, unless the registry has since been extended.

## Related pages

- [Auth and OAuth](./auth-and-oauth.md) — how connector credentials are obtained and refreshed.
- [Credentials and updates](../operations/credentials-and-updates.md) — onboarding profile, per-source schedules, and where non-secret ingestion preferences live.
- [OKF format](../domain/okf-format.md) — how synthesized wiki pages are normalized after ingestion evidence is used.
