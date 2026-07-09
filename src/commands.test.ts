import { describe, expect, it } from "vitest";

import { parseCommand } from "./commands.js";

describe("parseCommand — --telemetry-file", () => {
  it("populates telemetryFile from a space-separated value", () => {
    const result = parseCommand([
      "code",
      "--init",
      "--telemetry-file",
      "/tmp/t.json",
    ]);

    expect(result.kind).toBe("run");
    if (result.kind === "run") {
      expect(result.telemetryFile).toBe("/tmp/t.json");
    }
  });

  it("populates telemetryFile from an =value", () => {
    const result = parseCommand([
      "personal",
      "--init",
      "--telemetry-file=/tmp/t.json",
    ]);

    expect(result.kind).toBe("run");
    if (result.kind === "run") {
      expect(result.telemetryFile).toBe("/tmp/t.json");
    }
  });

  it("errors when the value is missing", () => {
    const result = parseCommand(["personal", "--init", "--telemetry-file"]);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("requires a path");
    }
  });

  it("errors on an empty =value", () => {
    const result = parseCommand(["personal", "--init", "--telemetry-file="]);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("requires a path");
    }
  });

  it("defaults telemetryFile to null when absent", () => {
    const result = parseCommand(["personal", "--init"]);

    expect(result.kind).toBe("run");
    if (result.kind === "run") {
      expect(result.telemetryFile).toBeNull();
    }
  });
});
