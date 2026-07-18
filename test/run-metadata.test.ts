import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createOpenWikiContentSnapshot,
  createRunContext,
  persistRunMetadataIfChanged,
  writeLastUpdateMetadata,
} from "../src/agent/utils.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempRepo(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "openwiki-run-metadata-"));
}

async function readMetadata(
  cwd: string,
  metadataPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(path.join(cwd, metadataPath), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("persistRunMetadataIfChanged", () => {
  test("writes metadata when wiki content changed since the snapshot", async () => {
    const cwd = await createTempRepo();
    const snapshotBefore = await createOpenWikiContentSnapshot(
      cwd,
      "repository",
    );

    await mkdir(path.join(cwd, "openwiki"), { recursive: true });
    await writeFile(path.join(cwd, "openwiki", "index.md"), "# Docs\n", "utf8");

    const written = await persistRunMetadataIfChanged(
      "init",
      cwd,
      "test-model",
      "repository",
      snapshotBefore,
    );

    expect(written).toBe(true);
    const metadata = await readMetadata(cwd, "openwiki/.last-update.json");
    expect(metadata).not.toBeNull();
    expect(metadata?.command).toBe("init");
    expect(metadata?.model).toBe("test-model");
  });

  test("writes metadata in local-wiki mode when content changed", async () => {
    const cwd = await createTempRepo();
    const snapshotBefore = await createOpenWikiContentSnapshot(
      cwd,
      "local-wiki",
    );

    await writeFile(path.join(cwd, "index.md"), "# Wiki\n", "utf8");

    const written = await persistRunMetadataIfChanged(
      "update",
      cwd,
      "test-model",
      "local-wiki",
      snapshotBefore,
    );

    expect(written).toBe(true);
    expect(await readMetadata(cwd, ".last-update.json")).not.toBeNull();
  });

  test("skips when wiki content is unchanged", async () => {
    const cwd = await createTempRepo();
    const snapshotBefore = await createOpenWikiContentSnapshot(
      cwd,
      "repository",
    );

    const written = await persistRunMetadataIfChanged(
      "update",
      cwd,
      "test-model",
      "repository",
      snapshotBefore,
    );

    expect(written).toBe(false);
    expect(await readMetadata(cwd, "openwiki/.last-update.json")).toBeNull();
  });

  test("skips for chat runs", async () => {
    const cwd = await createTempRepo();

    const written = await persistRunMetadataIfChanged(
      "chat",
      cwd,
      "test-model",
      "repository",
      null,
    );

    expect(written).toBe(false);
    expect(await readMetadata(cwd, "openwiki/.last-update.json")).toBeNull();
  });
});

describe("obsidian-vault metadata", () => {
  test("obsidian-vault metadata records and re-reads vaultFileHashes", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-meta-"));
    tempDirs.push(vault);
    await writeFile(path.join(vault, "quickstart.md"), "---\ntype: Guide\n---\n");

    await writeLastUpdateMetadata("update", vault, "test-model", "obsidian-vault");

    const context = await createRunContext("update", vault, "obsidian-vault");
    expect(context.lastUpdate).not.toBeNull();
    expect(context.lastUpdate?.vaultFileHashes).toBeDefined();
    expect(Object.keys(context.lastUpdate?.vaultFileHashes ?? {})).toEqual([
      "quickstart.md",
    ]);

    const hashes = context.lastUpdate?.vaultFileHashes;
    expect(hashes?.["quickstart.md"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("consumes vault manifest drift on no-write update runs so manual edits converge", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-noop-"));
    tempDirs.push(vault);
    const notePath = path.join(vault, "quickstart.md");
    await writeFile(notePath, "original content\n", "utf8");

    await writeLastUpdateMetadata("update", vault, "m", "obsidian-vault");

    // Human edits the note in Obsidian between runs.
    await writeFile(notePath, "edited by hand\n", "utf8");

    // The snapshot a run starting now would take (agent then writes nothing).
    const snapshotBefore = await createOpenWikiContentSnapshot(
      vault,
      "obsidian-vault",
    );

    const written = await persistRunMetadataIfChanged(
      "update",
      vault,
      "m",
      "obsidian-vault",
      snapshotBefore,
    );

    expect(written).toBe(true);
    const metadata = await readMetadata(vault, ".last-update.json");
    const vaultFileHashes = metadata?.vaultFileHashes as
      | Record<string, string>
      | undefined;
    expect(vaultFileHashes?.["quickstart.md"]).toBe(
      createHash("sha256").update("edited by hand\n").digest("hex"),
    );
  });

  test("skips the no-write update run when the vault manifest already matches", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "openwiki-vault-noop-"));
    tempDirs.push(vault);
    await writeFile(
      path.join(vault, "quickstart.md"),
      "stable content\n",
      "utf8",
    );

    await writeLastUpdateMetadata("update", vault, "m", "obsidian-vault");

    const snapshotBefore = await createOpenWikiContentSnapshot(
      vault,
      "obsidian-vault",
    );

    const written = await persistRunMetadataIfChanged(
      "update",
      vault,
      "m",
      "obsidian-vault",
      snapshotBefore,
    );

    expect(written).toBe(false);
  });
});
