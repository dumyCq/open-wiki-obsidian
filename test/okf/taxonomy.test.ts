import { describe, expect, test } from "vitest";
import {
  LOCAL_WIKI_TAXONOMY,
  OKF_RESERVED_FILENAMES,
  OKF_VERSION,
  REPOSITORY_TAXONOMY,
  describeDocTypesForPrompt,
  inferConceptType,
} from "../../src/agent/okf/taxonomy.ts";

describe("inferConceptType (repository)", () => {
  test("maps root overview and root fallback", () => {
    expect(inferConceptType("quickstart.md", "repository")).toBe(
      "Repository Overview",
    );
    expect(inferConceptType("notes.md", "repository")).toBe("Reference");
  });

  test("maps known directories and title-cases unmapped ones", () => {
    expect(inferConceptType("architecture/overview.md", "repository")).toBe(
      "Architecture",
    );
    expect(inferConceptType("data-models/user.md", "repository")).toBe(
      "Data Model",
    );
    expect(inferConceptType("security/auth.md", "repository")).toBe("Security");
  });

  test("normalizes leading slashes and backslashes, keys on the top directory", () => {
    expect(inferConceptType("/architecture/overview.md", "repository")).toBe(
      "Architecture",
    );
    expect(inferConceptType("architecture\\sub\\deep.md", "repository")).toBe(
      "Architecture",
    );
  });
});

describe("inferConceptType (local-wiki)", () => {
  test("maps personal root canonical files and fallback", () => {
    expect(inferConceptType("quickstart.md", "local-wiki")).toBe("Overview");
    expect(inferConceptType("open-questions.md", "local-wiki")).toBe(
      "Open Questions",
    );
    expect(inferConceptType("themes.md", "local-wiki")).toBe("Themes");
    expect(inferConceptType("misc.md", "local-wiki")).toBe("Note");
  });

  test("maps personal directories", () => {
    expect(inferConceptType("sources/gmail.md", "local-wiki")).toBe("Source");
    expect(inferConceptType("people/jane.md", "local-wiki")).toBe("Person");
  });
});

describe("describeDocTypesForPrompt", () => {
  test("renders each mode's directories as 'dir/ -> Type'", () => {
    const repository = describeDocTypesForPrompt("repository");
    for (const [directory, type] of Object.entries(
      REPOSITORY_TAXONOMY.directories,
    )) {
      expect(repository).toContain(`${directory}/ -> ${type}`);
    }

    const personal = describeDocTypesForPrompt("local-wiki");
    for (const [directory, type] of Object.entries(
      LOCAL_WIKI_TAXONOMY.directories,
    )) {
      expect(personal).toContain(`${directory}/ -> ${type}`);
    }
  });
});

describe("taxonomy constants", () => {
  test("OKF_VERSION is 0.1 and reserves index.md/log.md", () => {
    expect(OKF_VERSION).toBe("0.1");
    expect([...OKF_RESERVED_FILENAMES]).toEqual(["index.md", "log.md"]);
  });
});
