# Obsidian Engine Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third OpenWiki run mode `obsidian` whose wiki storage engine is an Obsidian vault — displayable in Obsidian (seeded `.obsidian/`, printed `obsidian://open` URI) with two-way updates (manual Obsidian edits detected via a per-file hash manifest and treated as authoritative by the agent).

**Architecture:** `OpenWikiRunMode` gains `"obsidian"` and `OpenWikiOutputMode` gains `"obsidian-vault"`. Shared path/write semantics are expressed by flipping `=== "local-wiki"` checks to `=== "repository"`-negative form (vault-like = everything non-repository); genuine third arms exist only for the prompt config, the `.obsidian/` write guard, runtime root labels, the vault INSTRUCTIONS.md goal source, and the edit manifest. New module `src/obsidian-mode.ts` owns vault resolution/setup. Spec: `docs/superpowers/specs/2026-07-18-obsidian-engine-design.md`.

**Tech Stack:** TypeScript (ESM, Node >= 22), pnpm, vitest, Ink (terminal UI), deepagents backend.

## Global Constraints

- Run mode literal is `obsidian`; output mode literal is `obsidian-vault`; env var is `OPENWIKI_OBSIDIAN_VAULT`; default vault dir is `~/.openwiki/vault`.
- Test imports use relative `../src/<file>.ts` paths WITH the `.ts` extension (no path aliases; vitest default config).
- Tests touching `~/.openwiki` or the vault default MUST use the HOME-swap pattern: save `process.env.HOME`, `mkdtemp` a temp home, `vi.resetModules()`, set HOME, then dynamic `await import(...)` of the module under test; restore in `afterEach` (see `test/env-behavior.test.ts:61-100`).
- Temp dirs: `mkdtemp(path.join(tmpdir(), "openwiki-<suffix>-"))`, tracked in an array, cleaned in `afterEach` with `rm(dir, { recursive: true, force: true })` (pattern: `test/code-mode.test.ts:10-32`).
- Env isolation: save/restore `process.env` keys manually in beforeEach/afterEach; never `vi.stubEnv`.
- The prompt for `obsidian-vault` MUST contain the literal line fragment `Never type ~, ~/.openwiki/wiki, or host paths` and MUST NOT match `/lives in ~\/\.openwiki\/wiki/` (guards in `test/prompt.test.ts`).
- The agent must never write under `.obsidian/`; index generation and snapshots must ignore ALL dot-entries.
- Run every commit's gate: `pnpm test` (full suite), plus `pnpm typecheck` before the final commit of each task.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Widen run/output mode types and CLI parsing

**Files:**
- Modify: `src/commands.ts` (lines 12, 394, 402, 424, 585-589, help content 628-773)
- Modify: `src/agent/types.ts:2`
- Test: `test/commands.test.ts`

**Interfaces:**
- Produces: `OpenWikiRunMode = "personal" | "code" | "obsidian"` (src/commands.ts), `OpenWikiOutputMode = "local-wiki" | "repository" | "obsidian-vault"` (src/agent/types.ts). All later tasks rely on these exact literals.
- Note: widening `OpenWikiOutputMode` compiles everywhere because every existing branch is a binary ternary; behavior for the new literals lands in Tasks 3-8.

- [ ] **Step 1: Write failing tests** — append to `test/commands.test.ts` (inside the existing top-level describe, alongside the other mode cases):

```ts
describe("obsidian mode parsing", () => {
  test("positional obsidian keyword selects obsidian mode", () => {
    expect(parseCommand(["obsidian"])).toMatchObject({
      kind: "run",
      command: "chat",
      mode: "obsidian",
      modeSource: "positional",
      shouldStart: false,
    });
  });

  test("obsidian --init runs init in obsidian mode", () => {
    expect(parseCommand(["obsidian", "--init"])).toMatchObject({
      kind: "run",
      command: "init",
      mode: "obsidian",
      modeSource: "positional",
      shouldStart: true,
    });
  });

  test("--mode obsidian selects obsidian mode", () => {
    expect(parseCommand(["--update", "--mode", "obsidian"])).toMatchObject({
      kind: "run",
      command: "update",
      mode: "obsidian",
      modeSource: "option",
    });
  });

  test("--mode=obsidian selects obsidian mode", () => {
    expect(parseCommand(["--mode=obsidian"])).toMatchObject({
      kind: "run",
      mode: "obsidian",
      modeSource: "option",
    });
  });

  test("mode word after flags is promoted once", () => {
    expect(parseCommand(["--print", "obsidian", "--update"])).toMatchObject({
      kind: "run",
      command: "update",
      mode: "obsidian",
      modeSource: "positional",
      userMessage: null,
    });
  });

  test("conflicting modes error", () => {
    expect(parseCommand(["obsidian", "--mode", "code"])).toMatchObject({
      kind: "error",
      message: "Conflicting modes: obsidian and code.",
    });
  });

  test("invalid mode error names all three modes", () => {
    expect(parseCommand(["--mode", "banana"])).toMatchObject({
      kind: "error",
      message: "Invalid mode: banana. Expected personal, code, or obsidian.",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run test/commands.test.ts` → the new tests FAIL (mode word treated as user message / old error strings).

- [ ] **Step 3: Implement**

`src/agent/types.ts:2`:
```ts
export type OpenWikiOutputMode = "local-wiki" | "repository" | "obsidian-vault";
```

`src/commands.ts:12`:
```ts
export type OpenWikiRunMode = "personal" | "code" | "obsidian";
```

`src/commands.ts:585-589`:
```ts
function isOpenWikiRunMode(
  value: string | undefined,
): value is OpenWikiRunMode {
  return value === "personal" || value === "code" || value === "obsidian";
}
```

`src/commands.ts:394` → `message: "--mode requires personal, code, or obsidian.",`
`src/commands.ts:402` and `:424` → `` message: `Invalid mode: ${nextArg}. Expected personal, code, or obsidian.`, `` (use `rawMode` at 424).

Help content edits in `helpContent`:
- `usage`: after `"openwiki personal [--init|--update] [message]"` add `"openwiki obsidian [--init|--update] [message]"`; change the `--mode` usage line to `"openwiki --mode <personal|code|obsidian> [--init|--update] [message]"`.
- `commands`: after the `openwiki personal` row add:
```ts
{
  label: "openwiki obsidian",
  description:
    "Run OpenWiki over an Obsidian vault (default ~/.openwiki/vault, override with OPENWIKI_OBSIDIAN_VAULT). Edits made in Obsidian are detected and respected on the next run.",
},
```
- `options`: change the `--mode` row label to `"--mode <personal|code|obsidian>"` and description to `"Choose the personal brain (local, over configured sources), the code brain (repository docs), or the Obsidian vault wiki."`.
- `examples`: after `"openwiki personal --init"` add `"openwiki obsidian --init"` and `'openwiki obsidian --update "Fold in my manual notes"'`.

- [ ] **Step 4: Run tests** — `pnpm vitest run test/commands.test.ts` → PASS, then `pnpm test` → full suite PASS (no other test asserts the old strings; fix any straggler assertions if the suite disagrees).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add obsidian run mode and obsidian-vault output mode to CLI types"`

---

### Task 2: Vault env key + `src/obsidian-mode.ts`

**Files:**
- Modify: `src/constants.ts` (append near line 30)
- Modify: `src/env.ts` (MANAGED_ENV_KEYS list ~line 81; `isNonSecretDiagnosticKey` ~line 279)
- Create: `src/obsidian-mode.ts`
- Test: `test/obsidian-mode.test.ts` (new)

**Interfaces:**
- Produces:
  - `OPENWIKI_OBSIDIAN_VAULT_ENV_KEY = "OPENWIKI_OBSIDIAN_VAULT"` (src/constants.ts)
  - `getObsidianVaultDir(): string`
  - `createObsidianVaultUri(vaultDir: string): string`
  - `ensureObsidianVaultSetup(vaultDir?: string): Promise<ObsidianVaultSetupResult>` where `ObsidianVaultSetupResult = { vaultDir: string; obsidianUri: string; createdVault: boolean; seededConfig: boolean; seededInstructions: boolean }`
  - `DEFAULT_OBSIDIAN_INSTRUCTIONS: string`
- Consumed by: Task 9 (cli.tsx), Task 10 (credentials.tsx / onboarding).

- [ ] **Step 1: Write failing tests** — `test/obsidian-mode.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_VAULT_ENV = process.env.OPENWIKI_OBSIDIAN_VAULT;

let tempHome: string;
const tempDirs: string[] = [];

async function importObsidianMode() {
  return await import("../src/obsidian-mode.ts");
}

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), "openwiki-obsidian-home-"));
  tempDirs.push(tempHome);
  vi.resetModules();
  process.env.HOME = tempHome;
  delete process.env.OPENWIKI_OBSIDIAN_VAULT;
});

afterEach(async () => {
  vi.resetModules();
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_VAULT_ENV === undefined) delete process.env.OPENWIKI_OBSIDIAN_VAULT;
  else process.env.OPENWIKI_OBSIDIAN_VAULT = ORIGINAL_VAULT_ENV;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("getObsidianVaultDir", () => {
  test("defaults to ~/.openwiki/vault", async () => {
    const { getObsidianVaultDir } = await importObsidianMode();
    expect(getObsidianVaultDir()).toBe(
      path.join(tempHome, ".openwiki", "vault"),
    );
  });

  test("honors OPENWIKI_OBSIDIAN_VAULT with ~ expansion", async () => {
    process.env.OPENWIKI_OBSIDIAN_VAULT = "~/notes/my-vault";
    const { getObsidianVaultDir } = await importObsidianMode();
    expect(getObsidianVaultDir()).toBe(path.join(tempHome, "notes", "my-vault"));
  });
});

describe("ensureObsidianVaultSetup", () => {
  test("creates vault, seeds .obsidian/app.json and INSTRUCTIONS.md, returns URI", async () => {
    const { ensureObsidianVaultSetup } = await importObsidianMode();
    const vaultDir = path.join(tempHome, ".openwiki", "vault");

    const result = await ensureObsidianVaultSetup(vaultDir);

    expect(result).toMatchObject({
      vaultDir,
      createdVault: true,
      seededConfig: true,
      seededInstructions: true,
    });
    expect(result.obsidianUri).toBe(
      `obsidian://open?path=${encodeURIComponent(vaultDir)}`,
    );
    expect((await stat(vaultDir)).isDirectory()).toBe(true);
    expect(
      JSON.parse(await readFile(path.join(vaultDir, ".obsidian", "app.json"), "utf8")),
    ).toEqual({});
    expect(
      await readFile(path.join(vaultDir, "INSTRUCTIONS.md"), "utf8"),
    ).toContain("Obsidian");
  });

  test("is idempotent and never clobbers existing files", async () => {
    const { ensureObsidianVaultSetup } = await importObsidianMode();
    const vaultDir = path.join(tempHome, "existing-vault");
    await mkdir(path.join(vaultDir, ".obsidian"), { recursive: true });
    await writeFile(
      path.join(vaultDir, ".obsidian", "app.json"),
      '{"custom":true}',
      "utf8",
    );
    await writeFile(path.join(vaultDir, "INSTRUCTIONS.md"), "My goal\n", "utf8");

    const result = await ensureObsidianVaultSetup(vaultDir);

    expect(result).toMatchObject({
      createdVault: false,
      seededConfig: false,
      seededInstructions: false,
    });
    expect(
      await readFile(path.join(vaultDir, ".obsidian", "app.json"), "utf8"),
    ).toBe('{"custom":true}');
    expect(await readFile(path.join(vaultDir, "INSTRUCTIONS.md"), "utf8")).toBe(
      "My goal\n",
    );
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/obsidian-mode.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`src/constants.ts` — append after the existing env-key constants (near line 30):
```ts
export const OPENWIKI_OBSIDIAN_VAULT_ENV_KEY = "OPENWIKI_OBSIDIAN_VAULT";
```

`src/env.ts` — import the new constant alongside the existing constants import; append `OPENWIKI_OBSIDIAN_VAULT_ENV_KEY,` to `MANAGED_ENV_KEYS` right after `OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY,`; add `key === OPENWIKI_OBSIDIAN_VAULT_ENV_KEY ||` as the first clause of `isNonSecretDiagnosticKey`.

Create `src/obsidian-mode.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPENWIKI_OBSIDIAN_VAULT_ENV_KEY } from "./constants.js";
import { isFileNotFoundError } from "./fs-errors.js";

export type ObsidianVaultSetupResult = {
  vaultDir: string;
  obsidianUri: string;
  createdVault: boolean;
  seededConfig: boolean;
  seededInstructions: boolean;
};

export const DEFAULT_OBSIDIAN_INSTRUCTIONS = `A curated knowledge wiki maintained by OpenWiki inside this Obsidian vault.

Edit this file in Obsidian to steer what OpenWiki tracks and how it organizes pages. Notes you add or edit in Obsidian are authoritative: OpenWiki incorporates them on the next update run and never reverts them.
`;

/** Resolves the Obsidian vault directory: env override (with ~ expansion) or ~/.openwiki/vault. */
export function getObsidianVaultDir(): string {
  const override = process.env[OPENWIKI_OBSIDIAN_VAULT_ENV_KEY]?.trim();

  if (override) {
    return expandHomePath(override);
  }

  return path.join(os.homedir(), ".openwiki", "vault");
}

export function createObsidianVaultUri(vaultDir: string): string {
  return `obsidian://open?path=${encodeURIComponent(vaultDir)}`;
}

/**
 * Idempotently prepares a directory as an Obsidian vault: creates it, seeds a
 * minimal .obsidian/app.json (so Obsidian recognizes the folder as a vault),
 * and seeds INSTRUCTIONS.md with a default wiki brief. Never overwrites
 * existing files.
 */
export async function ensureObsidianVaultSetup(
  vaultDir = getObsidianVaultDir(),
): Promise<ObsidianVaultSetupResult> {
  const createdVault = await mkdirIfMissing(vaultDir);
  await mkdir(path.join(vaultDir, ".obsidian"), { recursive: true });
  const seededConfig = await writeIfMissing(
    path.join(vaultDir, ".obsidian", "app.json"),
    "{}\n",
  );
  const seededInstructions = await writeIfMissing(
    path.join(vaultDir, "INSTRUCTIONS.md"),
    DEFAULT_OBSIDIAN_INSTRUCTIONS,
  );

  return {
    vaultDir,
    obsidianUri: createObsidianVaultUri(vaultDir),
    createdVault,
    seededConfig,
    seededInstructions,
  };
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

async function mkdirIfMissing(dir: string): Promise<boolean> {
  const firstCreated = await mkdir(dir, { recursive: true, mode: 0o700 });
  return firstCreated !== undefined;
}

async function writeIfMissing(
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (isFileExistsError(error)) {
      return false;
    }

    throw error;
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}
```
Note: `isFileNotFoundError` import is unused in the final version above — do not import it (avoid the lint error). `mkdir` with `recursive: true` returns the first created path or `undefined`, which distinguishes created vs pre-existing.

- [ ] **Step 4: Run tests** — `pnpm vitest run test/obsidian-mode.test.ts test/env.test.ts test/env-behavior.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add obsidian vault resolution and idempotent vault setup"`

---

### Task 3: Vault-like content paths + snapshot dot-entry exclusion

**Files:**
- Modify: `src/agent/utils.ts` (`getWikiContentRoot` 303-308, `getMetadataFilePath` 310-317, `addDirectoryToSnapshot` 268-279)
- Test: `test/utils.test.ts` (append)

**Interfaces:**
- Produces: `obsidian-vault` resolves content root to `cwd` and metadata to `<cwd>/.last-update.json`; `createOpenWikiContentSnapshot` (already exported) ignores every dot-entry at every level.

- [ ] **Step 1: Write failing tests** — append to `test/utils.test.ts`:

```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createOpenWikiContentSnapshot } from "../src/agent/utils.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("createOpenWikiContentSnapshot dot-entry exclusion", () => {
  test("ignores .obsidian and other dot entries but sees content changes", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-snap-"));
    tempDirs.push(vault);
    await writeFile(path.join(vault, "quickstart.md"), "---\ntype: Guide\n---\nhi\n");

    const before = await createOpenWikiContentSnapshot(vault, "obsidian-vault");

    await mkdir(path.join(vault, ".obsidian"), { recursive: true });
    await writeFile(path.join(vault, ".obsidian", "workspace.json"), "{}");
    await writeFile(path.join(vault, ".last-update.json"), "{}");
    expect(await createOpenWikiContentSnapshot(vault, "obsidian-vault")).toBe(
      before,
    );

    await writeFile(path.join(vault, "notes.md"), "---\ntype: Note\n---\nnew\n");
    expect(
      await createOpenWikiContentSnapshot(vault, "obsidian-vault"),
    ).not.toBe(before);
  });
});
```
(Merge imports with any already present at the top of the file rather than duplicating.)

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/utils.test.ts` → the `.obsidian` addition changes the hash today → FAIL.

- [ ] **Step 3: Implement** in `src/agent/utils.ts`:

Replace the metadata-file exclusion inside `addDirectoryToSnapshot` (lines 274-279):
```ts
    // Dot entries (.obsidian/, .last-update.json, .git, ...) are runtime or
    // app state, not wiki content; hashing them would make Obsidian workspace
    // churn look like documentation changes.
    if (entry.name.startsWith(".")) {
      continue;
    }
```
(The old `relativePath === path.basename(UPDATE_METADATA_PATH) || relativePath === LOCAL_WIKI_METADATA_PATH` check is subsumed: both basenames start with a dot. Remove it.)

Flip the two path switches:
```ts
function getWikiContentRoot(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): string {
  return outputMode === "repository" ? path.join(cwd, OPEN_WIKI_DIR) : cwd;
}

function getMetadataFilePath(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): string {
  return outputMode === "repository"
    ? path.join(cwd, UPDATE_METADATA_PATH)
    : path.join(cwd, LOCAL_WIKI_METADATA_PATH);
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run test/utils.test.ts test/run-metadata.test.ts test/update-noop.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: vault-like content paths and dot-entry snapshot exclusion"`

---

### Task 4: Vault file-hash manifest (two-way detection core)

**Files:**
- Modify: `src/agent/types.ts` (UpdateMetadata, lines 45-50)
- Modify: `src/agent/utils.ts` (`writeLastUpdateMetadata` 144-164, `readLastUpdate` 211-245, new exported helpers)
- Test: `test/run-metadata.test.ts` (append) and `test/utils.test.ts` (append)

**Interfaces:**
- Produces (all exported from `src/agent/utils.ts`):
  - `type VaultEditDiff = { added: string[]; modified: string[]; deleted: string[] }`
  - `computeVaultFileHashes(vaultRoot: string): Promise<Record<string, string>>` — vault-relative POSIX paths → sha256 hex; skips dot-entries at every level.
  - `diffVaultFileHashes(previous: Record<string, string> | undefined, current: Record<string, string>): VaultEditDiff`
  - `formatManualEditsSummary(diff: VaultEditDiff): string` — "No manual edits detected since the last OpenWiki run." when empty; otherwise `Added:`/`Modified:`/`Deleted:` sections listing up to 50 paths each as `- <path>` lines plus `- ...and N more` beyond the cap.
- Produces: `UpdateMetadata.vaultFileHashes?: Record<string, string>`, written only when `outputMode === "obsidian-vault"`, round-tripped by `readLastUpdate`.

- [ ] **Step 1: Write failing tests**

Append to `test/utils.test.ts`:
```ts
import {
  computeVaultFileHashes,
  diffVaultFileHashes,
  formatManualEditsSummary,
} from "../src/agent/utils.ts";

describe("vault file hash manifest", () => {
  test("computeVaultFileHashes hashes content files and skips dot entries", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-hash-"));
    tempDirs.push(vault);
    await writeFile(path.join(vault, "a.md"), "alpha");
    await mkdir(path.join(vault, "topics"));
    await writeFile(path.join(vault, "topics", "b.md"), "beta");
    await mkdir(path.join(vault, ".obsidian"), { recursive: true });
    await writeFile(path.join(vault, ".obsidian", "app.json"), "{}");
    await writeFile(path.join(vault, ".last-update.json"), "{}");

    const hashes = await computeVaultFileHashes(vault);

    expect(Object.keys(hashes).sort()).toEqual(["a.md", "topics/b.md"]);
    expect(hashes["a.md"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("diffVaultFileHashes classifies added/modified/deleted", () => {
    const previous = { "a.md": "1", "b.md": "2", "c.md": "3" };
    const current = { "a.md": "1", "b.md": "changed", "d.md": "4" };

    expect(diffVaultFileHashes(previous, current)).toEqual({
      added: ["d.md"],
      modified: ["b.md"],
      deleted: ["c.md"],
    });
  });

  test("diff with no previous manifest reports everything as added", () => {
    expect(diffVaultFileHashes(undefined, { "a.md": "1" })).toEqual({
      added: ["a.md"],
      modified: [],
      deleted: [],
    });
  });

  test("formatManualEditsSummary renders sections and caps at 50", () => {
    const noEdits = formatManualEditsSummary({ added: [], modified: [], deleted: [] });
    expect(noEdits).toBe("No manual edits detected since the last OpenWiki run.");

    const many = Array.from({ length: 55 }, (_, i) => `page-${i}.md`);
    const summary = formatManualEditsSummary({
      added: ["new.md"],
      modified: many,
      deleted: [],
    });
    expect(summary).toContain("Added:\n- new.md");
    expect(summary).toContain("Modified:");
    expect(summary).toContain("- ...and 5 more");
    expect(summary).not.toContain("Deleted:");
  });
});
```

Append to `test/run-metadata.test.ts` (follow its existing temp-dir/import conventions; it exercises `writeLastUpdateMetadata`/metadata round-trips):
```ts
test("obsidian-vault metadata records and re-reads vaultFileHashes", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-meta-"));
  tempDirs.push(vault);
  await writeFile(path.join(vault, "quickstart.md"), "---\ntype: Guide\n---\n");

  await writeLastUpdateMetadata("update", vault, "test-model", "obsidian-vault");

  const raw = JSON.parse(
    await readFile(path.join(vault, ".last-update.json"), "utf8"),
  );
  expect(raw.vaultFileHashes).toEqual({
    "quickstart.md": expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(raw.gitHead).toBeUndefined();

  const context = await createRunContext("update", vault, "obsidian-vault");
  expect(context.lastUpdate?.vaultFileHashes).toEqual(raw.vaultFileHashes);
});
```
(Import `writeLastUpdateMetadata` and `createRunContext` from `../src/agent/utils.ts`, plus `readFile`/`writeFile`/`mkdtemp` as needed; declare a `tempDirs` array with `afterEach` cleanup if the file does not already have one.)

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/utils.test.ts test/run-metadata.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement**

`src/agent/types.ts` — extend `UpdateMetadata`:
```ts
export type UpdateMetadata = {
  updatedAt: string;
  command: OpenWikiCommand;
  gitHead?: string;
  model: string;
  vaultFileHashes?: Record<string, string>;
};
```

`src/agent/utils.ts` — add exports (place near the snapshot helpers):
```ts
export type VaultEditDiff = {
  added: string[];
  modified: string[];
  deleted: string[];
};

const MANUAL_EDITS_LIST_CAP = 50;

/**
 * Hashes every content file in the vault (dot entries excluded at every
 * level) so the next run can tell which files a human changed in Obsidian.
 */
export async function computeVaultFileHashes(
  vaultRoot: string,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  await addDirectoryToVaultHashes(hashes, vaultRoot, "");
  return hashes;
}

async function addDirectoryToVaultHashes(
  hashes: Record<string, string>,
  directory: string,
  relativeDirectory: string,
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isExpectedSnapshotRaceError(error)) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await addDirectoryToVaultHashes(hashes, entryPath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileContent = await readSnapshotFile(entryPath);

    if (fileContent === null) {
      continue;
    }

    hashes[relativePath] = createHash("sha256").update(fileContent).digest("hex");
  }
}

export function diffVaultFileHashes(
  previous: Record<string, string> | undefined,
  current: Record<string, string>,
): VaultEditDiff {
  const previousHashes = previous ?? {};
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [file, hash] of Object.entries(current)) {
    if (!(file in previousHashes)) {
      added.push(file);
    } else if (previousHashes[file] !== hash) {
      modified.push(file);
    }
  }

  for (const file of Object.keys(previousHashes)) {
    if (!(file in current)) {
      deleted.push(file);
    }
  }

  added.sort();
  modified.sort();
  deleted.sort();

  return { added, modified, deleted };
}

export function formatManualEditsSummary(diff: VaultEditDiff): string {
  const sections = (
    [
      ["Added", diff.added],
      ["Modified", diff.modified],
      ["Deleted", diff.deleted],
    ] as const
  )
    .filter(([, files]) => files.length > 0)
    .map(([label, files]) => {
      const listed = files
        .slice(0, MANUAL_EDITS_LIST_CAP)
        .map((file) => `- ${file}`);
      if (files.length > MANUAL_EDITS_LIST_CAP) {
        listed.push(`- ...and ${files.length - MANUAL_EDITS_LIST_CAP} more`);
      }
      return `${label}:\n${listed.join("\n")}`;
    });

  return sections.length > 0
    ? sections.join("\n\n")
    : "No manual edits detected since the last OpenWiki run.";
}
```

`writeLastUpdateMetadata` — build the metadata object conditionally:
```ts
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    gitHead: outputMode === "repository" ? await getGitHead(cwd) : undefined,
    model: modelId,
    ...(outputMode === "obsidian-vault"
      ? { vaultFileHashes: await computeVaultFileHashes(cwd) }
      : {}),
  };
```

`readLastUpdate` — inside the returned object add:
```ts
        vaultFileHashes: isStringRecord(parsedMetadata.vaultFileHashes)
          ? parsedMetadata.vaultFileHashes
          : undefined,
```
and add the helper near the bottom of the file:
```ts
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run test/utils.test.ts test/run-metadata.test.ts test/update-noop.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: per-file vault hash manifest for manual-edit detection"`

---

### Task 5: Run context + wiki goal for the vault (incl. onboarding INSTRUCTIONS helpers)

**Files:**
- Modify: `src/onboarding.ts` (add vault INSTRUCTIONS helpers after the repository ones, ~line 167)
- Modify: `src/agent/utils.ts` (`createRunContext` 43-73, `readRunWikiGoal` 75-84)
- Test: `test/utils.test.ts` (append)

**Interfaces:**
- Produces (from `src/onboarding.ts`):
  - `getVaultWikiInstructionsPath(vaultDir: string): string` → `<vaultDir>/INSTRUCTIONS.md`
  - `readVaultWikiInstructions(vaultDir: string): Promise<string | undefined>`
  - `readVaultWikiInstructionsSync(vaultDir: string): string | undefined` (exported; Task 10 uses it)
  - `saveVaultWikiInstructions(vaultDir: string, wikiGoal: string): Promise<void>`
- Produces: `createRunContext(command, cwd, "obsidian-vault")` returns `gitSummary` text that starts with `Obsidian vault mode:` and, for update runs with a prior manifest, contains a `Manual edits since last OpenWiki run:` section.

- [ ] **Step 1: Write failing tests** — append to `test/utils.test.ts`:

```ts
import { createRunContext, writeLastUpdateMetadata } from "../src/agent/utils.ts";

describe("obsidian-vault run context", () => {
  test("reads wiki goal from vault INSTRUCTIONS.md and reports manual edits", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-ctx-"));
    tempDirs.push(vault);
    await writeFile(path.join(vault, "INSTRUCTIONS.md"), "Track my research\n");
    await writeFile(path.join(vault, "quickstart.md"), "---\ntype: Guide\n---\n");

    await writeLastUpdateMetadata("update", vault, "test-model", "obsidian-vault");

    await writeFile(path.join(vault, "quickstart.md"), "---\ntype: Guide\n---\nedited by human\n");
    await writeFile(path.join(vault, "human-note.md"), "no frontmatter note\n");

    const context = await createRunContext("update", vault, "obsidian-vault");

    expect(context.wikiGoal).toBe("Track my research");
    expect(context.gitSummary).toContain("Obsidian vault mode:");
    expect(context.gitSummary).toContain("Manual edits since last OpenWiki run:");
    expect(context.gitSummary).toContain("- human-note.md");
    expect(context.gitSummary).toContain("- quickstart.md");
  });

  test("init run without manifest treats vault content as human-authored", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-init-"));
    tempDirs.push(vault);

    const context = await createRunContext("init", vault, "obsidian-vault");

    expect(context.gitSummary).toContain("Obsidian vault mode:");
    expect(context.gitSummary).toContain("human-authored");
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/utils.test.ts` → FAIL (context takes the local-wiki branch; goal read from onboarding config).

- [ ] **Step 3: Implement**

`src/onboarding.ts` — add after `saveRepositoryWikiInstructions` (line 167):
```ts
export function getVaultWikiInstructionsPath(vaultDir: string): string {
  return path.join(vaultDir, REPOSITORY_INSTRUCTIONS_FILE);
}

export async function readVaultWikiInstructions(
  vaultDir: string,
): Promise<string | undefined> {
  try {
    const content = (
      await readFile(getVaultWikiInstructionsPath(vaultDir), "utf8")
    ).trim();
    return content.length > 0 ? content : undefined;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

export function readVaultWikiInstructionsSync(
  vaultDir: string,
): string | undefined {
  const instructionsPath = getVaultWikiInstructionsPath(vaultDir);

  if (!existsSync(instructionsPath)) {
    return undefined;
  }

  const content = readFileSync(instructionsPath, "utf8").trim();
  return content.length > 0 ? content : undefined;
}

export async function saveVaultWikiInstructions(
  vaultDir: string,
  wikiGoal: string,
): Promise<void> {
  const instructionsPath = getVaultWikiInstructionsPath(vaultDir);
  await mkdir(path.dirname(instructionsPath), { recursive: true });
  await writeFile(instructionsPath, `${wikiGoal.trim()}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
}
```

`src/agent/utils.ts`:
- Add `readVaultWikiInstructions` to the existing `../onboarding.js` import.
- In `createRunContext`, insert between the `chat` early return and the `local-wiki` branch:
```ts
  if (outputMode === "obsidian-vault") {
    return {
      lastUpdate,
      gitSummary: await createVaultEditSummary(command, cwd, lastUpdate),
      wikiGoal,
    };
  }
```
- In `readRunWikiGoal`:
```ts
async function readRunWikiGoal(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): Promise<string | undefined> {
  if (outputMode === "repository") {
    return readRepositoryWikiInstructions(cwd);
  }

  if (outputMode === "obsidian-vault") {
    return readVaultWikiInstructions(cwd);
  }

  return (await readOpenWikiOnboardingConfig()).wikiGoal;
}
```
- Add the summary builder near the other private helpers:
```ts
const VAULT_MODE_CONTEXT_HEADER =
  "Obsidian vault mode: the wiki is stored in an Obsidian vault. Git repository diff context is not used for this run. Manual edits made in Obsidian are authoritative input: incorporate them and never revert them.";

async function createVaultEditSummary(
  command: OpenWikiCommand,
  vaultRoot: string,
  lastUpdate: UpdateMetadata | null,
): Promise<string> {
  if (command === "init" || !lastUpdate?.vaultFileHashes) {
    return `${VAULT_MODE_CONTEXT_HEADER}\nNo previous OpenWiki file manifest exists. Treat all existing vault content as human-authored and authoritative.`;
  }

  const diff = diffVaultFileHashes(
    lastUpdate.vaultFileHashes,
    await computeVaultFileHashes(vaultRoot),
  );

  return `${VAULT_MODE_CONTEXT_HEADER}\n\nManual edits since last OpenWiki run:\n${formatManualEditsSummary(diff)}`;
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run test/utils.test.ts test/onboarding.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: vault run context with manual-edit summary and vault wiki goal"`

---

### Task 6: `.obsidian/` write guard in the backend

**Files:**
- Modify: `src/agent/docs-only-backend.ts` (`getDocsOnlyWriteError` 56-66, new helper)
- Test: `test/docs-only-backend.test.ts` (append)

**Interfaces:**
- Produces: with `outputMode: "obsidian-vault"` and `docsOnly: true`, writes anywhere in the vault succeed EXCEPT paths under `/.obsidian/`, refused with `` `OpenWiki must not modify Obsidian settings under /.obsidian/. Refused path: ${filePath}` ``. Exported `isObsidianConfigPath(filePath: string): boolean` for tests.

- [ ] **Step 1: Write failing tests** — append to `test/docs-only-backend.test.ts`, following the local-wiki block at lines 52-68 (temp `rootDir` via `mkdtemp`, real-file verification, `MUTATION_PATH_METADATA_KEY` assertion):

```ts
describe("obsidian-vault output mode", () => {
  test("allows root-level and nested wiki writes", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "openwiki-vault-backend-"));
    tempDirs.push(rootDir);
    const backend = new OpenWikiLocalShellBackend({
      docsOnly: true,
      outputMode: "obsidian-vault",
      rootDir,
      virtualMode: true,
    });

    const result = await backend.write("/quickstart.md", "---\ntype: Guide\n---\n");

    expect(result.error).toBeUndefined();
    expect(result.metadata?.[MUTATION_PATH_METADATA_KEY]).toBeDefined();
    expect(
      await readFile(path.join(rootDir, "quickstart.md"), "utf8"),
    ).toContain("type: Guide");
  });

  test("refuses writes under .obsidian", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "openwiki-vault-backend-"));
    tempDirs.push(rootDir);
    const backend = new OpenWikiLocalShellBackend({
      docsOnly: true,
      outputMode: "obsidian-vault",
      rootDir,
      virtualMode: true,
    });

    const result = await backend.write("/.obsidian/app.json", "{}");

    expect(result.error).toBe(
      "OpenWiki must not modify Obsidian settings under /.obsidian/. Refused path: /.obsidian/app.json",
    );
  });
});

describe("isObsidianConfigPath", () => {
  test("matches .obsidian paths in any normalized form", () => {
    expect(isObsidianConfigPath("/.obsidian/app.json")).toBe(true);
    expect(isObsidianConfigPath(".obsidian")).toBe(true);
    expect(isObsidianConfigPath("\\.obsidian\\graph.json")).toBe(true);
    expect(isObsidianConfigPath("/notes/.obsidian.md")).toBe(false);
    expect(isObsidianConfigPath("/quickstart.md")).toBe(false);
  });
});
```
(Reuse the file's existing imports/`tempDirs` pattern; add `isObsidianConfigPath` to the import from `../src/agent/docs-only-backend.ts`.)

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/docs-only-backend.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `src/agent/docs-only-backend.ts`:

```ts
  private getDocsOnlyWriteError(filePath: string): string | null {
    if (!this.docsOnly) {
      return null;
    }

    if (this.outputMode === "obsidian-vault") {
      return isObsidianConfigPath(filePath)
        ? `OpenWiki must not modify Obsidian settings under /.obsidian/. Refused path: ${filePath}`
        : null;
    }

    if (this.outputMode === "local-wiki" || isOpenWikiDocsPath(filePath)) {
      return null;
    }

    return `OpenWiki repository init/update runs may only write under /${OPEN_WIKI_DIR}/. Refused path: ${filePath}`;
  }
```
and after `isOpenWikiDocsPath`:
```ts
export function isObsidianConfigPath(filePath: string): boolean {
  const normalizedPath = filePath.trim().replace(/\\/gu, "/");
  const virtualPath = normalizedPath.replace(/^\/+/u, "");

  return virtualPath === ".obsidian" || virtualPath.startsWith(".obsidian/");
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run test/docs-only-backend.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: refuse agent writes under .obsidian in vault mode"`

---

### Task 7: Validator path scope, index root, tolerant frontmatter

**Files:**
- Modify: `src/agent/frontmatter-validator.ts` (`isWikiMarkdownPath` 164-176)
- Modify: `src/agent/index-middleware.ts` (`synchronizeWikiIndexes` root at line 52; `parseFrontmatter` 172-203)
- Test: `test/index-middleware.test.ts` (append), `test/frontmatter-validator.test.ts` (append)

**Interfaces:**
- Produces: `obsidian-vault` validates root-based wiki paths like `local-wiki`; index sync roots at `/` for both vault-like modes; `parseFrontmatter` (index-middleware) no longer throws — missing/invalid/non-mapping frontmatter yields `{}` so human notes fall back to basename labels.

- [ ] **Step 1: Write failing tests**

Append to `test/frontmatter-validator.test.ts` (mirror how the file exercises `addFrontmatterWarning` or path checks; if it tests `isWikiMarkdownPath` indirectly, drive `addFrontmatterWarning` with a fake backend for a root-level path and `outputMode: "obsidian-vault"` and assert a warning is appended for a frontmatter-less write; follow the file's existing fake-backend/ToolMessage helpers exactly).

Append to `test/index-middleware.test.ts` (follow its existing backend/fixture helpers):
```ts
test("indexes files without frontmatter using the basename in obsidian-vault mode", async () => {
  // Arrange a backend rooted at a temp dir containing:
  //   human-note.md            -> "just a note, no frontmatter"
  //   documented.md            -> "---\ntype: Note\ntitle: Documented\n---\nbody"
  // using this file's existing backend-construction helper, then:
  await synchronizeWikiIndexes(backend, "obsidian-vault");

  const index = await readBackendFile(backend, "/index.md");
  expect(index).toContain("[human-note](human-note.md)");
  expect(index).toContain("[Documented](documented.md)");
});

test("invalid YAML frontmatter no longer crashes index sync", async () => {
  // fixture: broken.md -> "---\n: [unclosed\n---\nbody"
  await expect(
    synchronizeWikiIndexes(backend, "obsidian-vault"),
  ).resolves.toBeUndefined();
});
```
(Adapt the arrange comments to the file's actual helpers — it already constructs backends and reads results; the assertions above are the contract.)

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/index-middleware.test.ts test/frontmatter-validator.test.ts` → the no-frontmatter case throws today → FAIL.

- [ ] **Step 3: Implement**

`src/agent/frontmatter-validator.ts` — last clause of `isWikiMarkdownPath`:
```ts
    (outputMode !== "repository" || normalized.startsWith("/openwiki/"))
```

`src/agent/index-middleware.ts`:
- Line 52: `const root = outputMode === "repository" ? "/openwiki" : "/";`
- Make `parseFrontmatter` tolerant (replace every `throw` in it with a `{}` return; drop the now-unused `filePath` param and its call-site argument, or keep the param and ignore it — prefer dropping it):
```ts
/**
 * Parses usable optional display metadata from YAML front matter. Tolerant by
 * design: human-authored notes (e.g. created in Obsidian) may have no front
 * matter at all, and index generation must still succeed with basename labels.
 */
function parseFrontmatter(content: string): {
  description?: string;
  title?: string;
} {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
  if (!block) return {};

  let fields: unknown;
  try {
    fields = parse(`\n${block}`, {
      maxAliasCount: 100,
      schema: "core",
      uniqueKeys: true,
    }) as unknown;
  } catch {
    return {};
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }

  const { description, title } = fields as Record<string, unknown>;
  const usableDescription = usableString(description);
  const usableTitle = usableString(title);
  return {
    ...(usableDescription ? { description: usableDescription } : {}),
    ...(usableTitle ? { title: usableTitle } : {}),
  };
}
```
Update the call site (line 110-113) to `parseFrontmatter(await readText(backend, filePath))`. Remove `errorMessage` in this file if it becomes unused.

- [ ] **Step 4: Run tests** — `pnpm vitest run test/index-middleware.test.ts test/frontmatter-validator.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: vault-aware validation scope and crash-proof index frontmatter parsing"`

---

### Task 8: Obsidian prompt config + runtime root labels

**Files:**
- Modify: `src/agent/prompt.ts` (`getOutputPromptConfig` 334-476; CLI reference block 102-116)
- Modify: `src/agent/index.ts` (`formatRuntimeRootLabel` 392-394, `formatRuntimeRootInstruction` 396-402)
- Test: `test/prompt.test.ts` (append + extend invariant loop)

**Interfaces:**
- Produces: `createSystemPrompt(command, "obsidian-vault")` — full vault-flavored prompt; `formatRuntimeRootLabel("obsidian-vault") === "Obsidian vault root"`.

- [ ] **Step 1: Write failing tests** — in `test/prompt.test.ts`:

Add `"obsidian-vault"` to the invariant loop at line 40: `for (const outputMode of ["repository", "local-wiki", "obsidian-vault"] as const)`.

Add a describe block:
```ts
describe("obsidian-vault mode", () => {
  for (const command of commands) {
    test(`${command}: roots the wiki at the Obsidian vault via virtual /`, () => {
      const prompt = createSystemPrompt(command, "obsidian-vault");

      expect(prompt).not.toMatch(/lives in ~\/\.openwiki\/wiki/);
      expect(prompt).toContain("Obsidian vault");
      expect(prompt).toContain("/quickstart.md");
      expect(prompt).toContain("/.obsidian/");
      expect(prompt).toMatch(/never revert/i);
      expect(prompt).toMatch(/\[\[wikilinks?\]\]/i);
      expect(prompt).not.toContain("/personal-logistics.md");
      expect(prompt).not.toContain("/commitments.md");
    });
  }

  test("update instructions tell the agent to integrate manual edits", () => {
    const prompt = createSystemPrompt("update", "obsidian-vault");
    expect(prompt).toContain("Manual edits since last OpenWiki run");
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/prompt.test.ts` → FAIL (obsidian-vault currently gets the repository config).

- [ ] **Step 3: Implement**

`src/agent/prompt.ts` — in `getOutputPromptConfig`, after the `local-wiki` branch and before the repository `return`, add:

```ts
  if (outputMode === "obsidian-vault") {
    return {
      canonicalLocationInstruction: `Canonical wiki location:
- The generated OpenWiki knowledge base lives in the configured Obsidian vault, which the filesystem tools expose as the virtual root /. Reference wiki files by /-rooted virtual paths such as /quickstart.md and /topics/ai-research.md.
- Never type ~, ~/.openwiki/wiki, or host paths like /Users/... into filesystem tools (ls, read_file, write_file, edit_file, glob, grep). Those host paths are only valid with shell execute, and only when an explicit instruction requires it.
- When reading the wiki to answer questions, inspect the vault root / first.`,
      docsLocation: "the configured Obsidian vault (the current virtual filesystem root /)",
      filesystemRootInstruction:
        "Filesystem tools are rooted at the Obsidian vault. Use virtual paths such as /quickstart.md, /topics/ai-research.md, and /_plan.md. Never create, edit, or delete anything under /.obsidian/. Do not create a nested /openwiki directory.",
      gitDisciplineInstruction:
        "During vault updates, do not rely on git history for the wiki root. Use the manual-edit summary in the user prompt, existing vault pages, and the vault INSTRUCTIONS.md brief as evidence.",
      initialHistoryInstruction:
        "Use file timestamps and existing note content only when directly relevant; the vault has no git history to mine.",
      initialInventoryInstruction:
        "First build a knowledge inventory: existing vault notes (all of them are human-authored and authoritative), the /INSTRUCTIONS.md brief, and the major topics the user asked OpenWiki to track.",
      localWikiSynthesisInstruction: `Obsidian vault discipline:
- This wiki is stored in a live Obsidian vault that the user reads and edits directly in Obsidian. Human edits are authoritative: incorporate manual changes into related pages, never revert them, and never recreate pages the user deleted unless the wiki brief requires it (then explain why inside the page).
- Preserve [[wikilinks]], #tags, aliases, and any unknown front matter properties in human-authored or human-edited notes. Do not rewrite [[wikilinks]] into Markdown links. Links you add yourself must be standard relative Markdown links (OKF relationship edges).
- Human notes may lack OKF front matter. Add the minimal \`type\` front matter only when substantially rewriting such a page; otherwise leave its front matter exactly as found.
- Never create, edit, or delete anything under /.obsidian/. That directory is Obsidian application state, not wiki content.
- Organize the vault as a goal-driven knowledge wiki: /quickstart.md is the navigation entrypoint, topic pages live in focused directories, and /INSTRUCTIONS.md (user-authored brief) defines scope and priorities.`,
      metadataPath: "/.last-update.json",
      planPath: "/_plan.md",
      quickstartPath: "/quickstart.md",
      removePlanCommand: "rm -f ./_plan.md",
      rootAgentInstructions:
        "Root agent instruction files:\n- Obsidian vault mode does not manage repository /AGENTS.md or /CLAUDE.md files.\n- /INSTRUCTIONS.md is the user-authored OpenWiki brief for this vault. Read it to understand scope and priorities, but do not edit it unless the user explicitly asks to change the brief.",
      searchBoundaryInstruction:
        "Do not run commands that search outside the Obsidian vault unless an explicit instruction names another path to inspect.",
      sectionDirectoryInstruction:
        "When the vault is large enough to need section directories, create one directory per major topic area, for example topics/, projects/, people/, research/, or similar names that fit the user's goals.",
      subjectLabel: "the Obsidian vault knowledge wiki",
      updateEvidenceInstruction:
        "Use the 'Manual edits since last OpenWiki run' section of the user prompt as the primary change evidence. Read each added or modified note, integrate its content into related pages, and honor deletions. Human edits are authoritative: never revert them.",
      wikiFirstAnsweringInstruction: `Wiki-first question answering:
- For ordinary chat questions, inspect the vault under the virtual root / first. Use quickstart/index pages, topic pages, and targeted grep/glob over the vault before anything else.
- If the user asks you to "look at the wiki", answer "based on the wiki", or frames the request around the vault, use only vault pages unless they cannot support the answer.`,
      writeBoundaryInstruction:
        "Do not modify files outside the Obsidian vault with filesystem tools, and never write under /.obsidian/.",
      writePathExample:
        "/... paths directly under the vault root, for example /quickstart.md or /topics/ai-research.md. Never use /openwiki/... in Obsidian vault mode.",
    };
  }
```

CLI reference block (prompt.ts:102-116) — after the `openwiki personal --init` line add:
```
- \`openwiki obsidian [--init|--update] [message]\` runs OpenWiki over the configured Obsidian vault (default ~/.openwiki/vault, override with the OPENWIKI_OBSIDIAN_VAULT environment variable). Manual edits made in Obsidian are detected and incorporated on the next run.
```

`src/agent/index.ts`:
```ts
function formatRuntimeRootLabel(outputMode: OpenWikiOutputMode): string {
  if (outputMode === "local-wiki") {
    return "Local wiki root";
  }

  return outputMode === "obsidian-vault"
    ? "Obsidian vault root"
    : "Repository root";
}
```
and in `formatRuntimeRootInstruction`, before the repository return:
```ts
  if (outputMode === "obsidian-vault") {
    return "Filesystem tools use a virtual root: / means the Obsidian vault directory above. Write wiki pages directly under /, for example /quickstart.md, /topics/ai-research.md, and /_plan.md. Never create, edit, or delete anything under /.obsidian/. Do not create a nested /openwiki directory.";
  }
```

- [ ] **Step 4: Run tests** — `pnpm vitest run test/prompt.test.ts test/prompt-okf.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: obsidian-vault prompt config with edit-respect and wikilink preservation rules"`

---

### Task 9: CLI wiring (cwd, output mode, setup, URI print)

**Files:**
- Modify: `src/cli.tsx` (`getRunModeCwd` 3940-3945, `getRunModeOutputMode` 3947-3949, setupPromise 546-549, auto-exit effect 644-665, `runPrintCommand` 3965-4005, imports near line 12)

**Interfaces:**
- Consumes: `ensureObsidianVaultSetup`, `getObsidianVaultDir`, `createObsidianVaultUri` from `./obsidian-mode.js` (Task 2); `"obsidian-vault"` output mode.
- Produces: `openwiki obsidian ...` targets the vault end to end; successful non-interactive and auto-exit interactive runs print `Open in Obsidian: obsidian://open?path=...`.

- [ ] **Step 1: Implement** (no unit test file covers cli.tsx; the gate is `pnpm typecheck` + the live verification in Task 11)

Imports (next to the `ensureCodeModeRepoSetup` import at line 12):
```ts
import {
  createObsidianVaultUri,
  ensureObsidianVaultSetup,
  getObsidianVaultDir,
} from "./obsidian-mode.js";
```

Helpers:
```ts
function getRunModeCwd(
  mode: OpenWikiRunMode,
  codeRuntimeCwd = process.cwd(),
): string {
  if (mode === "code") {
    return codeRuntimeCwd;
  }

  return mode === "obsidian" ? getObsidianVaultDir() : openWikiLocalWikiDir;
}

function getRunModeOutputMode(mode: OpenWikiRunMode): OpenWikiOutputMode {
  if (mode === "code") {
    return "repository";
  }

  return mode === "obsidian" ? "obsidian-vault" : "local-wiki";
}
```

setupPromise (546-549):
```ts
    const setupPromise =
      runMode === "code"
        ? ensureCodeModeRepoSetup(runtimeCwd)
        : runMode === "obsidian"
          ? ensureObsidianVaultSetup(runtimeCwd).then(() => undefined)
          : Promise.resolve();
```

Auto-exit effect (644-665) — in the `success` branch, print the URI for obsidian runs before exiting:
```ts
    if (runState.status === "success" && autoExitOnSuccess) {
      process.exitCode = 0;
      if (runMode === "obsidian") {
        process.stdout.write(
          `\nOpen in Obsidian: ${createObsidianVaultUri(runtimeCwd)}\n`,
        );
      }
      app.exit();
      return;
    }
```
(Add `runMode` and `runtimeCwd` to the effect dependency array.)

`runPrintCommand` — replace the code-mode setup block (3974-3976):
```ts
    if (command.mode === "code") {
      await ensureCodeModeRepoSetup(runtimeCwd);
    } else if (command.mode === "obsidian") {
      await ensureObsidianVaultSetup(runtimeCwd);
    }
```
and after the `process.stdout.write(`${text}\n`)` block (before `process.exitCode = 0;`):
```ts
    if (command.mode === "obsidian") {
      process.stdout.write(
        `\nOpen in Obsidian: ${createObsidianVaultUri(runtimeCwd)}\n`,
      );
    }
```

- [ ] **Step 2: Verify** — `pnpm typecheck` → PASS; `pnpm test` → PASS.

- [ ] **Step 3: Smoke-check parsing + vault targeting without an agent run** —
`OPENWIKI_DEV=1 OPENWIKI_OBSIDIAN_VAULT=$(mktemp -d)/vault pnpm dev obsidian --init --dry-run` → dry-run output must reference the vault path, exit 0.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: wire obsidian mode through interactive and print run paths"`

---

### Task 10: Onboarding completeness + credentials wizard

**Files:**
- Modify: `src/onboarding.ts` (`isOnboardingComplete` 169-177, `isCodeModeConfig` area 363-365, new `isObsidianVaultOnboardingCompleteSync`)
- Modify: `src/credentials.tsx` (RUN_MODE_OPTIONS 223-240, ONBOARDING_TEMPLATES 187-221, PromptStep 103-129, option consts ~369, `needsCredentialSetup` 371-394, mount effect 624-717, submit handlers ~1081-1560, `continueAfterCredentials` 1828-1861, `saveConfigForCurrentMode` 2198-2219, routing tails 3557-3624 and 3726-3765, `hydrateRunModeConfig` 3791-3803, render blocks near the code-repo ones ~2858-2898, wiki-scope row ~2419-2437)
- Test: `test/onboarding.test.ts` (append), `test/credentials.test.ts` (run, extend only if it asserts mode lists)

**Interfaces:**
- Consumes: `getObsidianVaultDir`, `ensureObsidianVaultSetup` (Task 2); `readVaultWikiInstructions`, `readVaultWikiInstructionsSync`, `saveVaultWikiInstructions` (Task 5); `OPENWIKI_OBSIDIAN_VAULT_ENV_KEY` + `saveOpenWikiEnv` (existing env.ts API).
- Produces: `isObsidianVaultOnboardingCompleteSync(vaultDir: string): boolean` (onboarding.ts); wizard flow for obsidian: credentials → `obsidian-vault-confirm` (→ optional `obsidian-vault-path`) → `wiki-goal` → complete (no template/cron/sources/final steps).

- [ ] **Step 1: Write failing tests** — append to `test/onboarding.test.ts` (follow its HOME-swap/dynamic-import conventions if present; otherwise construct configs directly since `isOnboardingComplete` is pure):

```ts
test("obsidian mode does not require an ingestion schedule", async () => {
  const { isOnboardingComplete } = await import("../src/onboarding.ts");
  expect(
    isOnboardingComplete({
      completedAt: "2026-07-18T00:00:00.000Z",
      modeId: "obsidian",
      sourceInstances: [],
      sources: {},
      version: 1,
      wikiGoal: "Track research",
    }),
  ).toBe(true);
});

test("isObsidianVaultOnboardingCompleteSync requires vault INSTRUCTIONS.md", async () => {
  // HOME-swap setup (see test/env-behavior.test.ts pattern), then:
  const onboarding = await import("../src/onboarding.ts");
  const vaultDir = path.join(tempHome, "vault");
  await mkdir(vaultDir, { recursive: true });

  await onboarding.saveOpenWikiOnboardingConfig({
    completedAt: "2026-07-18T00:00:00.000Z",
    modeId: "obsidian",
    modeName: "Obsidian",
    templateId: "obsidian",
    templateName: "Obsidian",
    sourceInstances: [],
    sources: {},
    version: 1,
  });

  expect(onboarding.isObsidianVaultOnboardingCompleteSync(vaultDir)).toBe(false);

  await onboarding.saveVaultWikiInstructions(vaultDir, "Track research");
  expect(onboarding.isObsidianVaultOnboardingCompleteSync(vaultDir)).toBe(true);
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run test/onboarding.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/onboarding.ts`**

```ts
export function isOnboardingComplete(
  config: OpenWikiOnboardingConfig,
): boolean {
  return Boolean(
    config.completedAt &&
    config.wikiGoal &&
    (isCodeModeConfig(config) ||
      isObsidianModeConfig(config) ||
      config.ingestionSchedule),
  );
}
```
next to `isCodeModeConfig`:
```ts
function isObsidianModeConfig(config: OpenWikiOnboardingConfig): boolean {
  return (config.modeId ?? config.templateId) === "obsidian";
}
```
after `isRepositoryCodeOnboardingCompleteSync`:
```ts
export function isObsidianVaultOnboardingCompleteSync(
  vaultDir: string,
): boolean {
  if (!existsSync(openWikiOnboardingPath)) {
    return false;
  }

  try {
    const config = normalizeOnboardingConfig(
      JSON.parse(readFileSync(openWikiOnboardingPath, "utf8")),
    );
    if (!isObsidianModeConfig(config)) {
      return false;
    }

    return isOnboardingComplete({
      ...config,
      wikiGoal: readVaultWikiInstructionsSync(vaultDir),
    });
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Implement `src/credentials.tsx`** (each edit is anchored; run `pnpm typecheck` after this step)

1. Imports: add `isObsidianVaultOnboardingCompleteSync`, `readVaultWikiInstructions`, `saveVaultWikiInstructions` to the `./onboarding.js` import; add `import { ensureObsidianVaultSetup, getObsidianVaultDir } from "./obsidian-mode.js";`; add `OPENWIKI_OBSIDIAN_VAULT_ENV_KEY` to the `./constants.js` import.
2. `ONBOARDING_TEMPLATES` — third entry:
```ts
  {
    description:
      "A knowledge wiki stored in an Obsidian vault. OpenWiki organizes and maintains it; you read and edit it in Obsidian, and your edits are respected on the next run.",
    id: "obsidian",
    name: "Obsidian",
    sourceIds: [],
    suggestedSources: [],
    suggestedGoal:
      "A curated knowledge wiki in my Obsidian vault. Organize durable knowledge into focused topic pages with a clear quickstart entrypoint. Treat notes I add or edit in Obsidian as authoritative: fold them into the right pages, keep navigation current, and never revert my changes.",
  },
```
3. `RUN_MODE_OPTIONS` — third entry:
```ts
  {
    description:
      "Build a knowledge wiki inside an Obsidian vault (default ~/.openwiki/vault). Two-way: your Obsidian edits are respected.",
    id: "obsidian",
    name: "Obsidian",
  },
```
4. `PromptStep` union — add `| "obsidian-vault-confirm" | "obsidian-vault-path"`.
5. Next to `CODE_REPO_OPTIONS` add `const OBSIDIAN_VAULT_OPTIONS = ["Confirm and continue", "Edit path"] as const;`
6. Component state, next to `codeRepoRoot`: `const [vaultRoot, setVaultRoot] = useState(getObsidianVaultDir());` and `const [vaultSelectionIndex, setVaultSelectionIndex] = useState(0);` (wire vaultSelectionIndex into the same up/down-arrow handling the code-repo-confirm step uses — search for `codeRepoSelectionIndex` in the input handler and mirror each occurrence for the new step).
7. `needsCredentialSetup` tail:
```ts
  if (mode === "code") {
    return !isRepositoryCodeOnboardingCompleteSync(getDefaultCodeRepoRootPath());
  }

  if (mode === "obsidian") {
    return !isObsidianVaultOnboardingCompleteSync(getObsidianVaultDir());
  }

  return !isOpenWikiOnboardingCompleteSync();
```
8. `getInitialStep` — after the `mode === "code"` check (line 3603-3605) add:
```ts
  if (mode === "obsidian" && !isOnboardingComplete(onboardingConfig)) {
    return "obsidian-vault-confirm";
  }
```
and change the cron gate (3615) to:
```ts
  if (
    !isCodeMode(onboardingConfig) &&
    !isObsidianModeSelected(onboardingConfig) &&
    !onboardingConfig.ingestionSchedule
  ) {
```
adding next to `isCodeMode` (3830-3832):
```ts
function isObsidianModeSelected(config: OpenWikiOnboardingConfig): boolean {
  return getConfigModeId(config) === "obsidian";
}
```
9. `getNextStepAfterRegion` — same two edits (after line 3744-3746 add the obsidian branch; extend the cron gate at 3756).
10. `continueAfterCredentials` — after the code branch (1831-1836) add:
```ts
    if (options.runMode === "obsidian") {
      if (!isOnboardingComplete(onboardingConfig)) {
        setVaultRoot(getObsidianVaultDir());
        setVaultSelectionIndex(0);
        setStep("obsidian-vault-confirm");
        return;
      }

      await completeSetup(options);
      return;
    }
```
11. Submit handlers — after the `code-repo-path` handler (1141-1152) add:
```ts
    if (step === "obsidian-vault-confirm") {
      const selectedOption =
        OBSIDIAN_VAULT_OPTIONS[vaultSelectionIndex] ?? OBSIDIAN_VAULT_OPTIONS[0];

      if (selectedOption === "Edit path") {
        setInput(vaultRoot);
        setStep("obsidian-vault-path");
        return;
      }

      await confirmVaultRoot(vaultRoot);
      return;
    }

    if (step === "obsidian-vault-path") {
      try {
        await confirmVaultRoot(normalizeLocalPath(input));
        setInput("");
      } catch (pathError) {
        setError(getErrorMessage(pathError));
      }
      return;
    }
```
and add the helper next to `continueAfterCodeRepoConfirmed` (1863):
```ts
  async function confirmVaultRoot(nextVaultRoot: string) {
    if (nextVaultRoot.trim().length === 0) {
      setError("Enter a vault directory.");
      return;
    }

    await ensureObsidianVaultSetup(nextVaultRoot);
    await saveOpenWikiEnv({
      [OPENWIKI_OBSIDIAN_VAULT_ENV_KEY]: nextVaultRoot,
    });
    setVaultRoot(nextVaultRoot);

    const existingGoal = await readVaultWikiInstructions(nextVaultRoot);
    if (!existingGoal || existingGoal === DEFAULT_OBSIDIAN_INSTRUCTIONS.trim()) {
      setInput(getTemplateGoal("obsidian"));
      setStep("wiki-goal");
      return;
    }

    await finishObsidianSetup();
  }

  async function finishObsidianSetup() {
    const nextConfig = {
      ...onboardingConfig,
      completedAt: new Date().toISOString(),
    };
    await saveConfigForCurrentMode(nextConfig);
    await completeSetup({
      nextApiKey: apiKey,
      nextBaseUrl: baseUrl,
      nextSecretKey: secretKey,
      nextRegion: region,
      nextGcpLocation: gcpLocation,
      nextGcpProject: gcpProject,
      nextLangSmithKey: langSmithKey,
      nextModelId: modelId,
      nextOAuthTokens: oauthTokens,
      nextProvider: provider,
      runMode: "obsidian",
    });
  }
```
(Import `DEFAULT_OBSIDIAN_INSTRUCTIONS` from `./obsidian-mode.js`. `saveOpenWikiEnv` is already imported in this file — verify, and add it if not.)
12. `wiki-goal` submit handler (1518-1543) — after the `isCodeMode(nextConfig)` block add:
```ts
      if (isObsidianModeSelected(nextConfig)) {
        await finishObsidianSetup();
        return;
      }
```
Note: `finishObsidianSetup` stamps `completedAt` on `onboardingConfig` state, which `saveConfigForCurrentMode` has just updated with the goal — to avoid a stale-state race, change `finishObsidianSetup` to accept the config: `async function finishObsidianSetup(config: OpenWikiOnboardingConfig = onboardingConfig)` and call it as `finishObsidianSetup(nextConfig)` here (and with no argument from `confirmVaultRoot`), building `nextConfig = { ...config, completedAt: ... }` inside.
13. `saveConfigForCurrentMode` (2198-2219) — insert before the code-mode branch:
```ts
    if (isObsidianModeSelected(config)) {
      setIsSaving(true);
      try {
        if (config.wikiGoal?.trim()) {
          await saveVaultWikiInstructions(vaultRoot, config.wikiGoal);
        }
        await saveOpenWikiOnboardingConfig({
          ...config,
          wikiGoal: undefined,
        });
        setOnboardingConfig(config);
      } catch (saveError) {
        onError(getErrorMessage(saveError));
      } finally {
        setIsSaving(false);
      }
      return;
    }
```
14. Mount effect (642-646) — change the home-save strip to:
```ts
          await saveOpenWikiOnboardingConfig({
            ...configForMode,
            wikiGoal:
              mode === "code" || mode === "obsidian"
                ? undefined
                : configForMode.wikiGoal,
          });
```
and in the same effect, mirror the `code-repo-confirm` initializer (695-698) with:
```ts
        if (initialStep === "obsidian-vault-confirm") {
          setVaultRoot(getObsidianVaultDir());
          setVaultSelectionIndex(0);
        }
```
15. `hydrateRunModeConfig` (3791-3803):
```ts
async function hydrateRunModeConfig(
  config: OpenWikiOnboardingConfig,
  mode: OpenWikiRunMode,
  repoRoot: string,
): Promise<OpenWikiOnboardingConfig> {
  if (mode === "code") {
    const wikiGoal = await readRepositoryWikiInstructions(repoRoot);
    return wikiGoal ? { ...config, wikiGoal } : config;
  }

  if (mode === "obsidian") {
    const wikiGoal = await readVaultWikiInstructions(getObsidianVaultDir());
    return wikiGoal ? { ...config, wikiGoal } : config;
  }

  return config;
}
```
16. Render blocks — clone the `code-repo-confirm` and `code-repo-path` JSX blocks (search `step === "code-repo-confirm"` in the render, ~2858-2898) into `step === "obsidian-vault-confirm"` / `step === "obsidian-vault-path"` variants: title "Obsidian vault", body text `Wiki vault: {vaultRoot}` with hint "OpenWiki will create the folder and seed .obsidian so Obsidian opens it as a vault.", options `OBSIDIAN_VAULT_OPTIONS` driven by `vaultSelectionIndex`; the path variant is a free-text input prefilled with `vaultRoot`. Also extend the wiki-scope SetupStep row (~2419-2437): where it renders `selectedMode === "code" ? "repository openwiki/" : ...`, add an obsidian arm rendering the vault path (`vaultRoot`).

- [ ] **Step 5: Run tests** — `pnpm vitest run test/onboarding.test.ts test/credentials.test.ts && pnpm typecheck` → PASS. If `test/credentials.test.ts` asserts the run-mode option list or step routing, update those assertions to include the obsidian entries.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: obsidian mode onboarding with vault path step and vault-resident wiki goal"`

---

### Task 11: Docs, full gates, live verification

**Files:**
- Modify: `README.md` (add an "Obsidian mode" section next to the personal/code mode docs)
- Verify: whole tree

- [ ] **Step 1: README** — add a section documenting: `openwiki obsidian [--init|--update] [message]`, the `OPENWIKI_OBSIDIAN_VAULT` env var and `~/.openwiki/vault` default, the seeded `.obsidian/` + `INSTRUCTIONS.md`, the printed `obsidian://open` URI, and the two-way contract (edits in Obsidian are detected via the file manifest and never reverted). Do NOT hand-edit `openwiki/` generated pages (CLAUDE.md rule).

- [ ] **Step 2: Full gates** — `pnpm typecheck && pnpm lint:check && pnpm test` → all PASS (run `pnpm lint` first if fixable issues appear).

- [ ] **Step 3: Live verification** (scratch vault; see spec Testing section):
1. `VAULT=$(mktemp -d)/vault`
2. Help: `pnpm dev --help | grep -A1 "openwiki obsidian"` → shows the new command.
3. Dev dry-run: `OPENWIKI_DEV=1 OPENWIKI_OBSIDIAN_VAULT=$VAULT pnpm dev obsidian --init --dry-run` → exits 0, references vault path.
4. If provider credentials are available (check `~/.openwiki/.env` / env): `OPENWIKI_OBSIDIAN_VAULT=$VAULT pnpm dev obsidian --init --print` → creates `$VAULT/.obsidian/app.json`, `$VAULT/INSTRUCTIONS.md`, wiki pages with OKF frontmatter, `$VAULT/.last-update.json` containing `vaultFileHashes`, and prints `Open in Obsidian: obsidian://open?path=...`.
5. Simulate Obsidian edits: modify a generated page, add `$VAULT/my-note.md` WITHOUT frontmatter, delete one generated page. Run `... obsidian --update --print` → run completes (index sync survives the frontmatter-less note), output/wiki reflects the edits, no reverts, updated manifest.
6. Open the printed `obsidian://` URI (or the folder) in Obsidian → vault displays.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs: document obsidian engine mode"`

---

## Self-Review Notes

- Spec coverage: CLI surface (T1), env key + vault setup + URI (T2, T9), branch-site table (T3-T9), two-way manifest + prompt injection (T4, T5, T8), `.obsidian` guard (T6), tolerant index sync + validator scope (T7), onboarding/wizard (T10), README + live tests (T11). Ingestion/scheduling intentionally untouched (spec non-goal).
- Type consistency: literals `"obsidian"` / `"obsidian-vault"`, exports `getObsidianVaultDir` / `ensureObsidianVaultSetup` / `createObsidianVaultUri` / `computeVaultFileHashes` / `diffVaultFileHashes` / `formatManualEditsSummary` / `readVaultWikiInstructions(Sync)` / `saveVaultWikiInstructions` / `isObsidianVaultOnboardingCompleteSync` / `isObsidianConfigPath` are used with the same names and signatures across tasks.
- Known judgment calls for executors: `test/index-middleware.test.ts` and `test/frontmatter-validator.test.ts` assertions must be adapted to those files' existing fixture helpers (contracts specified in Task 7); wizard JSX in Task 10 step 16 clones the adjacent code-repo blocks.
