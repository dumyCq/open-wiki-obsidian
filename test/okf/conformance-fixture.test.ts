import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validateBundle } from "../../src/agent/okf/validate.ts";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "okf-bundle",
);

describe("conformance fixture", () => {
  test("the golden OKF bundle validates with zero errors", async () => {
    const errors = (await validateBundle(fixtureRoot)).filter(
      (finding) => finding.level === "error",
    );

    expect(errors).toEqual([]);
  });
});
