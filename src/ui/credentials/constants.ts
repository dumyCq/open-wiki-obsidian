/**
 * The schedule-step menu: accept the suggested cron, or enter a custom one.
 */
export const CRON_MODE_OPTIONS = [
  "Use suggested schedule",
  "Enter custom cron",
] as const;

/**
 * The power-management menu (macOS): configure a wake/sleep window, or skip it.
 */
export const POWER_MODE_OPTIONS = [
  "Set up Mac wake/sleep window",
  "Skip power setup",
] as const;

/**
 * The source-menu continuation options when at least one source is configured.
 */
export const SOURCE_CONTINUE_OPTIONS = [
  "Go back to connections",
  "Continue without all sources",
] as const;

/**
 * The code-mode repository confirmation options: accept the detected repo, or
 * edit the path.
 */
export const CODE_REPO_OPTIONS = ["Confirm and continue", "Edit path"] as const;
