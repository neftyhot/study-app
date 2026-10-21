"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { recordFunnel } from "@/lib/funnel";
import { markSetupComplete } from "@/lib/settings";

import { ensureSampleDeck } from "./open";

/** "Try the sample deck": no key, no upload — straight into studying. */
export async function openSampleDeck() {
  const examId = ensureSampleDeck(db);
  markSetupComplete(db);
  recordFunnel(db, "sample_deck_opened");
  revalidatePath("/", "layout");
  return { examId };
}
