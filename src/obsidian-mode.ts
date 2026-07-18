import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPENWIKI_OBSIDIAN_VAULT_ENV_KEY } from "./constants.js";
import { isFileExistsError } from "./fs-errors.js";
import { expandHomePath } from "./utils.js";

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
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to prepare the Obsidian vault at ${vaultDir}. Set ${OPENWIKI_OBSIDIAN_VAULT_ENV_KEY} to a writable directory. (${message})`,
      { cause: error },
    );
  }
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
