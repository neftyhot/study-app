"use server";

/** The shared deck catalog. */
import { revalidatePath } from "next/cache";

import {
  addToMyDecks,
  CatalogError,
  getCatalogDeck,
  publishDeck,
  removeListing,
  reportListing,
  updateListing,
  writeCollege,
} from "./store";
import type { PublishInput } from "./types";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof CatalogError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function publishDeckAction(input: PublishInput) {
  const result = await attempt(() => publishDeck(input));
  revalidatePath("/catalog");
  return result;
}

export async function updateListingAction(id: string, fields: Omit<PublishInput, "examId" | "uploader" | "includeGuide">) {
  const result = await attempt(() => updateListing(id, fields));
  revalidatePath("/catalog");
  return result;
}

export async function removeListingAction(id: string) {
  const result = await attempt(() => removeListing(id));
  revalidatePath("/catalog");
  return result;
}

export async function reportListingAction(id: string, reason: string | null) {
  return attempt(() => reportListing(id, reason));
}

export async function getCatalogDeckAction(id: string) {
  return attempt(() => getCatalogDeck(id));
}

export async function addToMyDecksAction(id: string) {
  const result = await attempt(() => addToMyDecks(id));
  revalidatePath("/", "layout");
  return result;
}

export async function setCollegeAction(college: string) {
  const result = await attempt(() => writeCollege(college));
  revalidatePath("/catalog");
  return result;
}
