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

  test("partial seed: keeps existing INSTRUCTIONS.md and only seeds missing config", async () => {
    const { ensureObsidianVaultSetup } = await importObsidianMode();
    const vaultDir = path.join(tempHome, "partial-vault");
    await mkdir(vaultDir, { recursive: true });
    await writeFile(
      path.join(vaultDir, "INSTRUCTIONS.md"),
      "My existing goal\n",
      "utf8",
    );

    const result = await ensureObsidianVaultSetup(vaultDir);

    expect(result).toMatchObject({
      createdVault: false,
      seededConfig: true,
      seededInstructions: false,
    });
    expect(await readFile(path.join(vaultDir, "INSTRUCTIONS.md"), "utf8")).toBe(
      "My existing goal\n",
    );
    expect(
      JSON.parse(
        await readFile(path.join(vaultDir, ".obsidian", "app.json"), "utf8"),
      ),
    ).toEqual({});
  });

  test("wraps fs errors in a friendly message when the vault path cannot be prepared", async () => {
    const { ensureObsidianVaultSetup } = await importObsidianMode();
    const blockerFile = path.join(tempHome, "blocker-file");
    await writeFile(blockerFile, "not a directory", "utf8");
    const vaultDir = path.join(blockerFile, "vault");

    await expect(ensureObsidianVaultSetup(vaultDir)).rejects.toThrow(
      /Unable to prepare the Obsidian vault/,
    );
    await expect(ensureObsidianVaultSetup(vaultDir)).rejects.toThrow(
      /OPENWIKI_OBSIDIAN_VAULT/,
    );
  });
});
