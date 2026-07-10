import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inferConceptType } from "../src/constants.ts";
import {
  createConceptBodyHashes,
  normalizeOkfBundle,
  parseFrontmatter,
  serializeFrontmatter,
  validateBundle,
} from "../src/agent/okf.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "openwiki-okf-"));
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpRoot, { recursive: true, force: true });
});

const FIXED_NOW = new Date("2026-07-09T18:50:00.000Z");

async function writeFixtureFile(
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(tmpRoot, "openwiki", relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function readWiki(relativePath: string): Promise<string> {
  return readFile(path.join(tmpRoot, "openwiki", relativePath), "utf8");
}

async function readTree(root: string): Promise<Record<string, string>> {
  const { readdir } = await import("node:fs/promises");
  const files: Record<string, string> = {};

  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, next);
      } else {
        files[next] = await readFile(abs, "utf8");
      }
    }
  }

  await walk(root, "");
  return files;
}

async function normalize(
  command: "init" | "update",
  now: Date = FIXED_NOW,
): Promise<void> {
  const beforeBodyHashes = await createConceptBodyHashes(
    tmpRoot,
    "repository",
  );
  await normalizeOkfBundle({
    cwd: tmpRoot,
    outputMode: "repository",
    command,
    beforeBodyHashes,
    model: "test-model",
    now,
  });
}

describe("frontmatter parse/serialize", () => {
  test("round-trips data and is a serialization fixed point", () => {
    const data = {
      type: "Domain Concept",
      title: "Orders",
      description: "Lifecycle of an order.",
      tags: ["orders", "domain"],
    };
    const body = "# Orders\n\nAn order moves through states.\n";
    const serialized = serializeFrontmatter(data, body);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data).toEqual(data);
    // Re-serializing a parsed document yields identical bytes; this fixed-point
    // property is what makes the normalize pass idempotent.
    expect(serializeFrontmatter(parsed.data, parsed.body)).toBe(serialized);
  });

  test("serializes keys in the fixed order regardless of input order", () => {
    const output = serializeFrontmatter(
      {
        timestamp: "2026-07-09T18:50:00.000Z",
        extra: "kept",
        title: "T",
        type: "Overview",
      },
      "# T\n",
    );

    const keyLines = output
      .split("\n---")[0]
      .split("\n")
      .filter((line) => /^[a-z_]+:/u.test(line))
      .map((line) => line.split(":")[0]);

    expect(keyLines).toEqual(["type", "title", "timestamp", "extra"]);
  });

  test("treats a file without frontmatter as all body", () => {
    const parsed = parseFrontmatter("# Just a heading\n\nBody.\n");

    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("# Just a heading\n\nBody.\n");
  });
});

describe("inferConceptType", () => {
  test("maps repository sections and root files", () => {
    expect(inferConceptType("quickstart.md", "repository")).toBe("Overview");
    expect(inferConceptType("architecture/overview.md", "repository")).toBe(
      "Architecture",
    );
    expect(inferConceptType("domain/orders.md", "repository")).toBe(
      "Domain Concept",
    );
    expect(inferConceptType("security/auth.md", "repository")).toBe("Security");
    expect(inferConceptType("notes.md", "repository")).toBe("Reference");
  });

  test("maps local-wiki sections and root files", () => {
    expect(inferConceptType("open-questions.md", "local-wiki")).toBe(
      "Open Questions",
    );
    expect(inferConceptType("sources/gmail.md", "local-wiki")).toBe("Source");
    expect(inferConceptType("people/jane.md", "local-wiki")).toBe("Person");
  });
});

describe("normalizeOkfBundle", () => {
  test("fills missing type/title, merges without clobbering, generates reserved files", async () => {
    await writeFixtureFile("quickstart.md", "# Orders Service\n\nOverview.\n");
    await writeFixtureFile(
      "architecture/overview.md",
      "---\ntitle: Architecture overview\ndescription: How it is wired.\n---\n# Architecture overview\n\nExpress app.\n",
    );
    await writeFixtureFile(
      "domain/orders.md",
      "---\ntype: Domain Concept\ntitle: Orders\ndescription: Order lifecycle.\ntags: [orders]\n---\n# Orders\n\nStates.\n",
    );

    await normalize("init");

    // quickstart: type inferred (Overview), title from heading, no fabricated description
    const quickstart = parseFrontmatter(await readWiki("quickstart.md"));
    expect(quickstart.data.type).toBe("Overview");
    expect(quickstart.data.title).toBe("Orders Service");
    expect(quickstart.data.description).toBeUndefined();
    expect(quickstart.data.timestamp).toBe(FIXED_NOW.toISOString());

    // architecture: model title/description preserved, type filled from directory
    const architecture = parseFrontmatter(await readWiki("architecture/overview.md"));
    expect(architecture.data.type).toBe("Architecture");
    expect(architecture.data.title).toBe("Architecture overview");
    expect(architecture.data.description).toBe("How it is wired.");

    // domain: model-supplied type is not overridden
    const domain = parseFrontmatter(await readWiki("domain/orders.md"));
    expect(domain.data.type).toBe("Domain Concept");
    expect(domain.data.tags).toEqual(["orders"]);

    // root index.md with okf_version + grouped links, no errors
    const index = await readWiki("index.md");
    expect(index).toContain('okf_version: "0.1"');
    expect(index).toContain("## Architecture");
    expect(index).toContain("[Orders](/domain/orders.md)");

    // log.md with ISO-dated init entry
    const log = await readWiki("log.md");
    expect(log).toContain("## 2026-07-09");
    expect(log).toContain("**init**");

    const findings = await validateBundle(path.join(tmpRoot, "openwiki"));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
  });

  test("strips okf_version from concepts and frontmatter from non-root index.md", async () => {
    await writeFixtureFile(
      "quickstart.md",
      '---\ntype: Overview\ntitle: Q\nokf_version: "0.1"\n---\n# Q\n\nBody.\n',
    );
    await writeFixtureFile(
      "domain/index.md",
      "---\ntype: Section\n---\n# Domain\n\n- listing\n",
    );

    await normalize("init");

    const quickstart = parseFrontmatter(await readWiki("quickstart.md"));
    expect(quickstart.data.okf_version).toBeUndefined();

    const domainIndex = await readWiki("domain/index.md");
    expect(domainIndex.startsWith("---")).toBe(false);
    expect(domainIndex).toContain("# Domain");
  });

  test("is byte-idempotent on an unchanged tree", async () => {
    await writeFixtureFile("quickstart.md", "# Home\n\nOverview.\n");
    await writeFixtureFile(
      "domain/orders.md",
      "---\ntype: Domain Concept\ntitle: Orders\ndescription: Lifecycle.\n---\n# Orders\n\nStates.\n",
    );

    await normalize("init");
    const first = await readTree(path.join(tmpRoot, "openwiki"));

    // A later clock must not matter: nothing changed, so nothing is rewritten.
    await normalize("update", new Date("2026-08-01T00:00:00.000Z"));
    const second = await readTree(path.join(tmpRoot, "openwiki"));

    expect(second).toEqual(first);
    expect(parseFrontmatter(second["domain/orders.md"]).data.timestamp).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  test("bumps timestamp only for concepts whose body changed", async () => {
    await writeFixtureFile("quickstart.md", "# Home\n\nOverview.\n");
    await writeFixtureFile(
      "domain/orders.md",
      "---\ntype: Domain Concept\ntitle: Orders\ndescription: Lifecycle.\n---\n# Orders\n\nOld body.\n",
    );
    await normalize("init");

    // Capture the pre-edit body hashes (as index.ts does before the agent runs),
    // then edit one concept body and leave the other untouched.
    const beforeBodyHashes = await createConceptBodyHashes(tmpRoot, "repository");
    const orders = parseFrontmatter(await readWiki("domain/orders.md"));
    await writeFixtureFile(
      "domain/orders.md",
      serializeFrontmatter(orders.data, "# Orders\n\nNew body.\n"),
    );

    const laterNow = new Date("2026-08-01T00:00:00.000Z");
    await normalizeOkfBundle({
      cwd: tmpRoot,
      outputMode: "repository",
      command: "update",
      beforeBodyHashes,
      model: "test-model",
      now: laterNow,
    });

    expect(parseFrontmatter(await readWiki("domain/orders.md")).data.timestamp).toBe(
      laterNow.toISOString(),
    );
    expect(parseFrontmatter(await readWiki("quickstart.md")).data.timestamp).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  test("migrates a frontmatter-less tree to conformant OKF in one pass", async () => {
    await writeFixtureFile("quickstart.md", "# Home\n\nStart here.\n");
    await writeFixtureFile("architecture/overview.md", "# Overview\n\nShape.\n");

    await normalize("init");

    const findings = await validateBundle(path.join(tmpRoot, "openwiki"));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    expect(parseFrontmatter(await readWiki("quickstart.md")).data.type).toBe(
      "Overview",
    );
    expect(
      parseFrontmatter(await readWiki("architecture/overview.md")).data.type,
    ).toBe("Architecture");
  });
});

describe("validateBundle", () => {
  test("flags a missing type and a broken link", async () => {
    await writeFixtureFile(
      "quickstart.md",
      "---\ntype: Overview\ntitle: Home\ndescription: d.\n---\n# Home\n\nSee [missing](/domain/gone.md).\n",
    );
    await writeFixtureFile(
      "domain/orphan.md",
      "---\ntitle: No type\ndescription: d.\n---\n# No type\n\nBody.\n",
    );

    const findings = await validateBundle(path.join(tmpRoot, "openwiki"));

    expect(
      findings.some(
        (f) => f.code === "missing-type" && f.file === "domain/orphan.md",
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.code === "broken-link" && f.file === "quickstart.md",
      ),
    ).toBe(true);
  });
});
