/**
 * The bundled sample deck, as on desktop (src/lib/sample/open.ts): added the
 * first time it is asked for, reused after that, and re-added if deleted.
 */
import type { SqlDriver } from "@megan/core/platform/types";
import { SAMPLE_DECK, SAMPLE_ORIGIN } from "@megan/core/sample/memory-deck";

import { insertDeck } from "./import";

export async function findSampleDeck(db: SqlDriver): Promise<string | null> {
  const [row] = await db.all<{ exam_id: string }>(
    "SELECT g.exam_id FROM primer_guides g JOIN exams e ON e.id = g.exam_id WHERE g.model = ? LIMIT 1",
    [SAMPLE_ORIGIN],
  );
  return row?.exam_id ?? null;
}

export async function ensureSampleDeck(db: SqlDriver): Promise<string> {
  return (await findSampleDeck(db)) ?? insertDeck(db, SAMPLE_DECK);
}
