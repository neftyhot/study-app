"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { GEMINI_KEY, geminiKeyStatus, writeSetting } from "@/lib/settings";

/**
 * Saves the Gemini key locally.
 *
 * The key is never read back to the browser — the settings screen is told only
 * that one exists and how it ends, which is enough to tell two keys apart
 * without putting either in a page.
 */
export async function saveGeminiKey(key: string) {
  writeSetting(GEMINI_KEY, key, db);
  revalidatePath("/settings");
  return geminiKeyStatus(db);
}

export async function clearGeminiKey() {
  writeSetting(GEMINI_KEY, "", db);
  revalidatePath("/settings");
  return geminiKeyStatus(db);
}
