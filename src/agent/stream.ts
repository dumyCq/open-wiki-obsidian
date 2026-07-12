import type { Event as ProtocolEvent } from "@langchain/protocol";
import type { OpenWikiRunEvent } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parses a raw deepagents protocol stream chunk into an {@link OpenWikiRunEvent}
 * (a text or tool event), or `null` when the chunk is not a recognized message
 * or tool protocol event.
 */
export function parseStreamEvent(chunk: unknown): OpenWikiRunEvent | null {
  if (!isProtocolStreamEvent(chunk)) {
    return null;
  }

  if (chunk.method === "messages") {
    const text = extractMessageText(chunk.params.data);

    return text.length > 0
      ? {
          source: isSubgraphProtocolEvent(chunk) ? "subgraph" : "main",
          type: "text",
          text,
        }
      : null;
  }

  if (chunk.method === "tools") {
    return parseToolStreamEvent(chunk.params.data);
  }

  return null;
}

/**
 * Type guard for a deepagents protocol stream event.
 */
export function isProtocolStreamEvent(value: unknown): value is ProtocolEvent {
  return (
    isRecord(value) &&
    value.type === "event" &&
    typeof value.method === "string" &&
    isRecord(value.params) &&
    "data" in value.params
  );
}

function isSubgraphProtocolEvent(event: ProtocolEvent): boolean {
  return event.params.namespace.length > 1;
}

function extractMessageText(payload: unknown): string {
  return extractMessageTextValue(payload, new Set());
}

function extractMessageTextValue(payload: unknown, seen: Set<object>): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 2 && isStreamMessageTuplePayload(payload)) {
      return extractMessageTextValue(payload[0], seen);
    }

    for (const item of payload) {
      const text = extractMessageTextValue(item, seen);

      if (text.length > 0) {
        return text;
      }
    }

    return payload.map((item) => extractContentBlockText(item, seen)).join("");
  }

  if (!isRecord(payload) || seen.has(payload)) {
    return "";
  }

  seen.add(payload);

  const protocolText = extractProtocolMessageText(payload, seen);

  if (protocolText !== null) {
    return protocolText;
  }

  if (isRecord(payload.chunk)) {
    const text = extractMessageTextValue(payload.chunk, seen);

    if (text.length > 0) {
      return text;
    }
  }

  if (isRecord(payload.message)) {
    const text = extractMessageTextValue(payload.message, seen);

    if (text.length > 0) {
      return text;
    }
  }

  if (!shouldReadMessageRecord(payload)) {
    return "";
  }

  const contentText = extractContentText(payload.content, seen);

  if (contentText.length > 0) {
    return contentText;
  }

  for (const key of [
    "text",
    "output",
    "generations",
    "messages",
    "kwargs",
    "lc_kwargs",
  ]) {
    const text = extractMessageTextValue(payload[key], seen);

    if (text.length > 0) {
      return text;
    }
  }

  return "";
}

function isStreamMessageTuplePayload(payload: unknown[]): boolean {
  const [message, metadata] = payload;

  if (!isRecord(metadata) || !isMessageLikeRecord(message)) {
    return false;
  }

  if (
    "langgraph_node" in metadata ||
    "run_id" in metadata ||
    "tags" in metadata ||
    "metadata" in metadata
  ) {
    return true;
  }

  return (
    "langgraph_node" in message ||
    "checkpoint_ns" in message ||
    "thread_id" in message
  );
}

function isMessageLikeRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    "content" in value ||
    "text" in value ||
    "kwargs" in value ||
    "lc_kwargs" in value ||
    typeof value._getType === "function" ||
    getMessageRole(value) !== null ||
    hasSerializedMessageId(value)
  );
}

function extractProtocolMessageText(
  payload: Record<string, unknown>,
  seen: Set<object>,
): string | null {
  const event = getStringRecordValue(payload, "event");

  if (!event) {
    return null;
  }

  if (event === "content-block-delta") {
    return extractContentDeltaText(payload.delta, seen);
  }

  if (event === "content-block-start") {
    return extractContentText(payload.content, seen);
  }

  if (
    event === "message-start" ||
    event === "message-finish" ||
    event === "content-block-finish" ||
    event === "error"
  ) {
    return "";
  }

  return null;
}

function extractContentText(content: unknown, seen: Set<object>): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => extractContentBlockText(block, seen))
      .join("");
  }

  if (isRecord(content)) {
    return extractContentBlockText(content, seen);
  }

  return "";
}

function extractContentDeltaText(delta: unknown, seen: Set<object>): string {
  if (typeof delta === "string") {
    return delta;
  }

  if (!isRecord(delta)) {
    return "";
  }

  const type = getStringRecordValue(delta, "type");

  if (type === "text-delta") {
    return typeof delta.text === "string" ? delta.text : "";
  }

  if (type === "block-delta") {
    return extractContentBlockText(delta.fields, seen);
  }

  if (typeof delta.text === "string") {
    return delta.text;
  }

  if (typeof delta.delta === "string") {
    return delta.delta;
  }

  return "";
}

function extractContentBlockText(block: unknown, seen: Set<object>): string {
  if (typeof block === "string") {
    return block;
  }

  if (!isRecord(block)) {
    return "";
  }

  const type = getStringRecordValue(block, "type");

  if (type?.includes("tool") || type?.includes("reasoning")) {
    return "";
  }

  for (const key of ["text", "content", "output_text"]) {
    const text = block[key];

    if (typeof text === "string") {
      return text;
    }
  }

  if (isRecord(block.fields)) {
    return extractContentBlockText(block.fields, seen);
  }

  if (isRecord(block.delta)) {
    return extractContentDeltaText(block.delta, seen);
  }

  return "";
}

function shouldReadMessageRecord(value: Record<string, unknown>): boolean {
  const role = getMessageRole(value);

  return role === null || role === "ai" || role === "assistant";
}

function getMessageRole(value: Record<string, unknown>): string | null {
  for (const key of ["role", "type"]) {
    const role = getStringRecordValue(value, key);

    if (isMessageRole(role)) {
      return role;
    }
  }

  const serializedType = getSerializedMessageType(value);

  if (serializedType === "AIMessage" || serializedType === "AIMessageChunk") {
    return "ai";
  }

  if (
    serializedType === "HumanMessage" ||
    serializedType === "SystemMessage" ||
    serializedType === "ToolMessage"
  ) {
    return serializedType.replace("Message", "").toLowerCase();
  }

  const getType = value._getType;

  if (typeof getType !== "function") {
    return null;
  }

  try {
    const role: unknown = getType.call(value);

    return isMessageRole(role) ? role : null;
  } catch {
    return null;
  }
}

function hasSerializedMessageId(value: Record<string, unknown>): boolean {
  return getSerializedMessageType(value) !== null;
}

function getSerializedMessageType(
  value: Record<string, unknown>,
): string | null {
  if (!Array.isArray(value.id)) {
    return null;
  }

  return (
    value.id
      .filter((part): part is string => typeof part === "string")
      .at(-1) ?? null
  );
}

function isMessageRole(value: unknown): value is string {
  return (
    value === "ai" ||
    value === "assistant" ||
    value === "human" ||
    value === "system" ||
    value === "tool"
  );
}

function parseToolStreamEvent(payload: unknown): OpenWikiRunEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const event = getStringRecordValue(payload, "event");

  if (event === "on_tool_start" || event === "tool-started") {
    const name =
      getStringRecordValue(payload, "name") ??
      getStringRecordValue(payload, "tool_name") ??
      "tool";
    const id =
      getStringRecordValue(payload, "toolCallId") ??
      getStringRecordValue(payload, "tool_call_id") ??
      createSyntheticToolCallId(name, payload.input);

    return {
      type: "tool_start",
      call: `${formatToolCallName(name)}(${formatToolArgs(payload.input)})`,
      id,
      input: payload.input,
      name,
    };
  }

  if (
    event === "on_tool_end" ||
    event === "tool-finished" ||
    event === "on_tool_error" ||
    event === "tool-error"
  ) {
    const name =
      getStringRecordValue(payload, "name") ??
      getStringRecordValue(payload, "tool_name") ??
      "tool";
    const id =
      getStringRecordValue(payload, "toolCallId") ??
      getStringRecordValue(payload, "tool_call_id") ??
      createSyntheticToolCallId(name, payload.input);

    return {
      type: "tool_end",
      id,
      name,
      status:
        event === "on_tool_error" || event === "tool-error"
          ? "error"
          : "finished",
    };
  }

  return null;
}

function formatToolCallName(name: string): string {
  return name === "execute" ? "Execute" : name;
}

function formatToolArgs(input: unknown): string {
  const value = parseStringifiedJson(input);

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, argValue]) => `${key}=${formatToolValue(argValue)}`)
      .join(", ");
  }

  if (Array.isArray(value)) {
    return value.map(formatToolValue).join(", ");
  }

  if (value === undefined || value === null) {
    return "";
  }

  return formatToolValue(value);
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return JSON.stringify(value) ?? String(value);
}

function parseStringifiedJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function createSyntheticToolCallId(name: string, input: unknown): string {
  return `${name}:${formatToolValue(input)}`;
}

function getStringRecordValue(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}
