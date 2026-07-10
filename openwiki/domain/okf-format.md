---
type: Domain Concept
title: Open Knowledge Format (OKF)
description: The frontmatter and reserved-file contract that every
  OpenWiki-generated bundle (repository docs or personal wiki) must satisfy.
resource: /src/agent/okf.ts
tags:
  - okf
  - frontmatter
  - domain
timestamp: 2026-07-10T07:02:04.970Z
---

# Open Knowledge Format (OKF)

OKF v0.1 (https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) is a portability contract: every OpenWiki bundle — repository `openwiki/` docs or the personal `~/.openwiki/wiki/`, — carries the same frontmatter and reserved-file shape, so the output can be consumed by other agent/knowledge tooling without OpenWiki-specific parsing.

## Why a separate deterministic pass

The documentation agent (an LLM) cannot be relied on to consistently emit conformant frontmatter, generate `index.md`/`log.md` correctly, or keep output byte-stable across idempotent runs. `normalizeOkfBundle()` in `src/agent/okf.ts` runs immediately after every non-chat agent stream completes (see [Architecture overview](../architecture/overview.md#okf-normalization-pass)) and *produces* conformance over the finished tree:

- repairs concept frontmatter, but **never clobbers a model-authored value** — it only fills in missing fields,
- generates the reserved `index.md` and `log.md`,
- is idempotent: a no-op run (nothing changed) re-serializes to byte-identical output, which matters because the [content snapshot](../operations/credentials-and-updates.md#update-metadata) that gates `.last-update.json` writes runs after this pass.

## The frontmatter contract

Every Markdown file in the bundle **except** `index.md` and `log.md` (`OKF_RESERVED_FILENAMES`) is a "concept" and must begin with a YAML frontmatter block:

```markdown
---
type: Architecture
title: Architecture overview
description: One sentence description.
resource: /src/agent/index.ts
tags: [architecture, agent]
---
```

- `type` — required, non-empty. If the model didn't set one, `inferConceptType(relativePath, outputMode)` (`src/constants.ts`) fills it in deterministically from the file's path, using a per-output-mode taxonomy (see below). This is a fallback only — an explicit model-authored `type` is always preserved as-is.
- `title` — required; derived from the first Markdown heading or filename if missing.
- `timestamp` — set/bumped by the pass whenever the concept's body actually changed (tracked via before/after SHA-256 body hashes, `createConceptBodyHashes()`), or when missing entirely. Unchanged bodies keep their existing timestamp.
- `description`, `resource`, `tags` — optional, preserved as authored.
- Frontmatter keys are always serialized in a stable order (`type`, `title`, `description`, `resource`, `tags`, `timestamp`, then any extra keys) so re-serializing unchanged content is byte-identical.

`index.md` files that are **not** the bundle root must not have frontmatter at all (any is stripped by `stripNonRootIndexFrontmatter()`); the root `index.md` must have frontmatter containing only `okf_version` (no other keys).

## Type taxonomy per output mode

`src/constants.ts` defines two taxonomies, selected by `OpenWikiOutputMode`:

**Repository mode** (`REPOSITORY_TYPE_TAXONOMY`): `quickstart.md` → `Overview`; top-level directories `architecture` → `Architecture`, `workflows` → `Workflow`, `domain` → `Domain Concept`, `data-models` → `Data Model`, `api` → `API`, `integrations` → `Integration`, `operations` → `Operation`, `testing` → `Testing`. Anything else falls back to a title-cased version of its top directory name, or `Reference` at the root.

**Local-wiki (personal) mode** (`LOCAL_WIKI_TYPE_TAXONOMY`): `quickstart.md` → `Overview`, `open-questions.md` → `Open Questions`, `themes.md` → `Themes`, `commitments.md` → `Commitments`, `personal-logistics.md` → `Personal Logistics`; directories `sources` → `Source`, `topics` → `Topic`, `projects` → `Project`, `people` → `Person`, `companies` → `Company`, `research` → `Research`, `operations` → `Operation`. Fallback is `Note`.

These taxonomies are also restated as instructions in the system prompt (`src/agent/prompt.ts`, `okfInstruction` per mode) so the model tends to set the right `type` itself; the taxonomy in `src/constants.ts` is the backstop when it doesn't.

## Reserved files: `index.md` and `log.md`

Both are **generated, not model-authored** — the system prompt explicitly tells the agent not to create or hand-edit them, and the OKF pass owns their content:

- `index.md` (bundle root only) — declares `okf_version: "0.1"` in frontmatter and lists every concept (grouped/linked) so the bundle has a canonical table of contents.
- `log.md` — a dated change log. Each `init` run, or any `update` run where at least one file changed, appends a `## YYYY-MM-DD` entry recording the command and how many files changed and the model used. Headings must be ISO dates (`^\d{4}-\d{2}-\d{2}$`); this is enforced by `validateLogFile()`.

## Validation

`validateBundle(root)` in `src/agent/okf.ts` checks a finished bundle for OKF conformance (missing frontmatter, missing `type`, malformed `index.md`/`log.md`, dangling `resource` links) and returns `OkfFinding[]` (`error` or `warning` level). It exists primarily for tests (`test/okf.test.ts`); there is no shipped CLI subcommand that runs it directly against a live bundle.

## Things to watch when editing

- Never write logic in `normalizeOkfBundle()` that overwrites a model-authored frontmatter value — the pass is additive/repairing only.
- If you add a new top-level section directory in either output mode, add it to the corresponding taxonomy in `src/constants.ts` (`REPOSITORY_TYPE_TAXONOMY` or `LOCAL_WIKI_TYPE_TAXONOMY`) and to the matching `okfInstruction` string in `src/agent/prompt.ts`, so inference and prompt guidance stay in sync.
- Idempotency matters: any change to `serializeFrontmatter()`/key ordering must keep unchanged input producing byte-identical output, or scheduled updates will report spurious content changes every run.

## Related pages

- [Architecture overview](../architecture/overview.md) — where the OKF pass sits in the run lifecycle.
- [Credentials and updates](../operations/credentials-and-updates.md) — how the post-OKF content snapshot gates `.last-update.json` writes.
