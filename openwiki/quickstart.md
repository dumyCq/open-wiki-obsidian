---
type: Overview
title: OpenWiki quickstart
description: Entry point for the OpenWiki CLI docs — what OpenWiki does, its two
  modes, and where to go next.
resource: /README.md
tags:
  - overview
  - cli
  - agent
timestamp: 2026-07-10T07:02:04.970Z
---

# OpenWiki quickstart

OpenWiki is a TypeScript CLI that writes and maintains an agent-friendly wiki,
either for a codebase (**code mode**) or for a personal knowledge base pulled
from configured connectors (**personal mode**). It ships a single `openwiki`
binary, stores local credentials in `~/.openwiki/.env`, and both modes emit
[Open Knowledge Format (OKF) v0.1](./domain/okf-format.md) bundles — every page
has YAML frontmatter, and the bundle root gets a generated `index.md` and
`log.md`.

## The two modes

- **Code mode** (`openwiki code --init` / `openwiki code --update`) generates
  and refreshes documentation under the target repository's `openwiki/`
  directory by inspecting source files and git history. This repository's own
  `openwiki/` tree (what you're reading now) is an example of code-mode output.
- **Personal mode** (`openwiki personal --init` / plain `openwiki --update`)
  builds a local personal-brain wiki under `~/.openwiki/wiki/` by ingesting
  configured connectors (local git repos, Gmail, Notion, X/Twitter, Web Search,
  Hacker News, Slack) and synthesizing their raw data into wiki pages.

Both modes share the same CLI shell, credential/model setup, and agent runtime
— they differ mainly in output root, prompt instructions, and OKF type
taxonomy. See [Architecture overview](./architecture/overview.md).

## Start here

- [Architecture overview](./architecture/overview.md) — runtime structure, dual output modes, sandboxing, and execution flow.
- [CLI usage](./cli/usage.md) — commands, options, provider/model selection, and non-interactive behavior.
- [Agent workflow](./agent/workflow.md) — how documentation runs are prompted, executed, and normalized into OKF.
- [Connectors](./integrations/connectors.md) — built-in ingestion sources (git-repo, google, notion, slack, web-search, hackernews, x) and their tool surface.
- [Auth and OAuth](./integrations/auth-and-oauth.md) — `openwiki auth <provider>`, PKCE, MCP dynamic client registration, and ngrok for Slack.
- [OKF format](./domain/okf-format.md) — the frontmatter/reserved-file contract every generated bundle must satisfy.
- [Credentials and updates](./operations/credentials-and-updates.md) — local env storage, onboarding profile, schedules, and update metadata.

## Key source files

- `README.md` — user-facing install, quick start, and provider/connector reference.
- `package.json` — bin entrypoint, scripts, and dependencies.
- `src/cli.tsx` — Ink UI, command execution, auto-exit, and run lifecycle.
- `src/commands.ts` — CLI parsing and help content.
- `src/agent/index.ts` — agent runtime: provider/model resolution, DeepAgents backend, OKF pass invocation, metadata writes.
- `src/agent/prompt.ts` — prompt assembly per mode, OKF frontmatter instructions, mode-specific rules.
- `src/agent/okf.ts` — deterministic OKF v0.1 normalization pass run after every non-chat agent run.
- `src/agent/utils.ts` — git evidence collection and content-snapshot/metadata handling.
- `src/agent/docs-only-backend.ts` — guard that constrains init/update writes to the wiki output root.
- `src/env.ts` / `src/credentials.tsx` — `~/.openwiki/.env` persistence and interactive onboarding.
- `src/constants.ts` — provider configs, model options, env keys, OKF type taxonomy.
- `src/connectors/` — connector registry, per-source implementations, and agent-facing ingestion tools.
- `src/auth/` — OAuth flows, token storage, and provider configs for connector authentication.
- `src/onboarding.ts` / `src/schedules.ts` / `src/ingestion.ts` — onboarding profile, cron scheduling, and deterministic ingestion orchestration.

## Notes for future agents

- Treat this repo's own `openwiki/` as generated documentation output, not application source — but it is real and current, produced by prior OpenWiki runs.
- User-visible CLI semantics are split across `src/commands.ts` (parsing/help) and `src/cli.tsx` (interactive behavior); keep them aligned when changing commands.
- Provider support is centralized in `src/constants.ts` (`PROVIDER_CONFIGS`, `OpenWikiProvider`) with model-creation branches in `src/agent/index.ts`.
- Connector support is centralized in `src/connectors/registry.ts` (`CONNECTOR_IDS`, `createConnectorRegistry`); adding a connector means a new `src/connectors/sources/*.ts` file plus a registry entry — see the skill file referenced in [Connectors](./integrations/connectors.md).
- The root `*-CONNECTOR.md` and `TELEMETRY-GUIDE.md` files (e.g. `CODING-AGENTS-CONNECTOR.md`, `LANGSMITH-CONNECTOR.md`) are **forward-looking implementation guides for features not yet built** — there is no matching connector in the registry or telemetry module yet. Don't treat them as documentation of current behavior.

