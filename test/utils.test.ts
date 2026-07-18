import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createOpenWikiContentSnapshot } from "../src/agent/utils.ts";
import { stripHtmlTags } from "../src/utils.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("stripHtmlTags", () => {
  test("removes a complete tag pair", () => {
    expect(stripHtmlTags("<div>hello</div>")).toBe("hello");
  });

  test("removes adjacent and nested tags", () => {
    expect(stripHtmlTags("<b><i>hi</i></b>")).toBe("hi");
    expect(stripHtmlTags("a<br/>b<hr>c")).toBe("abc");
  });

  test("removes HTML comments", () => {
    expect(stripHtmlTags("before<!-- secret -->after")).toBe("beforeafter");
  });

  test("strips an unterminated tag fragment, leaving no angle brackets", () => {
    expect(stripHtmlTags("text <script")).toBe("text script");
    expect(stripHtmlTags("<script")).toBe("script");
  });

  test("never leaves an angle bracket in the output", () => {
    for (const input of [
      "<div>hi</div>",
      "text <script",
      "<scr<script>ipt>",
      "<<script>>",
      "a < b > c",
    ]) {
      const output = stripHtmlTags(input);
      expect(output).not.toContain("<");
      expect(output).not.toContain(">");
    }
  });

  test("leaves plain text untouched", () => {
    expect(stripHtmlTags("just plain text")).toBe("just plain text");
    expect(stripHtmlTags("")).toBe("");
  });
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
