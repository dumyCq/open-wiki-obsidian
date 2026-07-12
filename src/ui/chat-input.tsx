import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { OpenWikiCommand } from "../agent/types.js";
import {
  getDefaultModelId,
  getProviderApiKeyEnvKey,
  getProviderLabel,
  getProviderModelOptions,
  isValidModelId,
  normalizeModelId,
  normalizeProvider,
  SELECTABLE_OPENWIKI_PROVIDERS,
  type OpenWikiProvider,
} from "../constants.js";
import { saveOpenWikiEnv } from "../env.js";
import { formatCwd } from "./format.js";

/**
 * Props for {@link ChatInput}: the current provider/model plus the callbacks the
 * input fires for submitting messages, running commands, and switching model or
 * provider.
 */
interface ChatInputProps {
  currentModelId: string;
  currentProvider: OpenWikiProvider;
  onClear: () => void;
  onCommandRun: (
    command: Extract<OpenWikiCommand, "init" | "update">,
    message: string | null,
  ) => void;
  onModelSelect: (modelId: string) => Promise<void>;
  onProviderSelect: (provider: OpenWikiProvider) => Promise<void>;
  onSubmit: (message: string) => void;
}

/**
 * The interactive chat prompt: a controlled text input with a slash-command
 * menu (commands, model, and provider pickers) and masked secret entry, driving
 * the callbacks in {@link ChatInputProps}.
 */
export function ChatInput({
  currentModelId,
  currentProvider,
  onClear,
  onCommandRun,
  onModelSelect,
  onProviderSelect,
  onSubmit,
}: ChatInputProps) {
  const [inputState, setInputState] = useState<ChatInputState>({
    cursorPosition: 0,
    value: "",
  });
  const [menuState, setMenuState] = useState<ChatInputMenuState>({
    kind: "none",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [secretInputMode, setSecretInputMode] =
    useState<SecretInputMode | null>(null);
  const input = inputState.value;
  const cursorPosition = inputState.cursorPosition;

  useEffect(() => {
    if (secretInputMode !== null) {
      return;
    }

    setMenuState((currentState) =>
      syncMenuStateForInput(
        input,
        currentState,
        currentModelId,
        currentProvider,
      ),
    );
  }, [currentModelId, currentProvider, input, secretInputMode]);

  useInput((inputValue, key) => {
    if (isSaving) {
      return;
    }

    if (secretInputMode !== null) {
      if (isEscapeInput(inputValue, key)) {
        resetInput();
        setSecretInputMode(null);
        setNotice("Credential update canceled.");
        return;
      }

      if (key.return) {
        void saveSecretInput();
        return;
      }

      if (key.backspace || isRawBackspaceInput(inputValue)) {
        setInputState(deleteBeforeInputCursor);
        return;
      }

      if (key.delete) {
        setInputState(
          inputValue.length === 0
            ? deleteBeforeInputCursor
            : deleteAtInputCursor,
        );
        return;
      }

      if (inputValue && !key.ctrl && !key.meta) {
        setError(null);
        setNotice(null);
        setInputState((state) => applyRawInputValue(state, inputValue));
      }

      return;
    }

    if (isMenuUpInput(inputValue, key) && menuState.kind !== "none") {
      setMenuState((state) =>
        moveMenuSelection(state, -1, currentModelId, currentProvider),
      );
      return;
    }

    if (isMenuDownInput(inputValue, key) && menuState.kind !== "none") {
      setMenuState((state) =>
        moveMenuSelection(state, 1, currentModelId, currentProvider),
      );
      return;
    }

    if (key.return) {
      void submitInput();
      return;
    }

    if (isEscapeInput(inputValue, key) && menuState.kind !== "none") {
      resetInput();
      return;
    }

    if (key.leftArrow) {
      setInputState((state) => moveInputCursor(state, -1));
      return;
    }

    if (key.rightArrow) {
      setInputState((state) => moveInputCursor(state, 1));
      return;
    }

    if ((key.ctrl && inputValue === "a") || inputValue === "\u0001") {
      setInputState((state) => ({
        ...state,
        cursorPosition: 0,
      }));
      return;
    }

    if ((key.ctrl && inputValue === "e") || inputValue === "\u0005") {
      setInputState((state) => ({
        ...state,
        cursorPosition: state.value.length,
      }));
      return;
    }

    if (key.backspace || isRawBackspaceInput(inputValue)) {
      setInputState(deleteBeforeInputCursor);
      return;
    }

    if (key.delete) {
      setInputState(
        inputValue.length === 0 ? deleteBeforeInputCursor : deleteAtInputCursor,
      );
      return;
    }

    if (inputValue && !key.ctrl && !key.meta) {
      setError(null);
      setNotice(null);
      setInputState((state) => applyRawInputValue(state, inputValue));
    }
  });

  async function submitInput() {
    const message = input.trim();

    if (message.length === 0) {
      setError("Enter a follow-up message.");
      return;
    }

    if (message.startsWith("/")) {
      await submitSlashInput(message);
      return;
    }

    resetInput();
    onSubmit(message);
  }

  async function submitSlashInput(message: string) {
    if (message === "/" && menuState.kind === "commands") {
      await runSlashCommand(slashCommandOptions[menuState.selectedIndex]);
      return;
    }

    if (message === "/model" && menuState.kind === "model") {
      await selectModelMenuOption(menuState.selectedIndex);
      return;
    }

    if (message === "/provider" && menuState.kind === "provider") {
      await selectProviderMenuOption(menuState.selectedIndex);
      return;
    }

    const parsedCommand = parseSlashInput(message);

    if (parsedCommand === null) {
      setError(`Unknown command: ${message}`);
      return;
    }

    await runSlashCommand(
      parsedCommand.option,
      parsedCommand.args.length > 0 ? parsedCommand.args : null,
    );
  }

  async function runSlashCommand(
    option: SlashCommandOption | undefined,
    args: string | null = null,
  ) {
    if (!option) {
      setError("Select a slash command.");
      return;
    }

    if (option.id === "model") {
      if (args && args.length > 0) {
        await saveModelSelection(args);
        return;
      }

      setError(null);
      setNotice("Choose a model, or type /model <model-id>.");
      setInputValue("/model");
      setMenuState({
        kind: "model",
        selectedIndex: getCurrentModelOptionIndex(
          currentModelId,
          currentProvider,
        ),
      });
      return;
    }

    if (option.id === "provider") {
      if (args && args.length > 0) {
        await saveProviderSelection(args);
        return;
      }

      setError(null);
      setNotice("Choose a provider, or type /provider <provider-id>.");
      setInputValue("/provider");
      setMenuState({
        kind: "provider",
        selectedIndex: getCurrentProviderOptionIndex(currentProvider),
      });
      return;
    }

    if (option.id === "api-key") {
      if (args && args.length > 0) {
        setError(
          "Use the masked prompt for API keys; do not pass keys inline.",
        );
        return;
      }

      setError(null);
      setNotice(`Paste your ${getProviderLabel(currentProvider)} API key.`);
      setSecretInputMode({
        envKey: getProviderApiKeyEnvKey(currentProvider),
        kind: "api-key",
        label: `${getProviderLabel(currentProvider)} API key`,
        provider: currentProvider,
      });
      setInputState({ cursorPosition: 0, value: "" });
      setMenuState({ kind: "none" });
      return;
    }

    if (option.id === "langsmith-key") {
      if (args && args.length > 0) {
        setError(
          "Use the masked prompt for LangSmith keys; do not pass keys inline.",
        );
        return;
      }

      setError(null);
      setNotice("Paste your LangSmith API key, or press Enter empty to clear.");
      setSecretInputMode({
        envKey: "LANGSMITH_API_KEY",
        kind: "langsmith-key",
        label: "LangSmith API key",
      });
      setInputState({ cursorPosition: 0, value: "" });
      setMenuState({ kind: "none" });
      return;
    }

    if (option.id === "init" || option.id === "update") {
      resetInput();
      onCommandRun(option.id, args);
      return;
    }

    if (option.id === "clear") {
      resetInput();
      onClear();
      setNotice("Started a new chat thread.");
      return;
    }

    if (option.id === "help") {
      resetInput();
      setNotice(
        "Slash commands: /provider, /model, /api-key, /langsmith-key, /init, /update, /clear, /help, /exit. Use arrows to select.",
      );
      return;
    }

    resetInput();
    onSubmit("/exit");
  }

  async function selectModelMenuOption(selectedIndex: number) {
    const option = getModelMenuOptions(currentModelId, currentProvider)[
      selectedIndex
    ];

    if (!option) {
      setError("Select a model.");
      return;
    }

    if (option.kind === "custom") {
      setError(null);
      setNotice("Type a custom model ID after /model.");
      setInputValue("/model ");
      return;
    }

    await saveModelSelection(option.modelId);
  }

  async function saveModelSelection(rawModelId: string) {
    const modelId = normalizeModelId(rawModelId);

    if (!isValidModelId(modelId)) {
      setError("Enter a valid model ID.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await onModelSelect(modelId);
      resetInput();
      setNotice(`Model switched to ${modelId}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save model selection.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function selectProviderMenuOption(selectedIndex: number) {
    const provider = SELECTABLE_OPENWIKI_PROVIDERS[selectedIndex];

    if (!provider) {
      setError("Select a provider.");
      return;
    }

    await saveProviderSelection(provider);
  }

  async function saveProviderSelection(rawProvider: string) {
    const provider = normalizeProvider(rawProvider);

    if (provider === null) {
      setError(
        "Enter a valid provider: openai, openrouter, baseten, fireworks, nvidia, or anthropic.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await onProviderSelect(provider);
      resetInput();
      setNotice(
        `Provider switched to ${getProviderLabel(provider)} with model ${getDefaultModelId(
          provider,
        )}. Ensure ${getProviderApiKeyEnvKey(provider)} is set.`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save provider selection.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSecretInput() {
    if (secretInputMode === null) {
      return;
    }

    const nextValue = input.trim();
    if (secretInputMode.kind === "api-key" && nextValue.length === 0) {
      setError(`${secretInputMode.envKey} is required.`);
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (secretInputMode.kind === "langsmith-key") {
        await saveOpenWikiEnv({
          LANGCHAIN_PROJECT: nextValue.length > 0 ? "openwiki" : "",
          LANGCHAIN_TRACING_V2: nextValue.length > 0 ? "true" : "false",
          LANGSMITH_API_KEY: nextValue,
        });
      } else {
        await saveOpenWikiEnv({
          [secretInputMode.envKey]: nextValue,
        });
      }

      const savedLabel = secretInputMode.label;
      resetInput();
      setSecretInputMode(null);
      setNotice(`${savedLabel} saved.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save credential.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function resetInput() {
    setInputState({ cursorPosition: 0, value: "" });
    setMenuState({ kind: "none" });
    setError(null);
  }

  function setInputValue(value: string) {
    setInputState({
      cursorPosition: value.length,
      value,
    });
  }

  const beforeCursor = input.slice(0, cursorPosition);
  const afterCursor = input.slice(cursorPosition);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text>
          <Text color="blue">{">"}</Text>{" "}
          {secretInputMode !== null ? (
            <>
              <Text color="gray">{secretInputMode.envKey}=</Text>
              <Text color="yellow">{formatSecretInputSummary(input)}</Text>
            </>
          ) : input.length > 0 ? (
            <>
              {beforeCursor}
              <InputCursor />
              {afterCursor}
            </>
          ) : (
            <>
              <InputCursor />
              <Text color="gray"> Ask a follow-up...</Text>
            </>
          )}
        </Text>
      </Box>
      <Text>
        <Text color="gray">
          {secretInputMode !== null
            ? "enter to save - esc to cancel - input is masked"
            : `enter to send - / for commands - /exit to quit - cwd ${formatCwd(
                process.cwd(),
              )}`}
        </Text>
      </Text>
      {secretInputMode !== null ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">{secretInputMode.label}</Text>
          <Text>
            Saving to <Text color="cyan">{secretInputMode.envKey}</Text>
          </Text>
          {secretInputMode.kind === "langsmith-key" ? (
            <Text color="gray">Press Enter empty to clear LangSmith.</Text>
          ) : null}
        </Box>
      ) : menuState.kind !== "none" ? (
        <SlashMenu
          currentModelId={currentModelId}
          currentProvider={currentProvider}
          input={input}
          menuState={menuState}
        />
      ) : null}
      {notice ? <Text color="green">{notice}</Text> : null}
      {isSaving ? <Text color="gray">Saving selection...</Text> : null}
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}

/**
 * The controlled input's current value and cursor position.
 */
interface ChatInputState {
  cursorPosition: number;
  value: string;
}

/**
 * Active secret-entry mode: which credential is being typed, so the input masks
 * it and saves it to the right env key.
 */
interface SecretInputMode {
  envKey: string;
  kind: "api-key" | "langsmith-key";
  label: string;
  provider?: OpenWikiProvider;
}

type ChatInputMenuState =
  | { kind: "commands"; selectedIndex: number }
  | { kind: "model"; selectedIndex: number }
  | { kind: "provider"; selectedIndex: number }
  | { kind: "none" };

type SlashCommandId =
  | "api-key"
  | "clear"
  | "exit"
  | "help"
  | "init"
  | "langsmith-key"
  | "model"
  | "provider"
  | "update";

/**
 * One entry in the slash-command menu.
 */
interface SlashCommandOption {
  description: string;
  id: SlashCommandId;
  label: string;
}

type ModelMenuOption =
  | {
      kind: "model";
      label: string;
      modelId: string;
    }
  | {
      kind: "custom";
      label: string;
    };

const slashCommandOptions: SlashCommandOption[] = [
  {
    description: "Switch the model provider",
    id: "provider",
    label: "/provider",
  },
  {
    description: "Switch the current provider model",
    id: "model",
    label: "/model",
  },
  {
    description: "Set the API key for the current provider",
    id: "api-key",
    label: "/api-key",
  },
  {
    description: "Set or clear the LangSmith API key",
    id: "langsmith-key",
    label: "/langsmith-key",
  },
  {
    description: "Run an initial OpenWiki documentation pass",
    id: "init",
    label: "/init",
  },
  {
    description: "Update existing OpenWiki documentation",
    id: "update",
    label: "/update",
  },
  {
    description: "Start a fresh thread and clear chat history",
    id: "clear",
    label: "/clear",
  },
  {
    description: "Show slash command help",
    id: "help",
    label: "/help",
  },
  {
    description: "Exit OpenWiki",
    id: "exit",
    label: "/exit",
  },
];

function SlashMenu({
  currentModelId,
  currentProvider,
  input,
  menuState,
}: {
  currentModelId: string;
  currentProvider: OpenWikiProvider;
  input: string;
  menuState: Exclude<ChatInputMenuState, { kind: "none" }>;
}) {
  if (menuState.kind === "model") {
    const modelOptions = getModelMenuOptions(currentModelId, currentProvider);

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Models for {getProviderLabel(currentProvider)}</Text>
        {modelOptions.map((option, index) => (
          <MenuRow
            description={
              option.kind === "model" && option.modelId === currentModelId
                ? "current"
                : option.kind === "custom"
                  ? "type /model <model-id>"
                  : ""
            }
            isSelected={index === menuState.selectedIndex}
            key={option.label}
            label={option.label}
          />
        ))}
        {input.startsWith("/model ") ? (
          <Text color="gray">Press enter to save the custom model ID.</Text>
        ) : (
          <Text color="gray">Use arrows, enter to select, esc to cancel.</Text>
        )}
      </Box>
    );
  }

  if (menuState.kind === "provider") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Providers</Text>
        {SELECTABLE_OPENWIKI_PROVIDERS.map((provider, index) => (
          <MenuRow
            description={
              provider === currentProvider
                ? "current"
                : `default model ${getDefaultModelId(provider)}`
            }
            isSelected={index === menuState.selectedIndex}
            key={provider}
            label={getProviderLabel(provider)}
          />
        ))}
        <Text color="gray">Use arrows, enter to select, esc to cancel.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">Commands</Text>
      {slashCommandOptions.map((option, index) => (
        <MenuRow
          description={option.description}
          isSelected={index === menuState.selectedIndex}
          key={option.id}
          label={option.label}
        />
      ))}
      <Text color="gray">Use arrows, enter to select, esc to cancel.</Text>
    </Box>
  );
}

function MenuRow({
  description,
  isSelected,
  label,
}: {
  description: string;
  isSelected: boolean;
  label: string;
}) {
  return (
    <Text>
      <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? ">" : " "}</Text>{" "}
      <Text bold={isSelected}>{label.padEnd(28)}</Text>
      <Text color="gray">{description}</Text>
    </Text>
  );
}

function moveInputCursor(
  state: ChatInputState,
  offset: number,
): ChatInputState {
  return {
    ...state,
    cursorPosition: clampCursorPosition(
      state.cursorPosition + offset,
      state.value,
    ),
  };
}

function deleteBeforeInputCursor(state: ChatInputState): ChatInputState {
  if (state.cursorPosition === 0) {
    return state;
  }

  return {
    cursorPosition: state.cursorPosition - 1,
    value: `${state.value.slice(0, state.cursorPosition - 1)}${state.value.slice(
      state.cursorPosition,
    )}`,
  };
}

function deleteAtInputCursor(state: ChatInputState): ChatInputState {
  if (state.cursorPosition >= state.value.length) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursorPosition)}${state.value.slice(
      state.cursorPosition + 1,
    )}`,
  };
}

function applyRawInputValue(
  state: ChatInputState,
  inputValue: string,
): ChatInputState {
  let nextState = state;

  for (let index = 0; index < inputValue.length; index += 1) {
    if (inputValue.startsWith("\u001b[D", index)) {
      nextState = moveInputCursor(nextState, -1);
      index += 2;
      continue;
    }

    if (inputValue.startsWith("\u001b[C", index)) {
      nextState = moveInputCursor(nextState, 1);
      index += 2;
      continue;
    }

    if (inputValue.startsWith("\u001b[3~", index)) {
      nextState = deleteAtInputCursor(nextState);
      index += 3;
      continue;
    }

    if (
      inputValue.startsWith("\u007f", index) ||
      inputValue.startsWith("\b", index)
    ) {
      nextState = deleteBeforeInputCursor(nextState);
      continue;
    }

    if (
      inputValue.startsWith("\u001b[A", index) ||
      inputValue.startsWith("\u001b[B", index)
    ) {
      index += 2;
      continue;
    }

    const character = inputValue[index];

    if (isControlCharacter(character)) {
      continue;
    }

    nextState = insertAtInputCursor(nextState, character);
  }

  return nextState;
}

function insertAtInputCursor(
  state: ChatInputState,
  character: string,
): ChatInputState {
  return {
    cursorPosition: state.cursorPosition + character.length,
    value: `${state.value.slice(0, state.cursorPosition)}${character}${state.value.slice(
      state.cursorPosition,
    )}`,
  };
}

function clampCursorPosition(position: number, value: string): number {
  return Math.max(0, Math.min(value.length, position));
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);

  return codePoint !== undefined && codePoint < 32;
}

function isRawBackspaceInput(inputValue: string): boolean {
  return inputValue === "\u007f" || inputValue === "\b";
}

function isEscapeInput(
  inputValue: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
): boolean {
  return key.escape || inputValue === "\u001b";
}

function syncMenuStateForInput(
  input: string,
  currentState: ChatInputMenuState,
  currentModelId: string,
  currentProvider: OpenWikiProvider,
): ChatInputMenuState {
  if (input.startsWith("/provider")) {
    const selectedIndex =
      currentState.kind === "provider"
        ? currentState.selectedIndex
        : getCurrentProviderOptionIndex(currentProvider);

    return {
      kind: "provider",
      selectedIndex: clampMenuIndex(
        selectedIndex,
        SELECTABLE_OPENWIKI_PROVIDERS.length,
      ),
    };
  }

  if (input.startsWith("/model")) {
    const selectedIndex =
      currentState.kind === "model"
        ? currentState.selectedIndex
        : getCurrentModelOptionIndex(currentModelId, currentProvider);

    return {
      kind: "model",
      selectedIndex: clampMenuIndex(
        selectedIndex,
        getModelMenuOptions(currentModelId, currentProvider).length,
      ),
    };
  }

  if (input.startsWith("/")) {
    const selectedIndex =
      currentState.kind === "commands"
        ? currentState.selectedIndex
        : getCommandOptionIndex(input);

    return {
      kind: "commands",
      selectedIndex: clampMenuIndex(selectedIndex, slashCommandOptions.length),
    };
  }

  return { kind: "none" };
}

function moveMenuSelection(
  menuState: ChatInputMenuState,
  offset: number,
  currentModelId: string,
  currentProvider: OpenWikiProvider,
): ChatInputMenuState {
  if (menuState.kind === "none") {
    return menuState;
  }

  const itemCount =
    menuState.kind === "model"
      ? getModelMenuOptions(currentModelId, currentProvider).length
      : menuState.kind === "provider"
        ? SELECTABLE_OPENWIKI_PROVIDERS.length
        : slashCommandOptions.length;

  return {
    ...menuState,
    selectedIndex: wrapMenuIndex(menuState.selectedIndex + offset, itemCount),
  };
}

function getCommandOptionIndex(input: string): number {
  const matchingIndex = slashCommandOptions.findIndex((option) =>
    option.label.startsWith(input),
  );

  return matchingIndex === -1 ? 0 : matchingIndex;
}

function getCurrentModelOptionIndex(
  currentModelId: string,
  currentProvider: OpenWikiProvider,
): number {
  const matchingIndex = getModelMenuOptions(
    currentModelId,
    currentProvider,
  ).findIndex(
    (option) => option.kind === "model" && option.modelId === currentModelId,
  );

  return matchingIndex === -1 ? 0 : matchingIndex;
}

function getCurrentProviderOptionIndex(
  currentProvider: OpenWikiProvider,
): number {
  const matchingIndex = SELECTABLE_OPENWIKI_PROVIDERS.findIndex(
    (provider) => provider === currentProvider,
  );

  return matchingIndex === -1 ? 0 : matchingIndex;
}

function getModelMenuOptions(
  currentModelId: string,
  currentProvider: OpenWikiProvider,
): ModelMenuOption[] {
  const modelIds = Array.from(
    new Set(
      [
        currentModelId,
        ...getProviderModelOptions(currentProvider).map((model) => model.id),
      ].filter(Boolean),
    ),
  );

  return [
    ...modelIds.map((modelId) => {
      const preset = getProviderModelOptions(currentProvider).find(
        (model) => model.id === modelId,
      );

      return {
        kind: "model" as const,
        label: preset ? `${preset.label} ${modelId}` : modelId,
        modelId,
      };
    }),
    {
      kind: "custom" as const,
      label: "Custom model ID",
    },
  ];
}

function parseSlashInput(
  input: string,
): { args: string; option: SlashCommandOption } | null {
  const trimmedInput = input.trim();
  const [commandName = "", ...args] = trimmedInput.split(/\s+/u);
  const option = slashCommandOptions.find(
    (commandOption) => commandOption.label === commandName,
  );

  return option ? { args: args.join(" "), option } : null;
}

function isMenuUpInput(
  inputValue: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
): boolean {
  return key.upArrow || inputValue === "\u001b[A";
}

function isMenuDownInput(
  inputValue: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
): boolean {
  return key.downArrow || inputValue === "\u001b[B";
}

function clampMenuIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(Math.max(0, itemCount - 1), index));
}

function wrapMenuIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return ((index % itemCount) + itemCount) % itemCount;
}

function InputCursor() {
  return <Text color="cyan">|</Text>;
}

function formatSecretInputSummary(value: string): string {
  return value.length === 0 ? "[empty]" : `[hidden, ${value.length} chars]`;
}
