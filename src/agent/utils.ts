import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OPEN_WIKI_DIR, UPDATE_METADATA_PATH } from "../constants.js";
import {
  isExpectedSnapshotRaceError,
  isFileNotFoundError,
} from "../fs-errors.js";
import {
  readOpenWikiOnboardingConfig,
  readRepositoryWikiInstructions,
  readVaultWikiInstructions,
} from "../onboarding.js";
import type {
  OpenWikiCommand,
  OpenWikiOutputMode,
  OpenWikiRunOptions,
  RunContext,
  UpdateMetadata,
} from "./types.js";
import type { Dirent } from "node:fs";

const execFileAsync = promisify(execFile);
const LOCAL_WIKI_METADATA_PATH = ".last-update.json";

export type OpenWikiContentSnapshot = string;

export type UpdateNoopStatus =
  | {
      shouldSkip: true;
      gitHead: string;
      model: string;
    }
  | {
      shouldSkip: false;
      reason: string;
    };

/**
 * Builds the per-run context the prompt uses to reason about prior docs and git changes.
 */
export async function createRunContext(
  command: OpenWikiCommand,
  cwd: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<RunContext> {
  const lastUpdate = await readLastUpdate(cwd, outputMode);
  const wikiGoal = await readRunWikiGoal(cwd, outputMode);

  if (command === "chat") {
    return {
      lastUpdate,
      gitSummary: "Not applicable for chat.",
      wikiGoal,
    };
  }

  if (outputMode === "obsidian-vault") {
    return {
      lastUpdate,
      gitSummary: await createVaultEditSummary(command, cwd, lastUpdate),
      wikiGoal,
    };
  }

  if (outputMode === "local-wiki") {
    return {
      lastUpdate,
      gitSummary:
        "Local wiki mode: connector source evidence is provided through raw data paths and OpenWiki connector tools. Git repository diff context is not used for this run.",
      wikiGoal,
    };
  }

  return {
    lastUpdate,
    gitSummary: await createGitSummary(command, cwd, lastUpdate),
    wikiGoal,
  };
}

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

export async function getUpdateNoopStatus(
  cwd: string,
): Promise<UpdateNoopStatus> {
  const lastUpdate = await readLastUpdate(cwd, "repository");

  if (!lastUpdate?.gitHead) {
    return { shouldSkip: false, reason: "missing previous update git head" };
  }

  const head = await getGitHead(cwd);

  if (!head) {
    return { shouldSkip: false, reason: "missing current git head" };
  }

  const status = await runGit(cwd, [
    "status",
    "--short",
    "--untracked-files=all",
  ]);
  const meaningfulStatus = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !isUpdateMetadataStatusLine(line));

  if (meaningfulStatus.length > 0) {
    return { shouldSkip: false, reason: "worktree has changes" };
  }

  if (head !== lastUpdate.gitHead) {
    const committedPaths = await getChangedPathsSinceLastUpdate(
      cwd,
      lastUpdate.gitHead,
    );

    if (
      committedPaths.length === 0 ||
      committedPaths.some((changedPath) => !isOpenWikiPath(changedPath))
    ) {
      return { shouldSkip: false, reason: "git head changed" };
    }
  }

  return {
    shouldSkip: true,
    gitHead: head,
    model: lastUpdate.model,
  };
}

export function shouldCheckUpdateNoop(options: OpenWikiRunOptions): boolean {
  return !options.userMessage?.trim();
}

/**
 * Records a successful init/update run so future updates can diff from this git head.
 */
export async function writeLastUpdateMetadata(
  command: OpenWikiCommand,
  cwd: string,
  modelId: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<void> {
  const metadataFile = getMetadataFilePath(cwd, outputMode);
  const metadata: UpdateMetadata = {
    updatedAt: new Date().toISOString(),
    command,
    gitHead: outputMode === "repository" ? await getGitHead(cwd) : undefined,
    model: modelId,
    ...(outputMode === "obsidian-vault"
      ? { vaultFileHashes: await computeVaultFileHashes(cwd) }
      : {}),
  };

  await mkdir(path.dirname(metadataFile), { recursive: true });
  await writeFile(
    metadataFile,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Persists run metadata when OpenWiki content changed since the given snapshot.
 * Returns whether metadata was written. Used after both successful and failed
 * runs so already-generated content stays diffable by future updates.
 */
export async function persistRunMetadataIfChanged(
  command: OpenWikiCommand,
  cwd: string,
  modelId: string,
  outputMode: OpenWikiOutputMode,
  snapshotBefore: OpenWikiContentSnapshot | null,
): Promise<boolean> {
  if (command === "chat" || snapshotBefore === null) {
    return false;
  }

  const contentUnchanged =
    snapshotBefore === (await createOpenWikiContentSnapshot(cwd, outputMode));

  if (contentUnchanged) {
    if (outputMode !== "obsidian-vault") {
      return false;
    }

    // Even when the run wrote no wiki content (e.g. an update run that
    // correctly determined a human's manual Obsidian edits needed no agent
    // changes), the vault manifest still needs to be refreshed. Otherwise the
    // same manual edits are reported as new on every subsequent run and the
    // loop never converges.
    const [lastUpdate, currentVaultFileHashes] = await Promise.all([
      readLastUpdate(cwd, outputMode),
      computeVaultFileHashes(cwd),
    ]);

    if (
      areVaultFileHashesEqual(
        lastUpdate?.vaultFileHashes,
        currentVaultFileHashes,
      )
    ) {
      return false;
    }
  }

  await writeLastUpdateMetadata(command, cwd, modelId, outputMode);

  return true;
}

/**
 * Explicit key/value comparison (no JSON.stringify ordering assumptions).
 */
function areVaultFileHashesEqual(
  previous: Record<string, string> | undefined,
  current: Record<string, string>,
): boolean {
  if (!previous) {
    return false;
  }

  const previousKeys = Object.keys(previous);

  if (previousKeys.length !== Object.keys(current).length) {
    return false;
  }

  return previousKeys.every((key) => previous[key] === current[key]);
}

/**
 * Hashes OpenWiki content, excluding run metadata, to detect real documentation changes.
 */
export async function createOpenWikiContentSnapshot(
  cwd: string,
  outputMode: OpenWikiOutputMode = "repository",
): Promise<OpenWikiContentSnapshot> {
  const openWikiDir = getWikiContentRoot(cwd, outputMode);
  const hash = createHash("sha256");

  await addDirectoryToSnapshot(hash, openWikiDir, "");

  return hash.digest("hex");
}

/**
 * Reads prior run metadata if it exists and is structurally valid.
 */
async function readLastUpdate(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): Promise<UpdateMetadata | null> {
  const metadataFile = getMetadataFilePath(cwd, outputMode);

  try {
    const rawMetadata = await readFile(metadataFile, "utf8");
    const parsedMetadata = JSON.parse(rawMetadata) as Partial<UpdateMetadata>;

    if (
      typeof parsedMetadata.updatedAt === "string" &&
      typeof parsedMetadata.command === "string" &&
      typeof parsedMetadata.model === "string"
    ) {
      return {
        updatedAt: parsedMetadata.updatedAt,
        command: parsedMetadata.command === "init" ? "init" : "update",
        gitHead:
          typeof parsedMetadata.gitHead === "string"
            ? parsedMetadata.gitHead
            : undefined,
        model: parsedMetadata.model,
        vaultFileHashes: isStringRecord(parsedMetadata.vaultFileHashes)
          ? parsedMetadata.vaultFileHashes
          : undefined,
      };
    }

    return null;
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

/**
 * Recursively adds stable file paths and bytes to the OpenWiki content snapshot.
 */
async function addDirectoryToSnapshot(
  hash: ReturnType<typeof createHash>,
  directory: string,
  relativeDirectory: string,
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isExpectedSnapshotRaceError(error)) {
      hash.update("missing");
      return;
    }

    throw error;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);

    // Dot entries (.obsidian/, .last-update.json, .git, ...) are runtime or
    // app state, not wiki content; hashing them would make Obsidian workspace
    // churn look like documentation changes.
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\0`);
      await addDirectoryToSnapshot(hash, entryPath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileContent = await readSnapshotFile(entryPath);

    if (fileContent === null) {
      continue;
    }

    hash.update(`file:${relativePath}\0`);
    hash.update(fileContent);
    hash.update("\0");
  }
}

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

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
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

/**
 * Reads snapshot bytes while tolerating files that move mid-scan.
 */
async function readSnapshotFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isExpectedSnapshotRaceError(error)) {
      return null;
    }

    throw error;
  }
}

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

/**
 * Produces the git evidence block passed to init/update prompts.
 */
async function createGitSummary(
  command: OpenWikiCommand,
  cwd: string,
  lastUpdate: UpdateMetadata | null,
): Promise<string> {
  const sections: string[] = [];
  const status = await runGit(cwd, ["status", "--short"]);
  const head = await getGitHead(cwd);

  sections.push(formatGitSection("git status --short", status));
  sections.push(formatGitSection("git rev-parse HEAD", head ?? "(unknown)"));

  if (command === "update" && lastUpdate?.gitHead) {
    const logSinceLastHead = await runGit(cwd, [
      "log",
      `${lastUpdate.gitHead}..HEAD`,
      "--name-status",
      "--oneline",
    ]);

    sections.push(
      formatGitSection(
        `git log ${lastUpdate.gitHead}..HEAD --name-status --oneline`,
        logSinceLastHead,
      ),
    );
  } else if (command === "update" && lastUpdate?.updatedAt) {
    const logSinceLastUpdate = await runGit(cwd, [
      "log",
      "--since",
      lastUpdate.updatedAt,
      "--name-status",
      "--oneline",
    ]);

    sections.push(
      formatGitSection(
        `git log --since ${lastUpdate.updatedAt} --name-status --oneline`,
        logSinceLastUpdate,
      ),
    );
  } else {
    const recentLog = await runGit(cwd, [
      "log",
      "--max-count=20",
      "--name-status",
      "--oneline",
    ]);

    if (command === "update") {
      sections.push("No prior OpenWiki update timestamp was found.");
    }

    sections.push(
      formatGitSection(
        "git log --max-count=20 --name-status --oneline",
        recentLog,
      ),
    );
  }

  const diff = await runGit(cwd, ["diff", "--name-status", "HEAD"]);
  sections.push(formatGitSection("git diff --name-status HEAD", diff));

  return sections.join("\n\n");
}

async function getGitHead(cwd: string): Promise<string | undefined> {
  const head = await runGit(cwd, ["rev-parse", "HEAD"]);

  return head.length > 0 ? head : undefined;
}

/**
 * Runs git commands without failing the whole run for normal git command errors.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["--no-pager", ...args],
      {
        cwd,
        maxBuffer: 1024 * 1024,
      },
    );

    return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  } catch (error) {
    if (isExecError(error)) {
      return [error.stdout?.trim(), error.stderr?.trim()]
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    throw error;
  }
}

function formatGitSection(command: string, output: string): string {
  return [`$ ${command}`, output.length > 0 ? output : "(no output)"].join(
    "\n",
  );
}

function isUpdateMetadataStatusLine(line: string): boolean {
  const statusPath = line.length > 3 ? line.slice(3).trim() : line.trim();
  const normalizedPath = statusPath.replace(/\\/gu, "/");

  return (
    normalizedPath === UPDATE_METADATA_PATH ||
    normalizedPath.endsWith(` -> ${UPDATE_METADATA_PATH}`)
  );
}

async function getChangedPathsSinceLastUpdate(
  cwd: string,
  gitHead: string,
): Promise<string[]> {
  const diff = await runGit(cwd, ["diff", "--name-only", `${gitHead}..HEAD`]);

  return diff
    .split("\n")
    .map((line) => normalizeGitPath(line))
    .filter(Boolean);
}

function isOpenWikiPath(changedPath: string): boolean {
  return (
    changedPath === OPEN_WIKI_DIR || changedPath.startsWith(`${OPEN_WIKI_DIR}/`)
  );
}

function normalizeGitPath(value: string): string {
  return value.trim().replace(/\\/gu, "/");
}

function isExecError(
  error: unknown,
): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
