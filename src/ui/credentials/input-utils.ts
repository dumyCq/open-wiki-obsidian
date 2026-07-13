/**
 * Pure input/display utilities for the setup wizard's Ink components: selection
 * math, terminal sizing, escape sequences, and text sanitizing. No domain
 * logic and no rendering, so each is unit-testable in isolation.
 */

/**
 * Wraps a selection index by `offset` within `itemCount`, so moving past either
 * end lands on the other. Returns 0 when there are no items.
 */
export function moveSelectionIndex(
  currentIndex: number,
  offset: number,
  itemCount: number,
): number {
  if (itemCount <= 0) {
    return 0;
  }

  return (currentIndex + offset + itemCount) % itemCount;
}

/**
 * The width to render text inputs at, derived from the terminal column count
 * and clamped to [24, 96]; falls back to 64 when the width is unknown.
 */
export function getInputDisplayWidth(
  stdoutColumns: number | undefined,
): number {
  const defaultWidth = 64;

  if (!stdoutColumns || stdoutColumns <= 0) {
    return defaultWidth;
  }

  return Math.max(24, Math.min(96, stdoutColumns - 16));
}

/**
 * Strips carriage returns and newlines from a typed input chunk so pasted
 * multi-line text does not break single-line fields.
 */
export function sanitizeInputChunk(value: string): string {
  return value.replace(/[\r\n]/gu, "");
}

/**
 * The message to show for an unknown thrown value: the `Error`'s message, or
 * its string coercion otherwise.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A masked stand-in for a secret's on-screen value, revealing only its length.
 */
export function formatSecretInputDisplay(value: string): string {
  return value.length === 0 ? "empty" : `hidden (${value.length} chars)`;
}

/**
 * Wraps a label in the OSC 8 terminal-hyperlink escape so supporting terminals
 * render it as a clickable link to `url`.
 */
export function formatTerminalHyperlink(url: string, label: string): string {
  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

/**
 * Truncates a value to fit `maxLength`, keeping the tail (where the cursor is)
 * and prefixing an ellipsis when there is room. Empty when `maxLength <= 0`.
 */
export function getSingleLineInputDisplayValue(
  value: string,
  maxLength: number,
): string {
  if (maxLength <= 0) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(-maxLength);
  }

  return `...${value.slice(-(maxLength - 3))}`;
}
