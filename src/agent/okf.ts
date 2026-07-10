import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  OKF_RESERVED_FILENAMES,
  OKF_VERSION,
  inferConceptType,
} from "../constants.js";
import {
  isExpectedSnapshotRaceError,
  isFileNotFoundError,
} from "../fs-errors.js";
import { getWikiContentRoot } from "./utils.js";
import type { OpenWikiCommand, OpenWikiOutputMode } from "./types.js";
import type { Dirent } from "node:fs";

/**
 * The deterministic Open Knowledge Format (OKF) pass.
 *
 * OpenWiki content is authored by the model, which cannot be relied on to emit
 * conformant frontmatter, reserved files, or a version declaration. This module
 * runs after the agent finishes and *produces* OKF v0.1 conformance over the
 * finished tree: it repairs concept frontmatter (never clobbering model-authored
 * values), generates the reserved `index.md`/`log.md`, and keeps everything
 * byte-idempotent so a no-op run leaves the bundle unchanged.
 */

export type Frontmatter = Record<string, unknown>;

export type ParsedDocument = {
  data: Frontmatter;
  body: string;
};

export type NormalizeOkfBundleOptions = {
  cwd: string;
  outputMode: OpenWikiOutputMode;
  command: OpenWikiCommand;
  /** Per-concept body hashes captured before the agent ran (relPath -> sha256). */
  beforeBodyHashes: Map<string, string>;
  model: string;
  /** Injectable clock for deterministic tests. */
  now?: Date;
};

export type OkfFinding = {
  level: "error" | "warning";
  code: string;
  file: string;
  message: string;
};

type ConceptSummary = {
  relativePath: string;
  type: string;
  title: string;
  description: string | undefined;
};

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/u;

/**
 * Frontmatter keys are always serialized in this order so that re-serializing an
 * unchanged concept produces byte-identical output. Any extra keys the model
 * added are preserved and appended after these, in their existing order.
 */
const FRONTMATTER_KEY_ORDER = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "timestamp",
];

const RESERVED_INDEX = "index.md";
const RESERVED_LOG = "log.md";

/**
 * Splits a leading `---\n...\n---` frontmatter block from the markdown body.
 * Uses `yaml.parse` (safe by default: no custom tags, no code execution). A
 * frontmatter block that fails to parse is discarded so the pass can rebuild a
 * conformant one; the body is preserved.
 */
export function parseFrontmatter(raw: string): ParsedDocument {
  const match = FRONTMATTER_PATTERN.exec(raw);

  if (!match) {
    return { data: {}, body: raw };
  }

  const body = raw.slice(match[0].length);

  try {
    const parsed = parseYaml(match[1] ?? "") as unknown;

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return { data: parsed as Frontmatter, body };
    }
  } catch {
    // Fall through: malformed frontmatter is treated as absent.
  }

  return { data: {}, body };
}

/**
 * Serializes frontmatter + body with a stable key order and exactly one blank
 * line between the two, ensuring a trailing newline. Deterministic for a given
 * input, which is what keeps the pass idempotent.
 */
export function serializeFrontmatter(data: Frontmatter, body: string): string {
  const ordered: Frontmatter = {};

  for (const key of FRONTMATTER_KEY_ORDER) {
    if (data[key] !== undefined) {
      ordered[key] = data[key];
    }
  }

  for (const key of Object.keys(data)) {
    if (!FRONTMATTER_KEY_ORDER.includes(key) && data[key] !== undefined) {
      ordered[key] = data[key];
    }
  }

  const yaml = stringifyYaml(ordered).trimEnd();

  return `---\n${yaml}\n---\n\n${ensureTrailingNewline(stripLeadingBlankLines(body))}`;
}

/**
 * Normalizes the finished bundle into conformant OKF v0.1. Safe to run on every
 * init/update; idempotent when nothing changed.
 */
export async function normalizeOkfBundle(
  options: NormalizeOkfBundleOptions,
): Promise<void> {
  const { cwd, outputMode, command, beforeBodyHashes, model } = options;
  const root = getWikiContentRoot(cwd, outputMode);
  const timestamp = (options.now ?? new Date()).toISOString();

  const markdownFiles = await collectMarkdownFiles(root);
  const concepts: ConceptSummary[] = [];
  let changedCount = 0;

  for (const relativePath of markdownFiles) {
    if (isReservedFile(relativePath)) {
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    const raw = await readFileOrNull(absolutePath);

    if (raw === null) {
      continue;
    }

    const { data, body } = parseFrontmatter(raw);
    const bodyChanged = beforeBodyHashes.get(relativePath) !== hashBody(body);
    const normalized: Frontmatter = { ...data };

    // Reserved for the root index.md; a concept must never carry it.
    delete normalized.okf_version;

    if (!isNonEmptyString(normalized.type)) {
      normalized.type = inferConceptType(relativePath, outputMode);
    }

    if (!isNonEmptyString(normalized.title)) {
      normalized.title = deriveTitle(body, path.basename(relativePath));
    }

    if (bodyChanged || !isNonEmptyString(normalized.timestamp)) {
      normalized.timestamp = timestamp;
    }

    const nextContent = serializeFrontmatter(normalized, body);

    if (await writeIfDifferent(absolutePath, raw, nextContent)) {
      changedCount += 1;
    }

    concepts.push({
      relativePath,
      type: String(normalized.type),
      title: String(normalized.title),
      description: isNonEmptyString(normalized.description)
        ? normalized.description
        : undefined,
    });
  }

  await stripNonRootIndexFrontmatter(root, markdownFiles);

  const rootIndexPath = path.join(root, RESERVED_INDEX);
  const rootIndexBefore = await readFileOrNull(rootIndexPath);

  if (
    await writeIfDifferent(rootIndexPath, rootIndexBefore, renderRootIndex(concepts))
  ) {
    changedCount += 1;
  }

  if (command === "init" || changedCount > 0) {
    await appendLogEntry(path.join(root, RESERVED_LOG), {
      date: timestamp.slice(0, 10),
      command,
      changedCount,
      model,
    });
  }
}

/**
 * Captures per-concept body hashes before the agent runs, so the normalize pass
 * can bump `timestamp` only for concepts whose body actually changed. Works in
 * both output modes (no git required).
 */
export async function createConceptBodyHashes(
  cwd: string,
  outputMode: OpenWikiOutputMode,
): Promise<Map<string, string>> {
  const root = getWikiContentRoot(cwd, outputMode);
  const markdownFiles = await collectMarkdownFiles(root);
  const hashes = new Map<string, string>();

  for (const relativePath of markdownFiles) {
    if (isReservedFile(relativePath)) {
      continue;
    }

    const raw = await readFileOrNull(path.join(root, relativePath));

    if (raw === null) {
      continue;
    }

    hashes.set(relativePath, hashBody(parseFrontmatter(raw).body));
  }

  return hashes;
}

/**
 * Checks a bundle against OKF v0.1 conformance. Returns errors (format
 * violations) and warnings (legal but low-quality). Used by tests; there is no
 * shipped CLI in v1.
 */
export async function validateBundle(root: string): Promise<OkfFinding[]> {
  const findings: OkfFinding[] = [];
  const markdownFiles = await collectMarkdownFiles(root);
  const validTargets = new Set(markdownFiles.map((file) => `/${file}`));

  for (const relativePath of markdownFiles) {
    const raw = await readFileOrNull(path.join(root, relativePath));

    if (raw === null) {
      continue;
    }

    const basename = path.basename(relativePath);

    if (basename === RESERVED_INDEX) {
      validateIndexFile(relativePath, raw, findings);
      continue;
    }

    if (basename === RESERVED_LOG) {
      validateLogFile(relativePath, raw, findings);
      continue;
    }

    validateConceptFile(relativePath, raw, validTargets, findings);
  }

  return findings;
}

function validateIndexFile(
  relativePath: string,
  raw: string,
  findings: OkfFinding[],
): void {
  const hasFrontmatter = FRONTMATTER_PATTERN.test(raw);

  if (relativePath === RESERVED_INDEX) {
    const { data } = parseFrontmatter(raw);

    if (!isNonEmptyString(data.okf_version)) {
      findings.push({
        level: "error",
        code: "root-index-version",
        file: relativePath,
        message: "root index.md must declare okf_version",
      });
    }

    const extraKeys = Object.keys(data).filter((key) => key !== "okf_version");

    if (extraKeys.length > 0) {
      findings.push({
        level: "error",
        code: "index-frontmatter",
        file: relativePath,
        message: `root index.md has unexpected frontmatter keys: ${extraKeys.join(", ")}`,
      });
    }

    return;
  }

  if (hasFrontmatter) {
    findings.push({
      level: "error",
      code: "index-frontmatter",
      file: relativePath,
      message: "non-root index.md must not have frontmatter",
    });
  }
}

function validateLogFile(
  relativePath: string,
  raw: string,
  findings: OkfFinding[],
): void {
  const headings = raw.match(/^##\s+(.+)$/gmu) ?? [];

  for (const heading of headings) {
    const date = heading.replace(/^##\s+/u, "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      findings.push({
        level: "error",
        code: "log-date",
        file: relativePath,
        message: `log.md heading is not an ISO date: ${date}`,
      });
    }
  }
}

function validateConceptFile(
  relativePath: string,
  raw: string,
  validTargets: Set<string>,
  findings: OkfFinding[],
): void {
  const { data, body } = parseFrontmatter(raw);

  if (!FRONTMATTER_PATTERN.test(raw)) {
    findings.push({
      level: "error",
      code: "missing-frontmatter",
      file: relativePath,
      message: "concept has no frontmatter block",
    });
  }

  if (!isNonEmptyString(data.type)) {
    findings.push({
      level: "error",
      code: "missing-type",
      file: relativePath,
      message: "concept is missing a non-empty type",
    });
  }

  if (!isNonEmptyString(data.description)) {
    findings.push({
      level: "warning",
      code: "missing-description",
      file: relativePath,
      message: "concept is missing a description",
    });
  }

  for (const target of extractMarkdownLinkTargets(body, relativePath)) {
    if (!validTargets.has(target)) {
      findings.push({
        level: "warning",
        code: "broken-link",
        file: relativePath,
        message: `link target not found: ${target}`,
      });
    }
  }
}

function renderRootIndex(concepts: ConceptSummary[]): string {
  const byType = new Map<string, ConceptSummary[]>();

  for (const concept of concepts) {
    const group = byType.get(concept.type) ?? [];

    group.push(concept);
    byType.set(concept.type, group);
  }

  const sections: string[] = [];

  for (const type of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
    const group = (byType.get(type) ?? []).sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    );

    const lines = group.map((concept) => {
      const link = `- [${concept.title}](/${concept.relativePath})`;

      return concept.description ? `${link} — ${concept.description}` : link;
    });

    sections.push(`## ${type}\n${lines.join("\n")}`);
  }

  const frontmatter = stringifyYaml({ okf_version: OKF_VERSION }).trimEnd();
  const body =
    sections.length > 0
      ? sections.join("\n\n")
      : "No concepts have been documented yet.";

  return `---\n${frontmatter}\n---\n\n# Index\n\n${ensureTrailingNewline(body)}`;
}

async function stripNonRootIndexFrontmatter(
  root: string,
  markdownFiles: string[],
): Promise<void> {
  for (const relativePath of markdownFiles) {
    if (
      path.basename(relativePath) !== RESERVED_INDEX ||
      relativePath === RESERVED_INDEX
    ) {
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    const raw = await readFileOrNull(absolutePath);

    if (raw === null) {
      continue;
    }

    const { body } = parseFrontmatter(raw);
    const stripped = ensureTrailingNewline(stripLeadingBlankLines(body));

    await writeIfDifferent(absolutePath, raw, stripped);
  }
}

type LogEntry = {
  date: string;
  command: OpenWikiCommand;
  changedCount: number;
  model: string;
};

async function appendLogEntry(
  logPath: string,
  entry: LogEntry,
): Promise<void> {
  const existing = (await readFileOrNull(logPath)) ?? "# Log\n";
  const noun = entry.changedCount === 1 ? "file" : "files";
  const line = `- **${entry.command}** — ${entry.changedCount} ${noun} updated. Model: ${entry.model}.`;
  const heading = `## ${entry.date}`;
  const base = existing.trimEnd();
  const next = base.includes(`\n${heading}\n`)
    ? `${base}\n${line}\n`
    : `${base}\n\n${heading}\n${line}\n`;

  await writeFile(logPath, next, "utf8");
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  await walkMarkdown(root, "", results);

  return results.sort((a, b) => a.localeCompare(b));
}

async function walkMarkdown(
  directory: string,
  relativeDirectory: string,
  results: string[],
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isExpectedSnapshotRaceError(error) || isFileNotFoundError(error)) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      await walkMarkdown(absolutePath, relativePath, results);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relativePath);
    }
  }
}

async function writeIfDifferent(
  absolutePath: string,
  previous: string | null,
  next: string,
): Promise<boolean> {
  if (previous === next) {
    return false;
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, next, "utf8");

  return true;
}

async function readFileOrNull(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error) || isExpectedSnapshotRaceError(error)) {
      return null;
    }

    throw error;
  }
}

function isReservedFile(relativePath: string): boolean {
  const basename = path.basename(relativePath);

  return (OKF_RESERVED_FILENAMES as readonly string[]).includes(basename);
}

function deriveTitle(body: string, filename: string): string {
  const headingMatch = /^#\s+(.+?)\s*$/mu.exec(body);

  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }

  return titleFromFilename(filename);
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/u, "");
  const title = base
    .split(/[-_]/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return title.length > 0 ? title : base;
}

/**
 * Extracts bundle-absolute markdown link targets (`/...md`) from a body,
 * resolving relative links against the linking file's directory. Anchors,
 * external URLs, and non-markdown targets are ignored.
 */
function extractMarkdownLinkTargets(
  body: string,
  fromRelativePath: string,
): string[] {
  const targets: string[] = [];
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(body)) !== null) {
    const href = (match[1] ?? "").split(/[#\s]/u)[0] ?? "";

    if (href.length === 0 || /^[a-z]+:/iu.test(href) || !href.endsWith(".md")) {
      continue;
    }

    if (href.startsWith("/")) {
      targets.push(href);
      continue;
    }

    const fromDirectory = path.posix.dirname(`/${fromRelativePath}`);

    targets.push(path.posix.normalize(path.posix.join(fromDirectory, href)));
  }

  return targets;
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripLeadingBlankLines(body: string): string {
  return body.replace(/^\n+/u, "");
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
