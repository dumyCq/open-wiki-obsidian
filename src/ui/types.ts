import type { OpenWikiCommand, OpenWikiRunResult } from "../agent/types.js";
import type { ErrorDiagnostic } from "../cli/error-diagnostics.js";
import type { InitSetupResult } from "./credentials/init-setup.js";
import type { CredentialDiagnostic } from "../env.js";
import type { OpenWikiIngestionResult } from "../ingestion.js";

/**
 * The App's finite run state: idle, an interactive credential-setup outcome, an
 * in-flight or finished run/ingestion (each carrying its live log), or an error.
 * A discriminated union keyed on `status`.
 */
export type RunState =
  | { status: "idle" }
  | { status: "setup-complete-exit"; result: InitSetupResult }
  | { status: "init-setup-saved"; result: InitSetupResult }
  | {
      status: "ingestion-running";
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "ingestion-success";
      result: OpenWikiIngestionResult;
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "running";
      command: OpenWikiCommand;
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "success";
      result: OpenWikiRunResult;
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "error";
      message: string;
      credentialDiagnostics?: CredentialDiagnostic[];
      errorDiagnostics?: ErrorDiagnostic[];
    };

/**
 * One line in a run's activity log. A `text` or `debug` line carries rendered
 * `content`; a `tool` line is a group that aggregates one or more tool actions,
 * using the optional fields below to track and summarize them.
 */
export interface RunLogItem {
  /**
   * Stable id, used for React keys and to locate the item when updating it.
   */
  id: number;

  /**
   * Which kind of line this is.
   */
  type: "debug" | "text" | "tool";

  /**
   * Rendered content: the text/debug body, or a tool group's headline label.
   */
  content: string;

  /**
   * Lifecycle of a tool group.
   */
  status?: "done" | "error" | "running";

  actionCount?: number;
  activeToolCallIds?: string[];
  call?: string;
  doneContent?: string;
  errorCount?: number;
  latestDoneContent?: string;
  toolCallId?: string;
  toolName?: string;
}

/**
 * A finished run retained for the chat-history view: its command, full log,
 * final result, and any trailing message.
 */
export interface CompletedRun {
  id: number;
  command: OpenWikiCommand;
  credentialDiagnostics?: CredentialDiagnostic[];
  log: RunLogItem[];
  message: string | null;
  result: OpenWikiRunResult;
}
