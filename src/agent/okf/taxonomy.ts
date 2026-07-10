import type { OpenWikiOutputMode } from "../types.js";

/**
 * Target OKF spec version declared in the root index.md.
 */
export const OKF_VERSION = "0.1";

/**
 * Reserved navigation filename (OpenWiki-generated).
 */
export const OKF_INDEX_FILENAME = "index.md";

/**
 * Reserved history filename (OpenWiki-generated).
 */
export const OKF_LOG_FILENAME = "log.md";

/**
 * Filenames OKF reserves; never treated as concept documents.
 */
export const OKF_RESERVED_FILENAMES = [OKF_INDEX_FILENAME, OKF_LOG_FILENAME];

/**
 * A single output mode's documentation-type vocabulary.
 */
export interface DocTypeTaxonomy {
  /**
   * Exact root-level filename overrides, e.g. "quickstart.md" -> "Overview".
   */
  rootFiles: Record<string, string>;

  /**
   * Top-level directory overrides, e.g. "architecture" -> "Architecture".
   */
  directories: Record<string, string>;

  /**
   * Type for root-level files without an explicit override.
   */
  rootFallback: string;
}

/**
 * Repository (code) documentation taxonomy.
 */
export const REPOSITORY_TAXONOMY: DocTypeTaxonomy = {
  rootFiles: { "quickstart.md": "Repository Overview" },
  directories: {
    architecture: "Architecture",
    workflows: "Workflow",
    domain: "Domain Concept",
    "data-models": "Data Model",
    api: "API Reference",
    integrations: "Integration",
    operations: "Operations",
    testing: "Testing",
  },
  rootFallback: "Reference",
};

/**
 * Personal (local-wiki) documentation taxonomy.
 */
export const LOCAL_WIKI_TAXONOMY: DocTypeTaxonomy = {
  rootFiles: {
    "quickstart.md": "Overview",
    "open-questions.md": "Open Questions",
    "themes.md": "Themes",
    "commitments.md": "Commitments",
    "personal-logistics.md": "Personal Logistics",
  },
  directories: {
    sources: "Source",
    topics: "Topic",
    projects: "Project",
    people: "Person",
    companies: "Company",
    research: "Research",
    operations: "Operation",
  },
  rootFallback: "Note",
};

/**
 * Returns the documentation-type taxonomy for an output mode.
 */
export function getDocTypeTaxonomy(
  outputMode: OpenWikiOutputMode,
): DocTypeTaxonomy {
  return outputMode === "local-wiki"
    ? LOCAL_WIKI_TAXONOMY
    : REPOSITORY_TAXONOMY;
}

/**
 * Infers a deterministic OKF `type` from a bundle-relative path for the given
 * mode. Fallback only: code owns frontmatter, so there is never a model value to
 * override. Unmapped directories become a Title-Cased type.
 */
export function inferConceptType(
  relativePath: string,
  outputMode: OpenWikiOutputMode,
): string {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  const taxonomy = getDocTypeTaxonomy(outputMode);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length <= 1) {
    return taxonomy.rootFiles[normalized] ?? taxonomy.rootFallback;
  }

  const topDirectory = segments[0] ?? "";

  return (
    taxonomy.directories[topDirectory] ?? titleCasePathSegment(topDirectory)
  );
}

/**
 * Converts a path segment like "data-models" into a Title-Cased type.
 */
function titleCasePathSegment(segment: string): string {
  const title = segment
    .split(/[-_]/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return title.length > 0 ? title : "Reference";
}

/**
 * Renders the directory→type list for a mode's prompt so the taxonomy has a
 * single source of truth (adding a type is a one-line change here).
 */
export function describeDocTypesForPrompt(
  outputMode: OpenWikiOutputMode,
): string {
  return Object.entries(getDocTypeTaxonomy(outputMode).directories)
    .map(([directory, type]) => `${directory}/ -> ${type}`)
    .join(", ");
}
