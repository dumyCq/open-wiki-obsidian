---
type: Architecture
title: Architecture overview
description: Runtime structure of the OpenWiki CLI and agent, including the two
  output modes, sandboxing, and the post-run OKF pass.
resource: /src/agent/index.ts
tags:
  - architecture
  - agent
  - runtime
timestamp: 2026-07-10T07:02:04.970Z
---

# Architecture overview

OpenWiki has a small but layered architecture:

1. `src/cli.tsx` provides the interactive terminal application and orchestrates runs, including auto-exit for init/update.
2. `src/commands.ts` parses argv and defines help text and supported options.
3. `src/credentials.tsx` manages interactive onboarding for provider selection, API keys, model selection, and optional LangSmith tracing.
4. `src/env.ts` reads and writes `~/.openwiki/.env` and surfaces credential diagnostics for all supported providers.
5. `src/agent/index.ts` runs the documentation agent, resolves the provider, creates the appropriate model client, collects Git context, runs the OKF normalization pass, and writes update metadata.
6. `src/agent/prompt.ts` builds the system and user prompts, branching by `OpenWikiOutputMode` for mode-specific rules (repository docs vs. local personal wiki).
7. `src/agent/utils.ts` gathers Git evidence, computes an OpenWiki content snapshot, and records `.last-update.json` after successful init/update runs.
8. `src/agent/okf.ts` runs a deterministic post-agent pass that produces OKF v0.1 conformance over the finished bundle — see [OKF format](../domain/okf-format.md).
9. `src/agent/docs-only-backend.ts` wraps the DeepAgents shell backend to constrain repository-mode init/update writes to `/openwiki/`.
10. `src/constants.ts` centralizes provider configs, model options, environment keys, validation helpers, and the OKF type taxonomy per output mode.
11. `src/agent/types.ts` defines shared types: `OpenWikiCommand`, `OpenWikiOutputMode`, `RunContext`, `UpdateMetadata`, and run option/event interfaces.
12. `src/connectors/` and `src/auth/` provide the ingestion and OAuth layer used by personal-mode wiki runs — see [Connectors](../integrations/connectors.md) and [Auth and OAuth](../integrations/auth-and-oauth.md).

## Two output modes

`OpenWikiOutputMode` (`src/agent/types.ts`) is `"repository"` or `"local-wiki"`:

- **`repository`** — `openwiki code --init|--update`. The runtime `cwd` is the target repository; the wiki content root is `<repo>/openwiki/`. The `OpenWikiLocalShellBackend` (`src/agent/docs-only-backend.ts`) refuses any `write`/`edit` outside `/openwiki/` for non-chat commands, so a misbehaving agent run cannot touch source files.
- **`local-wiki`** — `openwiki personal --init`, or plain `openwiki --update`. The runtime `cwd` is always `~/.openwiki/wiki` (`openWikiLocalWikiDir`), regardless of the caller's working directory (see the `runtimeCwd` fallback in `runOpenWikiAgent`). The wiki content root is `/` inside that virtual filesystem — pages live directly at `/quickstart.md`, `/sources/gmail.md`, etc. There is no docs-only restriction because the whole root *is* the wiki.

Chat runs (`command === "chat"`) skip the docs-only restriction, the OKF pass, and metadata writes entirely — chat is for Q&A, not documentation writes.

## Runtime shape

The CLI starts in `src/cli.tsx`, parses the command, and then either:

- prints help and exits,
- opens the interactive chat UI,
- runs an init/update command against the current repository or local wiki, or
- performs a dry-run in development mode.

For non-chat runs, the agent receives a `RunContext` that includes last-update metadata and a Git summary generated from:

- `git status --short`
- `git rev-parse HEAD`
- `git log --max-count=20 --name-status --oneline` (init, or update without prior metadata)
- `git log <lastHead>..HEAD --name-status --oneline` (update with a recorded `gitHead`)
- `git log --since <updatedAt> --name-status --oneline` (update with only a timestamp)
- `git diff --name-status HEAD`

### Provider and model resolution

The agent runtime resolves the provider via `resolveConfiguredProvider()` in `src/constants.ts`:

1. If `OPENWIKI_PROVIDER` is set and valid, use it.
2. Otherwise, use the first available provider API key in this order: OpenAI, OpenRouter, Anthropic, Baseten, then Fireworks.
3. Otherwise, fall back to `DEFAULT_PROVIDER` (`openai`) and its default model (`gpt-5.5`).

Model creation branches by provider in `src/agent/index.ts` (`createModel`):

- **anthropic** → `ChatAnthropic` with the Anthropic API key.
- **openrouter** → `ChatOpenRouter` with the selected model ID.
- **openai** → `ChatOpenAI` with `useResponsesApi: true`.
- **baseten / fireworks / openai-compatible** → `ChatOpenAI` with the provider's API key and optional custom `baseURL` from `PROVIDER_CONFIGS`.

### DeepAgents backend

The agent uses `OpenWikiLocalShellBackend` (a subclass of DeepAgents' `LocalShellBackend`) rooted at `cwd`, configured with `virtualMode: true`, `maxOutputBytes: 100_000`, and a 120 second timeout. `docsOnly` is `true` for any non-chat command; combined with `outputMode`, this is what enforces the `/openwiki/`-only write restriction in repository mode (see above). The agent also receives `createOpenWikiConnectorTools()` — the `openwiki_*` ingestion tools described in [Connectors](../integrations/connectors.md) — regardless of output mode. A SQLite checkpointer (`~/.openwiki/openwiki.sqlite`) persists conversation threads keyed by a hash of the resolved `cwd`.

### OKF normalization pass

For every non-chat run, `src/agent/index.ts` calls `normalizeOkfBundle()` (`src/agent/okf.ts`) immediately after the agent stream completes, before the post-run content snapshot is taken. This pass repairs frontmatter, generates `index.md`/`log.md`, and is idempotent — see [OKF format](../domain/okf-format.md) for the full contract. Because it runs before the snapshot comparison, OKF-only changes still count as content changes and will produce a metadata write.

### Content snapshot and metadata writes

After a non-chat run completes (and after the OKF pass), `src/agent/utils.ts` computes a SHA-256 snapshot of the wiki content root (`openwiki/` in repository mode, the whole wiki root in local-wiki mode), excluding `.last-update.json`. Metadata is written **only if the snapshot changed** — a no-op update that leaves docs untouched will not update `.last-update.json`. This prevents endless update loops in scheduled workflows.

### Auto-exit behavior

`shouldAutoExitStartupRun()` in `src/cli.tsx` determines whether a startup run should exit automatically on success. This applies to `--init` and `--update` commands (without `--print`) when run in a TTY: the CLI launches the run, renders streaming output, and exits with code 0 on success. Chat runs and `--print` runs are unaffected.

## Why the architecture is shaped this way

The current design reflects a documentation product rather than a general-purpose agent framework:

- The CLI owns user experience and credential bootstrap so the tool is install-and-run friendly.
- Git evidence is collected in the host process before the agent starts so the model sees stable repository context.
- Provider support is centralized in `src/constants.ts` so adding a provider is a single-config change plus a model-creation branch.
- Model execution is provider-stable: transient request failures can retry through the selected LangChain model client, but OpenWiki surfaces the final error instead of continuing with another model.
- The content-snapshot check prevents metadata churn when an update run produces no documentation changes, which is important for scheduled CI workflows.
- Auto-exit for init/update makes the CLI usable in both interactive and one-shot contexts without requiring `--print`.

## Major extension points

- Add or refine CLI commands in `src/commands.ts` and the corresponding UI behavior in `src/cli.tsx`.
- Change onboarding or local credential storage in `src/credentials.tsx` and `src/env.ts`.
- Add a new model provider by extending `PROVIDER_CONFIGS` and `OpenWikiProvider` in `src/constants.ts`, then adding a branch in `createModel` in `src/agent/index.ts`.
- Adjust model defaults, validation, or fallback lists in `src/constants.ts`.
- Extend the documentation prompt or Git evidence in `src/agent/prompt.ts` and `src/agent/utils.ts`.
- Modify run persistence or snapshot behavior in `src/agent/utils.ts`.
- Add a connector by adding a `src/connectors/sources/*.ts` file and a registry entry in `src/connectors/registry.ts` — see [Connectors](../integrations/connectors.md).
- Change OKF type inference or reserved-file generation in `src/agent/okf.ts` and the taxonomy tables in `src/constants.ts` — see [OKF format](../domain/okf-format.md).

## Things to watch when editing

- `src/cli.tsx` and `src/commands.ts` must stay aligned; help text and parser behavior are intentionally coupled.
- Credential setup writes to a real home-directory file, so permission handling matters.
- The agent is expected to work from virtual paths rooted at `cwd` (e.g. `/README.md`, `/openwiki/quickstart.md` in repository mode, or `/quickstart.md` in local-wiki mode); the prompt explicitly warns about this, and passing a host absolute path will be misinterpreted as a virtual path.
- In repository mode, `openwiki/` in the target repository is both the docs output location and the metadata location for `.last-update.json`. `OpenWikiLocalShellBackend` actively rejects writes outside it for non-chat commands — a test failure here usually means a prompt or backend change broke the docs-only guard.
- In local-wiki mode, the whole `~/.openwiki/wiki/` root is the content root; there is no `openwiki/` subdirectory and no docs-only guard.
- When adding a provider, update `managedEnvKeys` in `src/env.ts` so diagnostics and env formatting cover the new key.
- The content-snapshot logic excludes `.last-update.json`; if new metadata files are added under the content root, decide whether they should be excluded too.
- The OKF pass runs on every non-chat run and can itself change file bytes (frontmatter reordering, `index.md`/`log.md` regeneration); it must stay idempotent — see `test/okf.test.ts`.

## Source map

- `src/cli.tsx`
- `src/commands.ts`
- `src/credentials.tsx`
- `src/env.ts`
- `src/agent/index.ts`
- `src/agent/prompt.ts`
- `src/agent/utils.ts`
- `src/agent/okf.ts`
- `src/agent/docs-only-backend.ts`
- `src/agent/types.ts`
- `src/constants.ts`
- `package.json`
- Git evidence: commits `ceded10`, `f89b05d`, `fd3a702`, `8278c36`, `0fa1430`
