"use server";

import { totalmem } from "node:os";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  clearDownload,
  startModelDownload,
  unloadLocalModel,
} from "@/lib/llm";
import { GRADER_MODEL_ID, LOCAL_MODELS, recommendedModel } from "@/lib/llm/catalog";
import { canGradeLocally, prewarmGrader, unloadLocalGrader } from "@/lib/grade";
import { maybeSendReport } from "@/lib/telemetry";
import {
  allKeyStatuses,
  apiKeyStatus,
  isAnswerable,
  acceptPrivacy,
  markSetupComplete,
  readDownload,
  readGraderDownload,
  readGradingMode,
  readLocalModel,
  readModelTier,
  readProvider,
  writeApiKey,
  writeModelTier,
  writeAppearance,
  writeGradingMode,
  writeGradingStrictness,
  writeProvider,
  writeTheme,
  type ApiProviderId,
  type ProviderId,
} from "@/lib/settings";
import { isModelLevel, type ModelLevel } from "@/lib/llm/tiers";
import { isStrictness } from "@/lib/grade/strictness";
import { isGradingMode, type GradingMode } from "@/lib/settings-shared";

export type SetupSnapshot = {
  provider: ProviderId;
  keys: ReturnType<typeof allKeyStatuses>;
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

export type KeyCheck = "ok" | "invalid" | "unreachable";

/**
 * Asks Google whether a Gemini key works, before it is saved.
 *
 * Lists one model rather than generating anything, so the check itself is
 * free and uses none of the key's quota.
 */
export async function checkGeminiKey(key: string): Promise<KeyCheck> {
  const trimmed = key.trim();
  if (!trimmed) return "invalid";
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      {
        headers: { "x-goog-api-key": trimmed },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) return "ok";
    // 400 API_KEY_INVALID, 401 or 403 (API disabled, key restricted).
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return "invalid";
    }
    return "unreachable";
  } catch {
    return "unreachable";
  }
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

/* ------------------------------------------------ Where answers are checked */

export type GradingSnapshot = {
  mode: GradingMode;
  download: ReturnType<typeof readGraderDownload>;
  /** Enough memory for the grading model; below this the API always grades. */
  capable: boolean;
  totalRamGb: number;
  modelBytes: number;
  /** A provider with a key is set up, so the API can be the backup. */
  apiReady: boolean;
  provider: ProviderId;
};

export async function getGradingSnapshot(): Promise<GradingSnapshot> {
  const model = LOCAL_MODELS.find((entry) => entry.id === GRADER_MODEL_ID);
  return {
    mode: readGradingMode(db),
    download: readGraderDownload(db),
    capable: canGradeLocally(),
    totalRamGb: Math.round(totalmem() / 1_073_741_824),
    modelBytes: model?.bytes ?? 0,
    apiReady: isAnswerable(db),
    provider: readProvider(db),
  };
}

export async function setGradingMode(mode: string) {
  if (!isGradingMode(mode)) return { ok: false as const, error: "Unknown setting." };
  writeGradingMode(mode, db);
  // The cloud does not need the model in memory; give it back.
  if (mode === "cloud") await unloadLocalGrader();
  else void prewarmGrader().catch(() => undefined);
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * Fetches the grading model in the background. Unlike the offline chat model
 * this never changes the provider: a student can grade here and chat in the
 * cloud.
 */
export async function beginGraderDownload() {
  if (!canGradeLocally()) {
    return { started: false as const, reason: "This computer needs 8 GB of memory to check answers itself." };
  }
  const result = startModelDownload(GRADER_MODEL_ID, db, "grader");
  revalidatePath("/settings");
  return result;
}

export async function graderDownloadProgress() {
  return readGraderDownload(db);
}

export async function cancelGraderDownload() {
  clearDownload(db, "grader");
  await unloadLocalGrader();
  revalidatePath("/settings");
}

/**
 * Called when a study screen opens: loads the grading model and caches its
 * prompt so the first Check Answer is already fast. Returns straight away.
 */
export async function prewarmGrading() {
  void prewarmGrader().catch(() => undefined);
  return { ok: true as const };
}
