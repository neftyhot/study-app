"use server";

import { totalmem } from "node:os";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  readGoogleSession,
  type GoogleSessionSummary,
} from "@/lib/auth/google-session";
import {
  clearDownload,
  startModelDownload,
  unloadLocalModel,
} from "@/lib/llm";
import { LOCAL_MODELS, recommendedModel } from "@/lib/llm/catalog";
import { maybeSendReport } from "@/lib/telemetry";
import {
  allKeyStatuses,
  apiKeyStatus,
  isAnswerable,
  acceptPrivacy,
  markSetupComplete,
  readDownload,
  readLocalModel,
  readModelTier,
  readProvider,
  writeApiKey,
  writeModelTier,
  writeAppearance,
  writeGradingStrictness,
  writeProvider,
  writeTheme,
  type ApiProviderId,
  type ProviderId,
} from "@/lib/settings";
import { isModelLevel, type ModelLevel } from "@/lib/llm/tiers";
import { isStrictness } from "@/lib/grade/strictness";

export type SetupSnapshot = {
  provider: ProviderId;
  keys: ReturnType<typeof allKeyStatuses>;
  /** Signed in with Google for Gemini, and as whom. Never a token. */
  google: GoogleSessionSummary | null;
  download: ReturnType<typeof readDownload>;
  localModelId: string | null;
  answerable: boolean;
  /** Installed memory, so the wizard can recommend a size that will run. */
  totalRamGb: number;
  recommendedModelId: string;
  /** Standard or Thinking, for each hosted provider. */
  levels: Record<ApiProviderId, ModelLevel>;
};

export async function getSetupSnapshot(): Promise<SetupSnapshot> {
  const totalRamGb = Math.round(totalmem() / 1_073_741_824);

  return {
    provider: readProvider(db),
    keys: allKeyStatuses(db),
    google: readGoogleSession(db),
    download: readDownload(db),
    localModelId: readLocalModel(db).id,
    answerable: isAnswerable(db),
    totalRamGb,
    recommendedModelId: recommendedModel(totalRamGb).id,
    levels: {
      gemini: readModelTier("gemini", db),
      openai: readModelTier("openai", db),
      anthropic: readModelTier("anthropic", db),
    },
  };
}

export async function setModelLevel(provider: ApiProviderId, level: ModelLevel) {
  if (!isModelLevel(level) || !["gemini", "openai", "anthropic"].includes(provider)) {
    throw new Error("Unknown model choice.");
  }
  writeModelTier(provider, level, db);
  revalidatePath("/settings");
  return getSetupSnapshot();
}

export async function saveApiKey(
  provider: Exclude<ProviderId, "local">,
  key: string,
) {
  writeApiKey(provider, key, db);
  revalidatePath("/settings");
  return apiKeyStatus(provider, db);
}

export async function chooseProvider(provider: ProviderId) {
  writeProvider(provider, db);
  // A different model must not keep answering from the last one's weights.
  if (provider !== "local") await unloadLocalModel();

  revalidatePath("/settings");
  revalidatePath("/");
  return getSetupSnapshot();
}

/**
 * Starts a model download and returns immediately.
 *
 * The wizard does not wait: the student picks a size, this begins, and they
 * carry on into the app while it arrives.
 */
export async function beginModelDownload(modelId: string) {
  if (!LOCAL_MODELS.some((model) => model.id === modelId)) {
    return { started: false as const, reason: "Unknown model." };
  }

  writeProvider("local", db);
  await unloadLocalModel();

  const result = startModelDownload(modelId, db);
  revalidatePath("/settings");
  return result;
}

export async function downloadProgress() {
  return readDownload(db);
}

export async function cancelDownload() {
  clearDownload(db);
  revalidatePath("/settings");
}

export async function finishSetup() {
  markSetupComplete(db);
  revalidatePath("/");
  revalidatePath("/settings");
}

/** How strictly typed answers are marked; applies from the next answer. */
export async function setGradingStrictness(value: string) {
  if (!isStrictness(value)) return { ok: false as const, error: "Unknown setting." };
  writeGradingStrictness(value, db);
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * Agreeing to the privacy policy, which unlocks the app. Usage statistics
 * start from here, so the first report goes straight away.
 */
export async function acceptPrivacyAction() {
  acceptPrivacy(db);
  void maybeSendReport(db, { force: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Colours, corners, text size and the rest; returns what was actually kept. */
export async function saveAppearanceAction(appearance: unknown) {
  const saved = writeAppearance(appearance, db);
  revalidatePath("/", "layout");
  return saved;
}

/**
 * Remembers the chosen style in the database, which the next launch reads
 * before first paint. No revalidation: the page already shows it.
 */
export async function saveThemeAction(theme: unknown) {
  return writeTheme(theme, db);
}
