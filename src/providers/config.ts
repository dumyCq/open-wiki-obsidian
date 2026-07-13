import {
  ANTHROPIC_API_KEY_ENV_KEY,
  ANTHROPIC_BASE_URL_ENV_KEY,
  BASETEN_API_KEY_ENV_KEY,
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_RETRY_ATTEMPTS,
  FIREWORKS_API_KEY_ENV_KEY,
  NVIDIA_API_KEY_ENV_KEY,
  OPENAI_API_KEY_ENV_KEY,
  OPENAI_CHATGPT_ACCESS_TOKEN_ENV_KEY,
  OPENAI_COMPATIBLE_API_KEY_ENV_KEY,
  OPENAI_COMPATIBLE_BASE_URL_ENV_KEY,
  OPENROUTER_API_KEY_ENV_KEY,
  OPENROUTER_BASE_URL,
  OPENWIKI_PROVIDER_ENV_KEY,
  OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY,
} from "../constants.js";

/**
 * Every provider OpenWiki can use for inference, by its internal id.
 */
export type OpenWikiProvider =
  | "anthropic"
  | "baseten"
  | "fireworks"
  | "nvidia"
  | "openai"
  | "openai-chatgpt"
  | "openai-compatible"
  | "openrouter";

/**
 * How a provider authenticates. Providers default to `"api-key"` (a pasted
 * secret persisted to a `*_API_KEY` env var); `"oauth"` providers instead run a
 * browser login flow and persist short-lived access/refresh tokens.
 */
export type ProviderAuthMethod = "api-key" | "oauth";

/**
 * The subset of providers offered in the setup wizard (currently all of them).
 */
export type SelectableOpenWikiProvider = OpenWikiProvider;

/**
 * A selectable model for a provider: the wire `id` and its display `label`.
 */
export interface ProviderModelOption {
  /**
   * The model id sent to the provider API (e.g. `claude-sonnet-5`).
   */
  id: string;

  /**
   * The human-facing name shown in the setup wizard (e.g. `Sonnet`).
   */
  label: string;
}

/**
 * Model options offered by OpenAI. Shared by the `openai` (API key) and
 * `openai-chatgpt` (OAuth login) providers so the two always expose an
 * identical model list.
 */
const OPENAI_MODEL_OPTIONS: ProviderModelOption[] = [
  { id: "gpt-5.6-terra", label: "5.6 Terra" },
  { id: "gpt-5.6-luna", label: "5.6 Luna" },
  { id: "gpt-5.6-sol", label: "5.6 Sol" },
  { id: "gpt-5.5", label: "5.5" },
  { id: "gpt-5.4-mini", label: "5.4 mini" },
];

/**
 * Static configuration for one provider: how it authenticates, its endpoint,
 * and the models it offers.
 */
interface ProviderConfig {
  apiKeyEnvKey: string;
  /**
   * Authentication method for the provider. Omitted entries are implicitly
   * {@link ProviderAuthMethod} `"api-key"`. `"oauth"` providers replace the
   * pasted-key setup step with a browser login and store tokens instead.
   */
  authMethod?: ProviderAuthMethod;
  baseURL?: string;
  /**
   * Environment variable that, when set, overrides {@link ProviderConfig.baseURL}
   * with an alternative base URL (e.g. a self-hosted or proxied endpoint).
   */
  baseUrlEnvKey?: string;
  /**
   * When true, the provider has no default endpoint and requires a base URL to
   * be supplied via {@link ProviderConfig.baseUrlEnvKey}.
   */
  requiresBaseUrl?: boolean;
  label: string;
  modelOptions: ProviderModelOption[];
}

/**
 * Providers offered in the setup wizard, in display order.
 */
export const SELECTABLE_OPENWIKI_PROVIDERS = [
  "openai",
  "openai-chatgpt",
  "anthropic",
  "openrouter",
  "openai-compatible",
  "fireworks",
  "baseten",
  "nvidia",
] as const satisfies readonly SelectableOpenWikiProvider[];

/**
 * The provider registry: static configuration for every {@link OpenWikiProvider}.
 */
export const PROVIDER_CONFIGS: Record<OpenWikiProvider, ProviderConfig> = {
  baseten: {
    apiKeyEnvKey: BASETEN_API_KEY_ENV_KEY,
    baseURL: "https://inference.baseten.co/v1",
    label: "Baseten",
    modelOptions: [
      { id: "zai-org/GLM-5.2", label: "GLM 5.2" },
      { id: "moonshotai/Kimi-K2.7-Code", label: "Kimi K2.7 Code" },
    ],
  },
  fireworks: {
    apiKeyEnvKey: FIREWORKS_API_KEY_ENV_KEY,
    baseURL: "https://api.fireworks.ai/inference/v1",
    label: "Fireworks",
    modelOptions: [
      { id: "accounts/fireworks/models/glm-5p2", label: "GLM 5.2" },
      {
        id: "accounts/fireworks/models/kimi-k2p7-code",
        label: "Kimi K2.7 Code",
      },
    ],
  },
  nvidia: {
    apiKeyEnvKey: NVIDIA_API_KEY_ENV_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
    label: "NVIDIA NIM",
    modelOptions: [
      {
        id: "nvidia/nemotron-3-super-120b-a12b",
        label: "Nemotron 3 Super 120B A12B",
      },
      {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        label: "Nemotron 3 Ultra 550B A55B",
      },
      {
        id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        label: "Nemotron 3 Nano Omni 30B A3B",
      },
      { id: "deepseek-ai/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
    ],
  },
  openai: {
    apiKeyEnvKey: OPENAI_API_KEY_ENV_KEY,
    label: "OpenAI",
    modelOptions: OPENAI_MODEL_OPTIONS,
  },
  "openai-chatgpt": {
    apiKeyEnvKey: OPENAI_CHATGPT_ACCESS_TOKEN_ENV_KEY,
    authMethod: "oauth",
    label: "OpenAI (ChatGPT login)",
    modelOptions: OPENAI_MODEL_OPTIONS,
  },
  "openai-compatible": {
    apiKeyEnvKey: OPENAI_COMPATIBLE_API_KEY_ENV_KEY,
    baseUrlEnvKey: OPENAI_COMPATIBLE_BASE_URL_ENV_KEY,
    requiresBaseUrl: true,
    label: "OpenAI-compatible",
    modelOptions: [],
  },
  anthropic: {
    apiKeyEnvKey: ANTHROPIC_API_KEY_ENV_KEY,
    baseUrlEnvKey: ANTHROPIC_BASE_URL_ENV_KEY,
    label: "Anthropic",
    modelOptions: [
      { id: "claude-haiku-4-5", label: "Haiku" },
      { id: "claude-sonnet-5", label: "Sonnet" },
      { id: "claude-opus-4-8", label: "Opus" },
    ],
  },
  openrouter: {
    apiKeyEnvKey: OPENROUTER_API_KEY_ENV_KEY,
    baseURL: OPENROUTER_BASE_URL,
    label: "OpenRouter",
    modelOptions: [
      { id: "z-ai/glm-5.2", label: "GLM 5.2" },
      { id: "openrouter/fusion", label: "OpenRouter Fusion" },
      { id: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code" },
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet" },
      { id: "openai/gpt-5.4-mini", label: "GPT 5.4 mini" },
      { id: "openai/gpt-5.5", label: "GPT 5.5" },
    ],
  },
};

/**
 * The default provider's first model id, used as a last-resort fallback.
 */
export const DEFAULT_MODEL_ID =
  PROVIDER_CONFIGS[DEFAULT_PROVIDER].modelOptions[0]?.id ?? "gpt-5.6-terra";

/**
 * The default provider's model ids, offered as suggestions in the wizard.
 */
export const SUGGESTED_MODEL_IDS = PROVIDER_CONFIGS[
  DEFAULT_PROVIDER
].modelOptions.map((model) => model.id);

/**
 * Returns the static configuration for a provider.
 */
export function getProviderConfig(provider: OpenWikiProvider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

/**
 * The provider's human-facing display label.
 */
export function getProviderLabel(provider: OpenWikiProvider): string {
  return getProviderConfig(provider).label;
}

/**
 * The env var that holds the provider's API key (or OAuth access token).
 */
export function getProviderApiKeyEnvKey(provider: OpenWikiProvider): string {
  return getProviderConfig(provider).apiKeyEnvKey;
}

/**
 * How the provider authenticates, defaulting to `"api-key"` when unspecified.
 */
export function getProviderAuthMethod(
  provider: OpenWikiProvider,
): ProviderAuthMethod {
  return getProviderConfig(provider).authMethod ?? "api-key";
}

/**
 * True when the provider authenticates via a browser OAuth login.
 */
export function providerUsesOAuth(provider: OpenWikiProvider): boolean {
  return getProviderAuthMethod(provider) === "oauth";
}

/**
 * Resolves the base URL for a provider, preferring an alternative base URL from
 * the provider's configured environment variable over the built-in default.
 * Returns `undefined` when neither is set, so callers fall back to the SDK's
 * own default endpoint.
 */
export function resolveProviderBaseUrl(
  provider: OpenWikiProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const config = getProviderConfig(provider);
  const override = config.baseUrlEnvKey ? env[config.baseUrlEnvKey] : undefined;
  const trimmedOverride = override?.trim();

  if (trimmedOverride) {
    return trimmedOverride;
  }

  return config.baseURL;
}

/**
 * The env var that overrides the provider's base URL, if it has one.
 */
export function getProviderBaseUrlEnvKey(
  provider: OpenWikiProvider,
): string | undefined {
  return getProviderConfig(provider).baseUrlEnvKey;
}

/**
 * True when the provider has no default endpoint, so a base URL must be supplied.
 */
export function providerRequiresBaseUrl(provider: OpenWikiProvider): boolean {
  return getProviderConfig(provider).requiresBaseUrl === true;
}

/**
 * True when the value is a non-empty http(s) URL.
 */
export function isValidBaseUrl(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The models offered by a provider.
 */
export function getProviderModelOptions(
  provider: OpenWikiProvider,
): ProviderModelOption[] {
  return getProviderConfig(provider).modelOptions;
}

/**
 * The provider's first (default) model id, falling back to {@link DEFAULT_MODEL_ID}.
 */
export function getDefaultModelId(provider: OpenWikiProvider): string {
  return getProviderModelOptions(provider)[0]?.id ?? DEFAULT_MODEL_ID;
}

/**
 * Normalizes a raw string to a known provider id (trimmed, lowercased), or
 * `null` when it is absent or unrecognized.
 */
export function normalizeProvider(
  value: string | null | undefined,
): OpenWikiProvider | null {
  if (value === undefined || value === null) {
    return null;
  }

  const provider = value.trim().toLowerCase();

  return isValidProvider(provider) ? provider : null;
}

/**
 * Type guard for a known provider id.
 */
export function isValidProvider(value: string): value is OpenWikiProvider {
  return value in PROVIDER_CONFIGS;
}

/**
 * The order in which an API-key env var implies its provider when
 * `OPENWIKI_PROVIDER` is not set explicitly. The first provider whose key is
 * present wins. OAuth providers are intentionally absent: a stored access token
 * must never silently select a provider; those are only chosen via an explicit
 * `OPENWIKI_PROVIDER`.
 */
const KEY_INFERENCE_ORDER: ReadonlyArray<[envKey: string, OpenWikiProvider]> = [
  [OPENAI_API_KEY_ENV_KEY, "openai"],
  [OPENAI_COMPATIBLE_API_KEY_ENV_KEY, "openai-compatible"],
  [OPENROUTER_API_KEY_ENV_KEY, "openrouter"],
  [ANTHROPIC_API_KEY_ENV_KEY, "anthropic"],
  [BASETEN_API_KEY_ENV_KEY, "baseten"],
  [FIREWORKS_API_KEY_ENV_KEY, "fireworks"],
  [NVIDIA_API_KEY_ENV_KEY, "nvidia"],
];

/**
 * Picks the active provider: an explicit `OPENWIKI_PROVIDER` if set, otherwise
 * inferred from whichever provider API key is present (see
 * {@link KEY_INFERENCE_ORDER}), else the default.
 */
export function resolveConfiguredProvider(
  env: NodeJS.ProcessEnv = process.env,
): OpenWikiProvider {
  const explicit = normalizeProvider(env[OPENWIKI_PROVIDER_ENV_KEY]);

  if (explicit) {
    return explicit;
  }

  const inferred = KEY_INFERENCE_ORDER.find(([envKey]) => env[envKey]);

  return inferred?.[1] ?? DEFAULT_PROVIDER;
}

/**
 * The configured provider retry count from `OPENWIKI_PROVIDER_RETRY_ATTEMPTS`
 * (a positive integer), or the default. Throws on a malformed value.
 */
export function resolveProviderRetryAttempts(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawRetryAttempts = env[OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY];

  if (rawRetryAttempts === undefined) {
    return DEFAULT_PROVIDER_RETRY_ATTEMPTS;
  }

  const retryAttempts = rawRetryAttempts.trim();

  if (!/^[1-9]\d*$/u.test(retryAttempts)) {
    throw new Error(
      `Invalid ${OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY}. Expected a positive integer.`,
    );
  }

  const parsedRetryAttempts = Number(retryAttempts);

  if (!Number.isSafeInteger(parsedRetryAttempts)) {
    throw new Error(
      `Invalid ${OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY}. Expected a positive integer.`,
    );
  }

  return parsedRetryAttempts;
}

/**
 * Trims surrounding whitespace from a model id.
 */
export function normalizeModelId(value: string): string {
  return value.trim();
}

/**
 * True when the value is a well-formed model id: non-empty, at most 120 chars,
 * safe characters only, and not a URL.
 */
export function isValidModelId(value: string): boolean {
  const modelId = normalizeModelId(value);

  return (
    modelId.length > 0 &&
    modelId.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/u.test(modelId) &&
    !modelId.includes("://")
  );
}
