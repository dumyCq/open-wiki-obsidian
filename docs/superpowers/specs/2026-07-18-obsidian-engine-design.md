# Obsidian Engine Mode — Design

Date: 2026-07-18
Repo: dumyCq/open-wiki-obsidian (fork of langchain-ai/openwiki)
Status: Approved for implementation (autonomous session; decisions and rationale recorded below)

## Goal

Add a third OpenWiki run mode, `obsidian`, beyond `personal` and `code`. In this mode the
wiki's storage engine is an Obsidian vault:

1. **Display enabled** — the wiki directory is a valid Obsidian vault (seeded `.obsidian/`
   config) and the CLI prints an `obsidian://open` URI so the user can open it in Obsidian.
2. **Two-way** — edits made in Obsidian update the wiki (the vault *is* the wiki storage),
   and the next OpenWiki run detects manual edits and treats them as authoritative input to
   incorporate, never to revert.

## Non-goals (v1)

- No connector ingestion or launchd scheduling for obsidian mode (`src/ingestion.ts` and
  `src/schedules.ts` remain personal-mode only; their prompts hardcode `~/.openwiki/wiki`).
- No file watcher/sync daemon. Two-way means "same files + edit-aware update runs".
- No emission of `[[wikilinks]]` by the agent (OKF models relationships as standard
  Markdown links; the agent must *preserve* wikilinks in human-authored content).
- No writes to Obsidian's app-owned global config (`~/Library/Application
  Support/obsidian/obsidian.json`); vault registration happens when the user opens the
  printed `obsidian://` URI or the folder.

## Approaches considered

- **A. Fully independent third output mode** — new arms at every branch site. Most control,
  largest diff, and every missed site silently inherits the wrong arm. Rejected: surface.
- **B. Reuse `local-wiki` + vault cwd only** — smallest diff, but the prompt would claim the
  root is `~/.openwiki/wiki`, personal-brain canonical pages would be forced onto a
  knowledge vault, no `.obsidian/` write guard, no edit-respect instructions. Rejected:
  wrong semantics.
- **C. Vault-like sibling of local-wiki (CHOSEN)** — add `"obsidian"` run mode and
  `"obsidian-vault"` output mode; share local-wiki path/write semantics by flipping
  `=== "local-wiki"` checks to `!== "repository"` where behavior is genuinely shared, and
  add third arms only where Obsidian differs (prompt config, `.obsidian/` guard, root
  labels, goal source, edit manifest). Small auditable diff; fits the follow-up /simplify.

## Design

### CLI surface

- `openwiki obsidian [--init|--update] [message]` and `--mode obsidian` (positional
  keyword, `--mode` space/`=` forms — same plumbing as existing modes).
- `OpenWikiRunMode = "personal" | "code" | "obsidian"` (src/commands.ts:12); update
  `isOpenWikiRunMode`, both "Expected personal or code" error strings, and help text.
- Default mode for bare invocations stays `code` (unchanged).
- Vault path resolution (new module `src/obsidian-mode.ts`):
  `OPENWIKI_OBSIDIAN_VAULT` env var (managed key, non-secret) → default
  `~/.openwiki/vault`. The env key is added to `src/constants.ts`, `MANAGED_ENV_KEYS`, and
  `isNonSecretDiagnosticKey` in `src/env.ts`.

### Type and branch-site changes

`OpenWikiOutputMode = "local-wiki" | "repository" | "obsidian-vault"`
(src/agent/types.ts:2). Audit of every existing binary branch:

| Site | Treatment for `obsidian-vault` |
|---|---|
| `utils.ts getWikiContentRoot` (303) | vault-like: content root = cwd (flip check to `=== "repository"`) |
| `utils.ts getMetadataFilePath` (310) | vault-like: `<cwd>/.last-update.json` |
| `utils.ts createRunContext` (43) | third arm: vault evidence text + manual-edit diff summary |
| `utils.ts readRunWikiGoal` (75) | third arm: read `<vault>/INSTRUCTIONS.md` |
| `utils.ts writeLastUpdateMetadata` (154) | gitHead stays repository-only; add `vaultFileHashes` when obsidian-vault |
| `utils.ts getUpdateNoopStatus` (89) | unchanged (repository-only; vault mode has no noop skip, same as personal) |
| `docs-only-backend.ts getDocsOnlyWriteError` (56) | third arm: local-wiki freedom **minus** any path under `.obsidian/` (refused) |
| `prompt.ts getOutputPromptConfig` (334) | third arm: full obsidian-vault `OutputPromptConfig` |
| `prompt.ts createModeInstructions` / `createUserPrompt` | update-run additions for manual-edit incorporation |
| `frontmatter-validator.ts isWikiMarkdownPath` (174) | vault-like: root-based like local-wiki |
| `index-middleware.ts synchronizeWikiIndexes` root (52) | vault-like: root `/` (flip to `=== "repository" ? "/openwiki" : "/"`) |
| `agent/index.ts` 101/213/378-399 | cwd honored (outputMode always passed); root label/instruction third arm ("the Obsidian vault") |
| `cli.tsx getRunModeCwd` (3940) | `obsidian` → `getObsidianVaultDir()` |
| `cli.tsx getRunModeOutputMode` (3947) | `obsidian` → `"obsidian-vault"` |

`OpenWikiLocalShellBackend` keeps its `"repository"` default; callers always pass
`outputMode` explicitly (existing behavior).

### `src/obsidian-mode.ts` (sibling of `code-mode.ts`)

- `getObsidianVaultDir(): string` — env override or `~/.openwiki/vault` (module reads
  `os.homedir()` at load time, matching `openwiki-home.ts`; `~` expansion for env value).
- `ensureObsidianVaultSetup(vaultDir): Promise<ObsidianVaultSetupResult>` — idempotent:
  - `mkdir -p` the vault (mode 0o700, like `ensureOpenWikiHome`).
  - Seed `.obsidian/app.json` with `{}` if absent (marks the folder as a vault; Obsidian
    fills in the rest). Never overwrite existing `.obsidian/` contents.
  - Seed `INSTRUCTIONS.md` with a default wiki-goal template if absent (keeps headless
    first runs working and gives the user an in-vault steering file they can edit in
    Obsidian — part of the two-way story).
  - Return `{ vaultDir, obsidianUri, createdVault, seededConfig, seededInstructions }`
    where `obsidianUri = "obsidian://open?path=" + encodeURIComponent(vaultDir)`.
- Invoked from both run paths in `cli.tsx` (interactive `setupPromise` branch and
  `runPrintCommand`) when mode is `obsidian`, mirroring `ensureCodeModeRepoSetup`.
- After a successful obsidian-mode init/update, the CLI prints
  `Open in Obsidian: obsidian://open?path=...` (both paths).

### Prompt config (`obsidian-vault` arm of `getOutputPromptConfig`)

All 19 `OutputPromptConfig` fields, modeled on the local-wiki arm but reworded:

- Root described as "your Obsidian vault (exposed as the virtual root /)"; docsLocation
  "the configured Obsidian vault"; same virtual-path rules (never type host paths).
- Paths: `/quickstart.md` (kept — OKF convention and index generator expectations),
  `/_plan.md`, `/.last-update.json`.
- Synthesis discipline: goal-driven knowledge wiki (from `/INSTRUCTIONS.md`), organized
  topic pages + `/quickstart.md` navigation. No personal-brain canonical pages
  (`/commitments.md`, connector taxonomy, etc.) — those are personal-mode features.
- New **Obsidian conventions** block:
  - Never create, edit, or delete anything under `/.obsidian/`.
  - Human edits are authoritative: incorporate manual changes, never revert them; do not
    recreate pages the human deleted unless the wiki goal requires it (then explain why in
    the page).
  - Preserve `[[wikilinks]]`, tags, aliases, and any unknown frontmatter properties in
    human-authored or human-edited files; the agent's own new links remain standard
    relative Markdown links (OKF edges).
  - Human notes may lack OKF frontmatter; add the minimal `type` frontmatter when
    substantially rewriting such a page, otherwise leave its frontmatter as found.
- Update-command instructions gain: review the "Manual edits since last OpenWiki run"
  section of the user prompt and integrate those changes into related pages.

### Two-way edit detection

- `UpdateMetadata` gains optional `vaultFileHashes?: Record<string, string>`
  (vault-relative path → sha256), written only in `obsidian-vault` mode by
  `writeLastUpdateMetadata` / `persistRunMetadataIfChanged` after init/update runs
  (chat runs already skip metadata writes). `readLastUpdate` tolerates its absence.
- Hash walk: every file under the vault except dot-entries at any level (which excludes
  `.obsidian/` and `.last-update.json`) — exactly the same exclusion rule as the content
  snapshot (below), so the manifest and the snapshot never disagree about what counts as
  content.
- On an obsidian-vault update run, `createRunContext` diffs the manifest against disk →
  `{ added, modified, deleted }`, rendered into the run context as
  "Manual edits since last OpenWiki run" — up to 50 paths listed per category, with a
  "+N more" count beyond that. Missing/corrupt manifest → section omitted (first run:
  everything is implicitly new).

### Shared robustness changes

- `addDirectoryToSnapshot` (utils.ts:250) skips all dot-entries at every level (today it
  skips only `.last-update.json`). Rationale: `.obsidian/workspace.json` churn must not
  make `persistRunMetadataIfChanged` think docs changed; harmless for the other modes.
- `index-middleware.ts parseFrontmatter` becomes tolerant: a listed `.md` with missing or
  invalid frontmatter falls back to `title = basename, no description` instead of
  throwing. Today a single frontmatter-less note (i.e., any note a human creates in
  Obsidian) crashes the post-run index sync. Applied for all modes: strictly more robust,
  no test asserts the throw.

### Onboarding / credentials wizard

- `RUN_MODE_OPTIONS` and `ONBOARDING_TEMPLATES` gain matching `obsidian` entries (same-id
  requirement — `ensureRunModeConfig` silently no-ops otherwise). Template:
  `sourceIds: []`, suggestedGoal describing a curated knowledge vault.
- New `PromptStep`s `obsidian-vault-confirm` / `obsidian-vault-path`, cloned from
  `code-repo-confirm` / `code-repo-path` (default = `getObsidianVaultDir()`; confirmed
  value persisted via `saveOpenWikiEnv({ OPENWIKI_OBSIDIAN_VAULT })`).
- All three duplicated routing tails (`getInitialStep`, `getNextStepAfterRegion`,
  `continueAfterCredentials`) gain the obsidian branch:
  credentials → vault-confirm → wiki-goal → final. No template/cron/sources steps.
- Goal storage: `<vault>/INSTRUCTIONS.md` via new `saveVaultWikiInstructions` /
  `readVaultWikiInstructions` in `src/onboarding.ts` (generalizing the repository
  INSTRUCTIONS.md helpers; `INSTRUCTIONS.md` is already excluded from index generation).
- Completeness: `isObsidianOnboardingCompleteSync(vaultDir)` = vault `INSTRUCTIONS.md`
  non-empty; wired as the third arm of `needsCredentialSetup`; `isOnboardingComplete`
  treats obsidian like code (no ingestion schedule required).
- `saveConfigForCurrentMode` + the mount effect strip `wikiGoal` from the home save for
  obsidian (same as code mode).

### Error handling

- Vault dir uncreatable/invalid → friendly CLI error naming the path and the env var.
- Corrupt `.last-update.json` → existing tolerant `readLastUpdate` path; run proceeds
  without a manual-edit diff.
- Frontmatter warnings continue to apply only to agent-written files; human files are
  never warned about or rewritten wholesale.

### Documentation

- README + `src/commands.ts` help text: document `openwiki obsidian`, the env var, the
  two-way contract, and the `obsidian://` URI. (Generated `openwiki/` pages are left to
  the scheduled OpenWiki workflow per CLAUDE.md.)

## Testing

Unit (vitest, following existing conventions — temp dirs via `mkdtemp`, HOME-swap +
`vi.resetModules()` + dynamic import for anything touching `~/.openwiki` or the vault
default):

- `commands.test.ts`: `obsidian` positional/`--mode` parsing, modeSource, conflicts,
  promotion-after-flags interaction.
- `prompt.test.ts`: obsidian-vault block (root/paths/conventions substrings; must NOT
  mention `~/.openwiki/wiki` or personal canonical pages) + add to the host-path
  prohibition invariant loop.
- `docs-only-backend.test.ts`: obsidian-vault allows root-level writes, refuses
  `.obsidian/**`.
- `test/obsidian-mode.test.ts` (new): vault setup idempotency, seeding rules, URI,
  env-var override + `~` expansion, never clobbers existing `.obsidian/`.
- `utils` additions: manifest write/read/diff (added/modified/deleted), snapshot
  dot-entry exclusion, `readRunWikiGoal` vault arm.
- `index-middleware`: tolerant frontmatter fallback.
- `onboarding.test.ts`: obsidian completeness + no-schedule rule.
- `run-metadata`: `vaultFileHashes` round-trip and absence-tolerance.

Live (after /simplify):

- `pnpm typecheck && pnpm lint:check && pnpm test` (full suite).
- Real CLI runs against a scratch vault (`OPENWIKI_OBSIDIAN_VAULT=<tmp>`): help output;
  `openwiki obsidian --init --print` (real model if credentials available, otherwise
  dev-gated `--dry-run` plus assertion of vault scaffolding side effects); simulate an
  Obsidian edit (add/modify/delete notes, one without frontmatter) → `--update` run must
  surface the manual-edit diff, not crash on index sync, and not revert the edits;
  verify `.obsidian/app.json` seeding and the printed `obsidian://open` URI; open the
  vault in Obsidian to confirm display.

## Decision log (autonomous approvals)

- Third run mode named `obsidian`, output mode `obsidian-vault` — matches "beyond
  personal or code" phrasing of the goal.
- Vault default `~/.openwiki/vault`, not `~/.openwiki/wiki` — avoids cross-mode
  interference with personal mode (upstream commit 1f0862e just fought this class of bug).
- Two-way = same-files + edit-aware runs, not a watcher — YAGNI; a daemon adds a second
  source of truth and conflict surface with Obsidian Sync/iCloud.
- Keep OKF + markdown links for agent output; preserve (don't emit) wikilinks — keeps the
  fork mergeable with upstream OKF work and the deterministic index generator intact.
- Connector ingestion/scheduling excluded from v1 — the goal statement covers engine,
  display, and two-way editing only; ingestion hardcodes personal-wiki paths in prose
  prompts and would balloon the diff.
