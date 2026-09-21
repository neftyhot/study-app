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
import {
  allKeyStatuses,
  apiKeyStatus,
  isAnswerable,
  markSetupComplete,
  readDownload,
  readLocalModel,
  readProvider,
  writeApiKey,
  writeGradingStrictness,
  writeProvider,
  type ProviderId,
} from "@/lib/settings";
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
  };
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
