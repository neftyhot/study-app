/** A deck's study guide, as the desktop generated it, with its citations. */
import type { SqlDriver } from "@megan/core/platform/types";
import type { CitedSentence, CounterExample } from "@megan/core/primer/types";

import { json } from "./db";

export type GuideSection = {
  id: string;
  conceptName: string;
  definition: CitedSentence[];
  breakdown: CitedSentence[];
  example: CitedSentence[];
  counterExample: CounterExample | null;
};

export type GuideTopic = { id: string | null; title: string; intro: string; sections: GuideSection[] };

export type Guide = { id: string; overview: string | null; format: string; topics: GuideTopic[] };

/** Strings from an older or hand-made deck become uncited sentences. */
function sentences(raw: unknown): CitedSentence[] {
  const list = json<unknown[]>(raw, []);
  return list.flatMap((item): CitedSentence[] => {
    if (typeof item === "string") {
      return [{ text: item, source_document_index: null, source_slide_number: null, source_excerpt: null }];
    }
    if (item && typeof item === "object" && typeof (item as CitedSentence).text === "string") {
      return [item as CitedSentence];
    }
    return [];
  });
}

/** The newest guide for a deck, or null when it has none. */
export async function loadGuide(db: SqlDriver, examId: string): Promise<Guide | null> {
  const [guide] = await db.all<{ id: string; overview: string | null; format: string }>(
    "SELECT id, overview, format FROM primer_guides WHERE exam_id = ? ORDER BY created_at DESC LIMIT 1",
    [examId],
  );
  if (!guide) return null;

  const topics = await db.all<{ id: string; title: string; intro: string }>(
    "SELECT id, title, intro FROM primer_topics WHERE guide_id = ? ORDER BY order_index ASC",
    [guide.id],
  );
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, topic_id, concept_name, definition, breakdown, example, counter_example
     FROM primer_sections WHERE guide_id = ? ORDER BY order_index ASC`,
    [guide.id],
  );

  const byTopic = new Map<string | null, GuideSection[]>();
  for (const row of rows) {
    const section: GuideSection = {
      id: row.id as string,
      conceptName: row.concept_name as string,
      definition: sentences(row.definition),
      breakdown: sentences(row.breakdown),
      example: sentences(row.example),
      counterExample: json<CounterExample | null>(row.counter_example, null),
    };
    const key = (row.topic_id as string | null) ?? null;
    byTopic.set(key, [...(byTopic.get(key) ?? []), section]);
  }

  const result: GuideTopic[] = topics.map((topic) => ({ ...topic, sections: byTopic.get(topic.id) ?? [] }));
  // Older guides have sections with no topic; they are shown as one untitled group.
  const loose = byTopic.get(null);
  if (loose?.length) result.unshift({ id: null, title: "", intro: "", sections: loose });

  return { id: guide.id, overview: guide.overview, format: guide.format, topics: result };
}

/** "Slideshow 2 · Slide 14", or null for connective prose. */
export function citationLabel(sentence: CitedSentence): string | null {
  if (sentence.source_slide_number == null) return null;
  const doc = sentence.source_document_index;
  return doc == null ? `Slide ${sentence.source_slide_number}` : `Slideshow ${doc} · Slide ${sentence.source_slide_number}`;
}
