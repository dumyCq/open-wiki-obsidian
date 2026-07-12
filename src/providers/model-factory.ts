import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";
import {
  CODEX_ORIGINATOR,
  CODEX_RESPONSES_BASE_URL,
  createCodexFetch,
  readCodexTokensFromEnv,
} from "../agent/openai-chatgpt-oauth.js";
import type { OpenWikiRunOptions } from "../agent/types.js";
import {
  getDefaultModelId,
  getProviderApiKeyEnvKey,
  isValidModelId,
  normalizeModelId,
  OPENROUTER_API_KEY_ENV_KEY,
  OPENROUTER_BASE_URL,
  OPENWIKI_MODEL_ID_ENV_KEY,
  resolveProviderBaseUrl,
  type OpenWikiProvider,
} from "../constants.js";

/**
 * Resolves the model id for a run, in precedence order: an explicit run option,
 * the `OPENWIKI_MODEL_ID` env var, then the provider's default. Throws if the
 * resolved id is not a recognized model.
 */
export function resolveModelId(
  options: OpenWikiRunOptions,
  provider: OpenWikiProvider,
): string {
  const rawModelId =
    options.modelId ??
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] ??
    getDefaultModelId(provider);
  const modelId = normalizeModelId(rawModelId);

  if (!isValidModelId(modelId)) {
    throw new Error(
      `Invalid model ID configured in ${OPENWIKI_MODEL_ID_ENV_KEY}.`,
    );
  }

  return modelId;
}

/**
 * Builds the LangChain chat model for a provider. `anthropic`, `openai-chatgpt`
 * (OAuth at the Codex backend), and `openrouter` get bespoke clients; the rest
 * fall through to a shared `ChatOpenAI` with the provider's resolved base URL.
 * OAuth tokens are assumed already refreshed at startup, so this stays sync.
 */
export function createModel(
  provider: OpenWikiProvider,
  modelId: string,
  providerRetryAttempts: number,
) {
  const retryOptions = { maxRetries: providerRetryAttempts };

  if (provider === "anthropic") {
    const baseURL = resolveProviderBaseUrl(provider);

    return new ChatAnthropic(modelId, {
      apiKey: process.env[getProviderApiKeyEnvKey(provider)],
      ...(baseURL ? { anthropicApiUrl: baseURL } : {}),
      ...retryOptions,
    });
  }

  if (provider === "openai-chatgpt") {
    // Already refreshed by `ensureFreshChatGptTokens()` before the run started.
    const tokens = readCodexTokensFromEnv();

    if (!tokens) {
      throw new Error(CHATGPT_LOGIN_INCOMPLETE_MESSAGE);
    }

    // Reuse LangChain's existing ChatOpenAI Responses-API integration (correct
    // tool-calling + SSE parsing for DeepAgents) pointed at the Codex backend:
    // - useResponsesApi routes to POST {baseURL}/responses
    // - zdrEnabled forces `store: false`, which the Codex backend requires
    // - defaultHeaders carry the account id / originator / beta header
    return new ChatOpenAI({
      apiKey: tokens.access,
      model: modelId,
      useResponsesApi: true,
      zdrEnabled: true,
      // The Codex backend rejects non-streaming requests
      // ("Stream must be set to true"), so force the streaming transport for
      // every generation — including the non-streaming `.invoke()` calls
      // DeepAgents' agent node issues internally.
      streaming: true,
      ...retryOptions,
      configuration: {
        baseURL: CODEX_RESPONSES_BASE_URL,
        defaultHeaders: {
          "chatgpt-account-id": tokens.accountId,
          originator: CODEX_ORIGINATOR,
          "OpenAI-Beta": "responses=experimental",
        },
        fetch: createCodexFetch(modelId),
      },
    });
  }

  if (provider === "openrouter") {
    return new ChatOpenRouter({
      apiKey: process.env[OPENROUTER_API_KEY_ENV_KEY],
      baseURL: OPENROUTER_BASE_URL,
      model: modelId,
      siteName: "OpenWiki",
      ...retryOptions,
    });
  }

  const baseURL = resolveProviderBaseUrl(provider);

  return new ChatOpenAI({
    apiKey: process.env[getProviderApiKeyEnvKey(provider)],
    configuration: baseURL
      ? {
          baseURL,
        }
      : undefined,
    model: modelId,
    useResponsesApi: provider === "openai",
    ...retryOptions,
  });
}

/**
 * Shown when the ChatGPT OAuth provider is selected but no usable token is
 * stored. Thrown by {@link createModel} and by the startup token refresh.
 */
export const CHATGPT_LOGIN_INCOMPLETE_MESSAGE =
  "ChatGPT login is incomplete. Run `openwiki code --init` or `openwiki personal --init` to sign in with your ChatGPT account.";
