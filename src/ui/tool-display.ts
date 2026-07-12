import type { OpenWikiRunEvent } from "../agent/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The label for a tool group that is still running: the current action alone
 * when there is only one, otherwise a running count optionally suffixed with the
 * current action.
 */
export function formatToolGroupRunning(
  actionCount: number,
  currentAction: string | null,
): string {
  if (actionCount <= 1) {
    return currentAction ?? "Running 1 action";
  }

  if (currentAction) {
    return `Running ${formatCount(actionCount, "action", "actions")}: ${currentAction}`;
  }

  return `Running ${formatCount(actionCount, "action", "actions")}`;
}

/**
 * The label for a finished tool group: the last action's text for a single
 * clean action, otherwise a ran-count that also reports any failures.
 */
export function formatToolGroupDone(
  actionCount: number,
  errorCount: number,
  latestDoneContent?: string,
): string {
  if (actionCount <= 1 && errorCount === 0) {
    return latestDoneContent ?? "Ran 1 action";
  }

  if (errorCount > 0) {
    return `Ran ${formatCount(actionCount, "action", "actions")} with ${formatCount(
      errorCount,
      "failure",
      "failures",
    )}`;
  }

  return `Ran ${formatCount(actionCount, "action", "actions")}`;
}

/**
 * The running/done labels for a tool call, plus whether to show its detail line.
 */
interface ToolDisplay {
  /**
   * Past-tense label shown once the tool has finished.
   */
  done: string;

  /**
   * Present-tense label shown while the tool is running.
   */
  running: string;

  /**
   * Whether to show the tool's detail line (e.g. the target path) in the log.
   */
  showDetail: boolean;
}

/**
 * Maps a `tool_start` event to friendly running/done labels, choosing a phrasing
 * variant deterministically from the event id so the log reads naturally.
 */
export function createToolDisplay(
  event: Extract<OpenWikiRunEvent, { type: "tool_start" }>,
): ToolDisplay {
  const input = parseToolInput(event.input);
  const variantIndex = pickVariantIndex(
    `${event.id}:${event.name}:${event.call}`,
  );

  switch (event.name) {
    case "read_file": {
      const count = countToolTargets(input, ["path", "paths", "file", "files"]);
      return pickToolDisplay(
        variantIndex,
        [
          `Reading ${formatCount(count, "file", "files")}`,
          `Examining ${formatCount(count, "file", "files")}`,
          `Taking a look at ${formatCount(count, "file", "files")}`,
        ],
        [
          `Read ${formatCount(count, "file", "files")}`,
          `Examined ${formatCount(count, "file", "files")}`,
          `Looked at ${formatCount(count, "file", "files")}`,
        ],
      );
    }
    case "edit_file": {
      const count = countToolTargets(input, ["path", "paths", "file", "files"]);
      return pickToolDisplay(
        variantIndex,
        [
          `Editing ${formatCount(count, "file", "files")}`,
          `Updating ${formatCount(count, "file", "files")}`,
          `Applying changes to ${formatCount(count, "file", "files")}`,
        ],
        [
          `Edited ${formatCount(count, "file", "files")}`,
          `Updated ${formatCount(count, "file", "files")}`,
          `Applied changes to ${formatCount(count, "file", "files")}`,
        ],
        false,
      );
    }
    case "write_file": {
      const count = countToolTargets(input, ["path", "paths", "file", "files"]);
      return pickToolDisplay(
        variantIndex,
        [
          `Writing ${formatCount(count, "file", "files")}`,
          `Creating ${formatCount(count, "file", "files")}`,
          `Saving ${formatCount(count, "file", "files")}`,
        ],
        [
          `Wrote ${formatCount(count, "file", "files")}`,
          `Created ${formatCount(count, "file", "files")}`,
          `Saved ${formatCount(count, "file", "files")}`,
        ],
        false,
      );
    }
    case "ls":
      return pickToolDisplay(
        variantIndex,
        ["Listing files", "Scanning a directory", "Checking the file tree"],
        ["Listed files", "Scanned a directory", "Checked the file tree"],
      );
    case "glob":
      return pickToolDisplay(
        variantIndex,
        [
          "Finding matching files",
          "Searching file paths",
          "Scanning for matches",
        ],
        ["Found matching files", "Searched file paths", "Scanned for matches"],
      );
    case "grep":
      return pickToolDisplay(
        variantIndex,
        [
          "Searching file contents",
          "Grepping the codebase",
          "Looking for matches",
        ],
        [
          "Searched file contents",
          "Grepped the codebase",
          "Looked for matches",
        ],
      );
    case "write_todos": {
      const count = countTodoItems(input);
      return pickToolDisplay(
        variantIndex,
        [
          `Updating ${formatCount(count, "todo", "todos")}`,
          `Organizing ${formatCount(count, "todo", "todos")}`,
          `Refreshing ${formatCount(count, "todo", "todos")}`,
        ],
        [
          `Updated ${formatCount(count, "todo", "todos")}`,
          `Organized ${formatCount(count, "todo", "todos")}`,
          `Refreshed ${formatCount(count, "todo", "todos")}`,
        ],
      );
    }
    case "task": {
      const count = countToolTargets(input, [
        "tasks",
        "subagents",
        "agents",
        "items",
      ]);
      return pickToolDisplay(
        variantIndex,
        [
          `Spinning up ${formatCount(count, "subagent", "subagents")}`,
          `Starting ${formatCount(count, "subagent", "subagents")}`,
          `Delegating to ${formatCount(count, "subagent", "subagents")}`,
        ],
        [
          `Finished ${formatCount(count, "subagent", "subagents")}`,
          `Completed ${formatCount(count, "subagent", "subagents")}`,
          `Wrapped up ${formatCount(count, "subagent", "subagents")}`,
        ],
      );
    }
    default:
      return {
        done: event.call,
        running: event.call,
        showDetail: false,
      };
  }
}

function pickToolDisplay(
  variantIndex: number,
  running: string[],
  done: string[],
  showDetail = true,
): ToolDisplay {
  const index = variantIndex % Math.min(running.length, done.length);

  return {
    done: done[index],
    running: running[index],
    showDetail,
  };
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function countToolTargets(input: unknown, keys: string[]): number {
  if (Array.isArray(input)) {
    return Math.max(input.length, 1);
  }

  if (!isRecord(input)) {
    return 1;
  }

  for (const key of keys) {
    const value = input[key];

    if (Array.isArray(value)) {
      return Math.max(value.length, 1);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return 1;
    }
  }

  return 1;
}

function countTodoItems(input: unknown): number {
  if (!isRecord(input)) {
    return 1;
  }

  const todos = input.todos ?? input.items;

  return Array.isArray(todos) ? Math.max(todos.length, 1) : 1;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pickVariantIndex(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash;
}

/**
 * Truncates tool output to fit two terminal lines, accounting for the label
 * width and terminal columns, with an ellipsis when it overflows.
 */
export function truncateLogOutput(content: string, label: string): string {
  const terminalColumns = process.stdout.columns ?? 80;
  const availableColumns = Math.max(24, terminalColumns - label.length - 7);

  return truncateToDisplayLines(content, 2, availableColumns);
}

function truncateToDisplayLines(
  content: string,
  maxLines: number,
  maxColumns: number,
): string {
  const normalizedContent = content.replace(/\s+/gu, " ").trim();

  if (normalizedContent.length <= maxColumns) {
    return normalizedContent;
  }

  const lines: string[] = [];
  let remaining = normalizedContent;

  while (remaining.length > 0 && lines.length < maxLines) {
    lines.push(remaining.slice(0, maxColumns));
    remaining = remaining.slice(maxColumns);
  }

  if (remaining.length > 0 && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] =
      lastLine.length > 3 ? `${lastLine.slice(0, -3)}...` : "...";
  }

  return lines.join("\n");
}
