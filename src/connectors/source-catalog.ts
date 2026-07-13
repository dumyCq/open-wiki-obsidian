import {
  OPENWIKI_GOOGLE_CLIENT_ID_ENV_KEY,
  OPENWIKI_GOOGLE_CLIENT_SECRET_ENV_KEY,
  OPENWIKI_TAVILY_API_KEY_ENV_KEY,
  OPENWIKI_X_CLIENT_ID_ENV_KEY,
} from "../constants.js";
import { ONBOARDING_TEMPLATES } from "../onboarding/setup.js";
import type {
  ConnectorId,
  SourceSecretInput,
  SourceSetupOption,
} from "./types.js";

/**
 * The catalog of sources the onboarding wizard can configure, in menu order.
 * Each entry describes how a connector is presented, what it needs to
 * authenticate, and example ingestion goals.
 */
export const SOURCE_OPTIONS = [
  {
    displayName: "Local Git repository",
    examples: [
      "Track architecture notes from this repo.",
      "Summarize recent commits and changed files.",
    ],
    id: "git-repo",
    instructions: [
      "Choose the local repository directory OpenWiki should read.",
      "The default is the current working directory, and you can replace it with another path.",
      "You can add more repositories later in the connector config file.",
    ],
    secretInputs: [],
  },
  {
    authProvider: "notion",
    displayName: "Notion",
    examples: [
      "Ingest product specs, meeting notes, and research pages.",
      "Prioritize pages related to Applied AI and customer feedback.",
    ],
    id: "notion",
    instructions: [
      "OpenWiki uses Notion's hosted MCP OAuth flow.",
      "No client ID, client secret, or pasted Notion token is required.",
      "Approve access in the browser window when it opens.",
    ],
    secretInputs: [],
  },
  {
    authProvider: "gmail",
    displayName: "Gmail",
    examples: [
      "Capture important project email threads from the last 24 hours.",
      "Look for vendor updates, customer feedback, and action items.",
    ],
    id: "google",
    instructions: [
      "Create OAuth credentials in Google Cloud for a desktop or web app.",
      "Enable the Gmail API for the Google Cloud project.",
      "Add http://127.0.0.1:53682/callback as an authorized redirect URI.",
      "Paste the client ID and client secret below.",
    ],
    secretInputs: [
      {
        envKey: OPENWIKI_GOOGLE_CLIENT_ID_ENV_KEY,
        label: "Google OAuth client ID",
      },
      {
        envKey: OPENWIKI_GOOGLE_CLIENT_SECRET_ENV_KEY,
        label: "Google OAuth client secret",
        secret: true,
      },
    ],
  },
  {
    displayName: "Web Search (Tavily)",
    examples: [
      "Track a company, product category, or technical topic.",
      "Find launch posts, docs, pricing pages, and recent articles.",
    ],
    id: "web-search",
    instructions: [
      "Create a Tavily account and API key.",
      "Paste the Tavily API key below.",
      "Describe the topics, companies, or pages OpenWiki should search for on the next screen.",
    ],
    secretInputs: [
      {
        envKey: OPENWIKI_TAVILY_API_KEY_ENV_KEY,
        label: "Tavily API key",
        secret: true,
      },
    ],
  },
  {
    displayName: "Hacker News",
    examples: [
      "Monitor threads about AI agents, evals, infrastructure, and startups.",
      "Capture notable discussions and links related to my research topics.",
    ],
    id: "hackernews",
    instructions: [
      "No account setup is required for Hacker News.",
      "OpenWiki uses public Hacker News feed and search APIs.",
      "Describe the topics, keywords, users, or story types OpenWiki should watch on the next screen.",
    ],
    secretInputs: [],
  },
  {
    authProvider: "x",
    displayName: "X / Twitter",
    examples: [
      "Track my home timeline, bookmarks, and key lists.",
      "Summarize tweets from AI researchers and product announcements.",
    ],
    id: "x",
    instructions: [
      "Create an X OAuth 2.0 app.",
      "Use a native app or public client when possible.",
      "Add http://127.0.0.1:53682/callback as a callback URI.",
      "Paste the OAuth client ID below.",
    ],
    secretInputs: [
      {
        envKey: OPENWIKI_X_CLIENT_ID_ENV_KEY,
        label: "X OAuth client ID",
      },
    ],
  },
] as const satisfies readonly SourceSetupOption[];

/**
 * The catalog entry for a connector, falling back to the first source when the
 * id is not in the catalog.
 */
export function getSourceOption(sourceId: ConnectorId): SourceSetupOption {
  return (
    SOURCE_OPTIONS.find((source) => source.id === sourceId) ?? SOURCE_OPTIONS[0]
  );
}

/**
 * True when a required secret is not yet present in the environment, so the
 * wizard must still prompt for it.
 */
export function needsEnvValue(secretInput: SourceSecretInput): boolean {
  return !process.env[secretInput.envKey];
}

/**
 * The source-menu label for a source, phrased as "Add another …" once at least
 * one instance of it is configured.
 */
export function getSourceMenuLabel(
  source: SourceSetupOption,
  sourceInstanceCount: number,
): string {
  return sourceInstanceCount > 0
    ? `Add another ${source.displayName}`
    : `Add ${source.displayName}`;
}

/**
 * The sources offered for a given onboarding template, falling back to the full
 * catalog when the template names none that exist.
 */
export function getTemplateSourceOptions(
  templateId: string | undefined,
): readonly SourceSetupOption[] {
  const template =
    ONBOARDING_TEMPLATES.find((option) => option.id === templateId) ??
    ONBOARDING_TEMPLATES[0];
  const sourceIds = new Set(template.sourceIds);
  const sourceOptions = SOURCE_OPTIONS.filter((source) =>
    sourceIds.has(source.id),
  );

  return sourceOptions.length > 0 ? sourceOptions : SOURCE_OPTIONS;
}

/**
 * The prompt shown when collecting a source's ingestion goal, tailored to the
 * connector where a specific phrasing reads better.
 */
export function getSourceDescriptionPrompt(source: SourceSetupOption): string {
  if (source.id === "web-search") {
    return "Describe the topics, companies, or pages OpenWiki should search for.";
  }

  if (source.id === "hackernews") {
    return "Describe the topics, keywords, users, or story types OpenWiki should watch on Hacker News.";
  }

  if (source.id === "git-repo") {
    return "Describe what OpenWiki should understand about this repository.";
  }

  return `Describe what OpenWiki should look for in ${source.displayName}.`;
}

/**
 * How many options the source-description step shows: the source's examples
 * plus the custom-entry option.
 */
export function getSourceDescriptionOptionCount(
  source: SourceSetupOption,
): number {
  return source.examples.length + 1;
}

/**
 * The initial static connector config saved for a source, seeded with the
 * user's query. Web search and Hacker News carry feed/search defaults; other
 * connectors start with just `enabled`.
 */
export function getStaticSourceConfig(
  sourceId: ConnectorId,
  query: string,
): Record<string, unknown> {
  const queries = query.trim().length > 0 ? [query.trim()] : [];

  if (sourceId === "web-search") {
    return {
      enabled: true,
      includeAnswer: true,
      includeImages: false,
      includeRawContent: false,
      maxResults: 5,
      queries,
      searchDepth: "basic",
      timeRange: "day",
      topic: "general",
    };
  }

  if (sourceId === "hackernews") {
    return {
      enabled: true,
      feeds: ["top", "new"],
      maxItemsPerFeed: 30,
      maxResultsPerQuery: 20,
      queries,
      queryTags: ["story"],
    };
  }

  return {
    enabled: true,
  };
}
