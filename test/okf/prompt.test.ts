import { describe, expect, test } from "vitest";
import { describeDocTypesForPrompt } from "../../src/agent/okf/taxonomy.ts";
import { createSystemPrompt } from "../../src/agent/prompt.ts";

describe("createSystemPrompt OKF contract", () => {
  test("repository mode includes the body-only contract with repo taxonomy", () => {
    const prompt = createSystemPrompt("init", "repository");

    expect(prompt).toContain("Write the markdown BODY ONLY");
    expect(prompt).toContain("# Citations");
    expect(prompt).toContain(describeDocTypesForPrompt("repository"));
  });

  test("local-wiki mode includes the body-only contract with personal taxonomy", () => {
    const prompt = createSystemPrompt("init", "local-wiki");

    expect(prompt).toContain("Write the markdown BODY ONLY");
    expect(prompt).toContain("# Citations");
    expect(prompt).toContain(describeDocTypesForPrompt("local-wiki"));
  });

  test("the contract is set off by exactly one blank line on each side", () => {
    for (const mode of ["repository", "local-wiki"] as const) {
      const prompt = createSystemPrompt("init", mode);

      expect(prompt).toContain(".\n\nOKF output contract");
      expect(prompt).toContain("after you finish.\n\nMode-specific behavior:");
    }
  });
});
