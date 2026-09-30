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

/**
 * Where Check Answer runs. "local" grades on this computer when the grading
 * model is installed and falls back to the cloud; "cloud" asks the cloud
 * first and falls back to this computer if it is slow.
 */
export type GradingMode = "local" | "cloud";

export function isGradingMode(value: unknown): value is GradingMode {
  return value === "local" || value === "cloud";
}

/**
 * How a flashcard is shown while studying. "classic" is the card with the
 * answer opening beneath the question; "flip" turns the card over in the
 * middle of the page; "stack" deals cards off a pile, to be swiped away.
 */
export const FLASHCARD_FORMATS = ["classic", "flip", "stack"] as const;
export type FlashcardFormat = (typeof FLASHCARD_FORMATS)[number];
export const DEFAULT_FLASHCARD_FORMAT: FlashcardFormat = "classic";

export const FLASHCARD_FORMAT_LABELS: Record<FlashcardFormat, { label: string; blurb: string }> = {
  classic: { label: "Classic", blurb: "The answer opens beneath the question." },
  flip: { label: "Flip card", blurb: "The card turns over in the middle of the page." },
  stack: { label: "Swipe stack", blurb: "Cards come off a pile; swipe right if you knew it, left if you missed it." },
};

export function isFlashcardFormat(value: unknown): value is FlashcardFormat {
  return FLASHCARD_FORMATS.includes(value as FlashcardFormat);
}
