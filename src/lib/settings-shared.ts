/**
 * Settings shapes and labels, with no database behind them.
 *
 * Client components need the provider names and the download shape; importing
 * those from the server module would drag better-sqlite3 into the browser
 * bundle. This file is the half that is safe to share.
 */
export const PROVIDERS = ["local", "gemini", "anthropic", "openai"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type ApiProviderId = Exclude<ProviderId, "local">;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  local: "Offline model on this device",
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
};

export type DownloadState = {
  modelId: string;
  status: "downloading" | "ready" | "failed";
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  path?: string;
};

export type KeyStatus = {
  provider: ApiProviderId;
  present: boolean;
  /** Last four characters, so a student can tell which key is saved. */
  hint: string | null;
  fromEnvironment: boolean;
};
