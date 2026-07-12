import type { MutableRefObject } from "react";
import type { OpenWikiRunEvent } from "../agent/types.js";
import type { CredentialDiagnostic } from "../env.js";
import {
  createToolDisplay,
  formatToolGroupDone,
  formatToolGroupRunning,
} from "./tool-display.js";
import type { RunLogItem, RunState } from "./types.js";

/**
 * Records the latest credential diagnostics in the ref and, if a run is in
 * flight, attaches them to the running state so they surface in the UI.
 */
export function updateRunningCredentialDiagnostics(
  state: RunState,
  credentialDiagnostics: CredentialDiagnostic[],
  credentialDiagnosticsRef: MutableRefObject<
    CredentialDiagnostic[] | undefined
  >,
): RunState {
  credentialDiagnosticsRef.current = credentialDiagnostics;

  return state.status === "running"
    ? {
        ...state,
        credentialDiagnostics,
      }
    : state;
}

/**
 * Folds a streamed run event into the activity log: appends text/debug lines and
 * opens or updates tool-call groups, assigning ids from `nextLogId`. Returns the
 * next log array (never mutates the input).
 */
export function appendRunLogEvent(
  log: RunLogItem[],
  event: OpenWikiRunEvent,
  nextLogId: MutableRefObject<number>,
): RunLogItem[] {
  if (event.type === "text" && event.source === "subgraph") {
    return log;
  }

  if (event.type === "text" && event.text.length === 0) {
    return log;
  }

  if (event.type === "tool_start") {
    return appendToolStartLogItem(log, event, nextLogId);
  }

  if (event.type === "tool_end") {
    return completeToolLogItem(log, event);
  }

  const nextLog = [...log];
  const content = event.type === "text" ? event.text : event.message;
  const previous = nextLog.at(-1);

  if (event.type === "text" && previous?.type === "text") {
    nextLog[nextLog.length - 1] = {
      ...previous,
      content: `${previous.content}${content}`,
    };
  } else {
    nextLog.push({
      id: nextLogId.current,
      type: event.type,
      content,
    });
    nextLogId.current += 1;
  }

  return nextLog;
}

function appendToolStartLogItem(
  log: RunLogItem[],
  event: Extract<OpenWikiRunEvent, { type: "tool_start" }>,
  nextLogId: MutableRefObject<number>,
): RunLogItem[] {
  const toolDisplay = createToolDisplay(event);
  const nextLog = [...log];
  const previous = nextLog.at(-1);

  if (previous?.type === "tool") {
    const actionCount = (previous.actionCount ?? 1) + 1;
    const errorCount = previous.errorCount ?? 0;
    const latestDoneContent = toolDisplay.done;

    nextLog[nextLog.length - 1] = {
      ...previous,
      actionCount,
      activeToolCallIds: [...getActiveToolCallIds(previous), event.id],
      call: toolDisplay.showDetail ? event.call : undefined,
      content: formatToolGroupRunning(actionCount, toolDisplay.running),
      doneContent: formatToolGroupDone(
        actionCount,
        errorCount,
        latestDoneContent,
      ),
      errorCount,
      latestDoneContent,
      status: "running",
      toolCallId: event.id,
      toolName: event.name,
    };

    return nextLog;
  }

  return [
    ...log,
    {
      actionCount: 1,
      activeToolCallIds: [event.id],
      call: toolDisplay.showDetail ? event.call : undefined,
      content: toolDisplay.running,
      doneContent: toolDisplay.done,
      errorCount: 0,
      id: nextLogId.current++,
      latestDoneContent: toolDisplay.done,
      status: "running",
      toolCallId: event.id,
      toolName: event.name,
      type: "tool",
    },
  ];
}

function completeToolLogItem(
  log: RunLogItem[],
  event: Extract<OpenWikiRunEvent, { type: "tool_end" }>,
): RunLogItem[] {
  const matchingIndex = findLastToolLogItemIndex(log, event.id);

  if (matchingIndex === -1) {
    return log;
  }

  return log.map((item, index) =>
    index === matchingIndex ? completeToolGroupItem(item, event) : item,
  );
}

function completeToolGroupItem(
  item: RunLogItem,
  event: Extract<OpenWikiRunEvent, { type: "tool_end" }>,
): RunLogItem {
  const actionCount = item.actionCount ?? 1;
  const activeToolCallIds = getActiveToolCallIds(item).filter(
    (id) => id !== event.id,
  );
  const errorCount =
    (item.errorCount ?? 0) + (event.status === "error" ? 1 : 0);
  const latestDoneContent = item.latestDoneContent ?? item.doneContent;

  if (activeToolCallIds.length > 0) {
    return {
      ...item,
      activeToolCallIds,
      call: undefined,
      content: formatToolGroupRunning(actionCount, null),
      doneContent: formatToolGroupDone(
        actionCount,
        errorCount,
        latestDoneContent,
      ),
      errorCount,
      status: "running",
    };
  }

  return {
    ...item,
    activeToolCallIds,
    call: undefined,
    content: formatToolGroupDone(actionCount, errorCount, latestDoneContent),
    doneContent: formatToolGroupDone(
      actionCount,
      errorCount,
      latestDoneContent,
    ),
    errorCount,
    status: errorCount > 0 ? "error" : "done",
  };
}

function findLastToolLogItemIndex(
  log: RunLogItem[],
  toolCallId: string,
): number {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const item = log[index];

    if (
      item.type === "tool" &&
      item.status === "running" &&
      getActiveToolCallIds(item).includes(toolCallId)
    ) {
      return index;
    }
  }

  return -1;
}

function getActiveToolCallIds(item: RunLogItem): string[] {
  if (item.activeToolCallIds) {
    return item.activeToolCallIds;
  }

  if (item.status === "running" && item.toolCallId) {
    return [item.toolCallId];
  }

  return [];
}
