/**
 * Transient state the setup wizard tracks while configuring a single source:
 * its in-flight OAuth flow, the connector config being assembled, and the
 * secrets collected so far.
 */
export interface SourceSetupState {
  /**
   * The pending OAuth authorization URL, present while a connector login is in
   * flight; absent when the source needs no OAuth or none is underway.
   */
  authUrl?: string;

  /**
   * The connector config assembled so far for the source being added; absent
   * until building begins.
   */
  connectorConfig?: Record<string, unknown>;

  /**
   * Whether the authorization URL has been copied to the clipboard; absent
   * means it has not.
   */
  copiedAuthUrlToClipboard?: boolean;

  /**
   * A warning to surface when saving the schedule only partially succeeded;
   * absent when there is nothing to warn about.
   */
  savedScheduleWarning?: string;

  /**
   * Secret values entered for the source, keyed by their env key.
   */
  secretValues: Record<string, string>;
}
