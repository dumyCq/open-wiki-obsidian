import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Header } from "./header.js";
import { MarkdownText } from "./markdown.js";
import { truncateLogOutput } from "./tool-display.js";
import { PromptBlock } from "./components.js";
import { CredentialDiagnosticsPanel } from "./views.js";
import type { OpenWikiCommand } from "../agent/types.js";
import type { CredentialDiagnostic } from "../env.js";
import type { CompletedRun, RunLogItem } from "./types.js";

/**
 * Props for {@link RunView}: the command being run, its live log, and optional
 * result metadata (done state, final message, model, credential diagnostics).
 */
interface RunViewProps {
  command: OpenWikiCommand;
  credentialDiagnostics?: CredentialDiagnostic[];
  log: RunLogItem[];
  done?: boolean;
  message?: string | null;
  modelId?: string | null;
}

/**
 * The live run view: a compact header, the streaming activity log (text lines,
 * tool-call groups, diagnostics), and the final result or error state.
 */
export function RunView({
  command,
  credentialDiagnostics,
  log,
  done = false,
  message = null,
  modelId = null,
}: RunViewProps) {
  const [animationFrame, setAnimationFrame] = useState(0);
  const activeRunningToolId = getActiveRunningToolLogId(log);
  const hasRunningTool = activeRunningToolId !== null;

  useEffect(() => {
    if (done || !hasRunningTool) {
      return;
    }

    const interval = setInterval(() => {
      setAnimationFrame((frame) => frame + 1);
    }, 140);

    return () => {
      clearInterval(interval);
    };
  }, [done, hasRunningTool]);

  return (
    <Box flexDirection="column">
      <Header
        compact
        modelId={modelId}
        showLogo={false}
        subtitle={done ? "Run complete" : "Agent running"}
      />
      {message ? <PromptBlock message={message} /> : null}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color={done ? "green" : "cyan"}>* </Text>
          <Text bold>{done ? "Complete" : "Working"}</Text>{" "}
          <Text color="gray">openwiki {command}</Text>
          {!done ? <Text color="gray"> - streaming</Text> : null}
        </Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {log.length > 0 ? (
            log.map((item) => (
              <RunLogLine
                activeRunningToolId={activeRunningToolId}
                animationFrame={animationFrame}
                item={item}
                key={item.id}
              />
            ))
          ) : (
            <Text color="gray">Waiting for model output...</Text>
          )}
        </Box>
      </Box>
      {credentialDiagnostics ? (
        <CredentialDiagnosticsPanel diagnostics={credentialDiagnostics} />
      ) : null}
    </Box>
  );
}

function RunLogLine({
  activeRunningToolId = null,
  animationFrame = 0,
  item,
}: {
  activeRunningToolId?: number | null;
  animationFrame?: number;
  item: RunLogItem;
}) {
  if (item.type === "tool") {
    if (item.status === "running") {
      const isActive = item.id === activeRunningToolId;

      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={isActive ? "cyan" : "gray"}>
              {isActive ? `${getSpinnerFrame(animationFrame)} ` : "* "}
            </Text>
            <Text bold={isActive} color={isActive ? "cyan" : "gray"}>
              {item.content}
            </Text>
          </Text>
          {isActive && item.call ? (
            <Text color="gray"> {truncateLogOutput(item.call, "")}</Text>
          ) : null}
        </Box>
      );
    }

    if (item.status === "error") {
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold color="red">
              {"!! "}
            </Text>
            <Text bold color="red">
              {item.content}
            </Text>
          </Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color="green">{"* "}</Text>
          <Text color="gray">{item.content}</Text>
        </Text>
      </Box>
    );
  }

  if (item.type === "debug") {
    return (
      <Text>
        <Text color="gray">- </Text>
        <Text color="gray">{item.content}</Text>
      </Text>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="white">* </Text>
      <Box flexDirection="column">
        <MarkdownText markdown={item.content.trim()} />
      </Box>
    </Box>
  );
}

function getActiveRunningToolLogId(log: RunLogItem[]): number | null {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const item = log[index];

    if (item.type === "tool" && item.status === "running") {
      return item.id;
    }
  }

  return null;
}

function getSpinnerFrame(frame: number): string {
  const frames = ["-", "\\", "|", "/"];

  return frames[frame % frames.length] ?? "-";
}

/**
 * Renders finished runs above the prompt so the session reads as a transcript:
 * each run's command, log, and result.
 */
export function ChatHistory({ runs }: { runs: CompletedRun[] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {runs.map((run) => (
        <Box flexDirection="column" key={run.id} marginBottom={1}>
          {run.message ? <PromptBlock message={run.message} /> : null}
          <Text>
            <Text color="green">* </Text>
            <Text bold>Complete</Text>{" "}
            <Text color="gray">
              openwiki {run.command} - {run.result.model}
            </Text>
          </Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {run.log.length > 0 ? (
              run.log.map((item) => <RunLogLine item={item} key={item.id} />)
            ) : (
              <Text color="gray">No assistant output captured.</Text>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
