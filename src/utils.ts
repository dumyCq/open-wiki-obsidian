import os from "node:os";
import path from "node:path";

/**
 * Expands a leading `~` (home directory shorthand) and resolves the result to
 * an absolute path. `~` and `~/`/`~\` prefixes expand against the user's home
 * directory; anything else is resolved as-is via `path.resolve`.
 */
export function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

/**
 * Removes HTML tags from a string and returns the remaining plain text.
 *
 * Well-formed tags are removed by stripping `<...>` spans repeatedly until the
 * string stops changing. Any leftover angle brackets are then removed individually,
 * so neither a complete nor a partial tag can survive.
 */
export function stripHtmlTags(input: string): string {
  let previous: string;
  let output = input;

  do {
    previous = output;
    output = output.replace(/<[^>]*>/gu, "");
  } while (output !== previous);

  return output.replace(/[<>]/gu, "");
}
