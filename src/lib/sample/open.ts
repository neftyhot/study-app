/**
 * The bundled sample deck, added to the student's library the first time they
 * ask for it and reused after that — opening it twice never makes two copies.
 * A student who deleted it gets a fresh one.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { exams, primerGuides } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";

import { SAMPLE_DECK, SAMPLE_ORIGIN } from "./memory-deck";

export function findSampleDeck(db: Db): string | null {
  const row = db
    .select({ examId: primerGuides.examId })
    .from(primerGuides)
    .innerJoin(exams, eq(exams.id, primerGuides.examId))
    .where(eq(primerGuides.model, SAMPLE_ORIGIN))
    .get();
  return row?.examId ?? null;
}

/** The sample deck's exam id, adding it first if it is not there. */
export function ensureSampleDeck(db: Db): string {
  return findSampleDeck(db) ?? insertDeck(db, SAMPLE_DECK);
}
