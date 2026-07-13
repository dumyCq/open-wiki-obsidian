import { Box, Text } from "ink";
import { formatChatGptAccountFromEnv } from "../agent/openai-chatgpt-oauth.js";
import { OPENWIKI_MODEL_ID_ENV_KEY, OPENWIKI_VERSION } from "../constants.js";
import {
  getDefaultModelId,
  getProviderLabel,
  resolveConfiguredProvider,
} from "../providers/config.js";
import { formatCwd } from "./format.js";

const OPENWIKI_LOGO_LINES = [
  "  ___                  __        ___ _    _ ",
  " / _ \\ _ __   ___ _ __ \\ \\      / (_) | _(_)",
  "| | | | '_ \\ / _ \\ '_ \\ \\ \\ /\\ / /| | |/ / |",
  "| |_| | |_) |  __/ | | | \\ V  V / | |   <| |",
  " \\___/| .__/ \\___|_| |_|  \\_/\\_/  |_|_|\\_\\_|",
  "      |_|",
];
const OPENWIKI_LOGO_WIDTH = Math.max(
  ...OPENWIKI_LOGO_LINES.map((line) => line.length),
);

function sanitizeHeaderValue(value: string, maxLength = 80): string {
  const compactValue = stripControlCharacters(value)
    .replace(/[^\S\n]+/gu, " ")
    .replace(/[\r\n\t]/gu, " ")
    .trim();

  if (compactValue.length <= maxLength) {
    return compactValue;
  }

  return `${compactValue.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stripControlCharacters(value: string): string {
  let sanitized = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint === undefined ||
      codePoint <= 31 ||
      (codePoint >= 127 && codePoint <= 159)
    ) {
      sanitized += " ";
      continue;
    }

    sanitized += character;
  }

  return sanitized;
}

/**
 * The run header: the ASCII logo (when the terminal is wide enough) and a boxed
 * summary of provider, account, model, working directory, and LangSmith tracing
 * status, followed by the subtitle. `compact` renders the single-line variant.
 */
export function Header({
  compact = false,
  modelId,
  showLogo = true,
  subtitle,
}: {
  compact?: boolean;
  modelId?: string | null;
  showLogo?: boolean;
  subtitle: string;
}) {
  const terminalColumns = process.stdout.columns ?? 80;
  const displayModelId = sanitizeHeaderValue(
    modelId ??
      process.env[OPENWIKI_MODEL_ID_ENV_KEY] ??
      getDefaultModelId(resolveConfiguredProvider()),
    Math.max(8, terminalColumns - 12),
  );
  const configuredProvider = resolveConfiguredProvider();
  const displayProvider = getProviderLabel(configuredProvider);
  const chatGptAccount =
    configuredProvider === "openai-chatgpt"
      ? formatChatGptAccountFromEnv()
      : null;
  const displayDirectory = sanitizeHeaderValue(
    formatCwd(process.cwd()),
    Math.max(8, terminalColumns - 17),
  );
  const shouldShowLogo = showLogo && terminalColumns > OPENWIKI_LOGO_WIDTH;
  const tracingEnabled =
    process.env.LANGCHAIN_TRACING_V2 === "true" &&
    Boolean(process.env.LANGSMITH_API_KEY);

  if (compact) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="truncate">
          <Text color="cyan">{">_ "}</Text>
          <Text bold>OpenWiki</Text>{" "}
          <Text color="gray">v{OPENWIKI_VERSION}</Text>{" "}
          <Text color="gray">provider: </Text>
          <Text color="white">{displayProvider}</Text>{" "}
          {chatGptAccount ? (
            <>
              <Text color="gray">account: </Text>
              <Text color="white">{chatGptAccount}</Text>{" "}
            </>
          ) : null}
          <Text color="gray">model: </Text>
          <Text color="white">{displayModelId}</Text>
        </Text>
        <Text>
          <Text color={tracingEnabled ? "green" : "gray"}>
            {tracingEnabled ? "* " : "- "}
          </Text>
          <Text color={tracingEnabled ? "green" : "gray"}>
            LangSmith tracing {tracingEnabled ? "enabled" : "disabled"}
          </Text>
          <Text color="gray"> - </Text>
          <Text color="cyan">{subtitle}</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {shouldShowLogo ? (
        <Box flexDirection="column" marginBottom={1}>
          {OPENWIKI_LOGO_LINES.map((line) => (
            <Text bold color="cyan" key={line} wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box
        borderColor="cyan"
        borderStyle="round"
        flexDirection="column"
        marginBottom={1}
        paddingX={1}
      >
        <Text>
          <Text color="cyan">{">_ "}</Text>
          <Text bold>OpenWiki</Text>{" "}
          <Text color="gray">v{OPENWIKI_VERSION}</Text>{" "}
          <Text color="gray">agent docs for codebases</Text>
        </Text>
        <Text>
          <Text color="gray">provider: </Text>
          <Text color="white">{displayProvider}</Text>
        </Text>
        {chatGptAccount ? (
          <Text>
            <Text color="gray">account: </Text>
            <Text color="white">{chatGptAccount}</Text>
          </Text>
        ) : null}
        <Text>
          <Text color="gray">model: </Text>
          <Text color="white">{displayModelId}</Text>
        </Text>
        <Text>
          <Text color="gray">directory: </Text>
          <Text color="white">{displayDirectory}</Text>
        </Text>
      </Box>
      <Text>
        <Text color={tracingEnabled ? "green" : "gray"}>
          {tracingEnabled ? "* " : "- "}
        </Text>
        <Text color={tracingEnabled ? "green" : "gray"}>
          LangSmith tracing {tracingEnabled ? "enabled" : "disabled"}
        </Text>
        <Text color="gray"> - </Text>
        <Text color="cyan">{subtitle}</Text>
      </Text>
      <Text color="gray">
        Tip: ask for a docs change, or use /exit when you are done.
      </Text>
    </Box>
  );
}
