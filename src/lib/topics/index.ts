/**
 * Broad topics, one small set per source file.
 *
 * Generation names a card's topic batch by batch, and left to itself it names
 * the concept on the slide: "Goiter", "TSH", "Organ of Corti". That is one or
 * two cards a topic — a list of three hundred chips nobody can choose from.
 * What a student actually picks between is the lecture's sections: under the
 * olfactory slides, "Olfactory receptors" and "Olfactory pathway", not a topic
 * per fact.
 *
 * So after a run, each file's topics are folded into a handful of broad ones.
 * The folding is the model's job (it knows "TSH" belongs under "Thyroid");
 * applying it is plain code here, and it only ever renames — a card never
 * moves file, and a topic the model forgot keeps its name.
 */
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import { flashcards, sourceFiles, sourceSlides } from "@/db/schema";
import type { JsonSchema, LlmProvider } from "@/lib/llm";

/** A file with this many topics or fewer is already broad enough... */
export const MAX_TOPICS_PER_FILE = 8;

/** ...unless one of them is this small, which is a fact, not a section. */
export const MIN_CARDS_PER_TOPIC = 3;

/** Whether a file's topics still need folding. */
export function needsRegroup(topics: readonly TopicUsage[], force = false): boolean {
  if (topics.length <= 1) return false;
  if (force || topics.length > MAX_TOPICS_PER_FILE) return true;
  return topics.some((usage) => usage.cards < MIN_CARDS_PER_TOPIC);
}

export const REGROUP_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      description: "Three to eight broad topics that together cover every topic given.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "A broad section heading, 1–4 words, e.g. 'Olfactory system' or 'Thyroid gland'.",
          },
          members: {
            type: "array",
            items: { type: "string" },
            description: "The given topics that belong under it, copied exactly.",
          },
        },
        required: ["name", "members"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

export type RegroupResponse = {
  groups: { name: string; members: string[] }[];
};

export const REGROUP_SYSTEM = `You organise a student's flashcard topics.

You are given the topics used by the flashcards made from ONE lecture file,
with how many cards each has and an example question. Fold them into between
three and ${MAX_TOPICS_PER_FILE} broad topics — the sections a lecturer would put on
a contents slide.

- A broad topic is 1–4 words: "Olfactory system", "Thyroid gland",
  "Spermatogenesis". Not a single fact, hormone or structure.
- Every topic given must appear in exactly one group, copied exactly.
- Where a given topic is already broad, reuse its name for the group.
- Topics that mean the same thing ("Persuasive Messages", "Persuasive
  message pattern") belong in ONE group.
- Never name a group after the whole lecture or file (e.g. "Short Message
  Patterns" for a file of that name): the student already picks the file, so
  a group that repeats it tells them nothing. Split its cards into the real
  sections instead.
- Where a name from OTHER FILES fits, use it exactly as written, so the same
  subject is never spelt two ways across the deck.
- Prefer fewer, larger groups. A group of one or two cards is almost always
  wrong.`;

export type TopicUsage = { topic: string; cards: number; example: string };

/**
 * Old topic → new topic, from the model's grouping.
 *
 * Matching is forgiving about case and spacing, since models retype names;
 * anything the grouping does not mention is left out of the map, which leaves
 * it as it was.
 */
export function renameMap(
  topics: readonly string[],
  groups: RegroupResponse["groups"],
): Map<string, string> {
  const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const byKey = new Map(topics.map((topic) => [key(topic), topic]));
  const renames = new Map<string, string>();

  for (const group of groups) {
    const name = group.name?.trim();
    if (!name) continue;

    for (const member of group.members ?? []) {
      const original = byKey.get(key(member));
      if (original && !renames.has(original) && original !== name) {
        renames.set(original, name);
      }
    }
  }

  return renames;
}

/** Each source file's topics, with enough context for the model to group them. */
export function topicsByFile(db: Db, examId: string) {
  const rows = db
    .select({
      fileId: sourceFiles.id,
      filename: sourceFiles.filename,
      topic: flashcards.topic,
      question: flashcards.question,
    })
    .from(flashcards)
    .innerJoin(sourceSlides, eq(sourceSlides.id, flashcards.sourceSlideId))
    .innerJoin(sourceFiles, eq(sourceFiles.id, sourceSlides.sourceFileId))
    .where(and(eq(flashcards.examId, examId), isNotNull(flashcards.topic)))
    .all();

  const files = new Map<
    string,
    { fileId: string; filename: string; topics: Map<string, TopicUsage> }
  >();

  for (const row of rows) {
    const file = files.get(row.fileId) ?? {
      fileId: row.fileId,
      filename: row.filename,
      topics: new Map(),
    };
    files.set(row.fileId, file);

    const topic = row.topic!;
    const usage = file.topics.get(topic) ?? { topic, cards: 0, example: row.question };
    usage.cards += 1;
    file.topics.set(topic, usage);
  }

  return [...files.values()].map((file) => ({
    ...file,
    topics: [...file.topics.values()],
  }));
}

/** Applies renames to one file's cards only. */
export function applyRenames(
  db: Db,
  fileId: string,
  renames: Map<string, string>,
): number {
  if (renames.size === 0) return 0;

  const slideIds = db
    .select({ id: sourceSlides.id })
    .from(sourceSlides)
    .where(eq(sourceSlides.sourceFileId, fileId))
    .all()
    .map((row) => row.id);
  if (slideIds.length === 0) return 0;

  let changed = 0;
  db.transaction((tx) => {
    for (const [from, to] of renames) {
      changed += tx
        .update(flashcards)
        .set({ topic: to })
        .where(
          and(eq(flashcards.topic, from), inArray(flashcards.sourceSlideId, slideIds)),
        )
        .run().changes;
    }
  });

  return changed;
}

/** Case, spacing and trailing punctuation do not make a topic different. */
export function topicKey(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:;,]+$/, "");
}

/**
 * Spellings of one topic that differ only by case or spacing ("Email
 * communication", "Email Communication"), each mapped to the spelling most
 * cards already use. Ties go to the one sorting first, so the choice is stable.
 */
export function variantRenames(
  usage: readonly { topic: string; cards: number }[],
): Map<string, string> {
  const groups = new Map<string, Map<string, number>>();
  for (const { topic, cards } of usage) {
    const key = topicKey(topic);
    if (!key) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(topic, (spellings.get(topic) ?? 0) + cards);
    groups.set(key, spellings);
  }

  const renames = new Map<string, string>();
  for (const spellings of groups.values()) {
    if (spellings.size < 2) continue;
    const [keep] = [...spellings.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    for (const topic of spellings.keys()) if (topic !== keep) renames.set(topic, keep);
  }
  return renames;
}

/**
 * Gives every spelling of a topic across the exam the same one, so the topic
 * pickers list it once and choosing it takes every card. Plain code and cheap:
 * safe to run whenever topics are listed.
 */
export function mergeTopicVariants(db: Db, examId: string): number {
  const usage = db
    .select({ topic: flashcards.topic, cards: count(flashcards.id) })
    .from(flashcards)
    .where(and(eq(flashcards.examId, examId), isNotNull(flashcards.topic)))
    .groupBy(flashcards.topic)
    .all()
    .map((row) => ({ topic: row.topic!, cards: row.cards }));

  const renames = variantRenames(usage);
  if (renames.size === 0) return 0;

  let changed = 0;
  db.transaction((tx) => {
    for (const [from, to] of renames) {
      changed += tx
        .update(flashcards)
        .set({ topic: to })
        .where(and(eq(flashcards.examId, examId), eq(flashcards.topic, from)))
        .run().changes;
    }
  });
  return changed;
}

export type RegroupResult = { files: number; cardsRenamed: number; topicsBefore: number; topicsAfter: number };

/**
 * Folds every over-split file's topics into a few broad ones.
 *
 * One model call per file that needs it; a file that fails keeps its topics,
 * and the others still go through.
 */
export async function regroupTopics(
  db: Db,
  llm: LlmProvider,
  examId: string,
  options: { force?: boolean } = {},
): Promise<RegroupResult> {
  mergeTopicVariants(db, examId);
  const files = topicsByFile(db, examId);
  const result: RegroupResult = { files: 0, cardsRenamed: 0, topicsBefore: 0, topicsAfter: 0 };

  // Names other files settled on, offered for reuse. Read afresh per file so a
  // name one file just chose is there for the next.
  const elsewhere = (fileId: string) => {
    const names = [
      ...new Set(
        topicsByFile(db, examId)
          .filter((other) => other.fileId !== fileId)
          .flatMap((other) => other.topics.map((usage) => usage.topic)),
      ),
    ].sort();
    return names.length ? `\n\nOTHER FILES' TOPICS\n${names.map((n) => `- ${n}`).join("\n")}` : "";
  };

  for (const file of files) {
    result.topicsBefore += file.topics.length;

    if (!needsRegroup(file.topics, options.force)) {
      result.topicsAfter += file.topics.length;
      continue;
    }

    const list = file.topics
      .map((usage) => `- ${usage.topic} (${usage.cards} card${usage.cards === 1 ? "" : "s"}; e.g. "${usage.example}")`)
      .join("\n");

    try {
      const { data } = await llm.generateStructured<RegroupResponse>({
        feature: "topics",
        system: REGROUP_SYSTEM,
        prompt: `FILE: ${file.filename}\n\nTOPICS\n${list}${elsewhere(file.fileId)}`,
        schema: REGROUP_SCHEMA,
        temperature: 0,
        thinking: "minimal",
      });

      const renames = renameMap(
        file.topics.map((usage) => usage.topic),
        data.groups ?? [],
      );
      result.cardsRenamed += applyRenames(db, file.fileId, renames);
      result.files += 1;
      result.topicsAfter += new Set(
        file.topics.map((usage) => renames.get(usage.topic) ?? usage.topic),
      ).size;
    } catch {
      result.topicsAfter += file.topics.length;
    }
  }

  // The model may have picked a name another file spells differently.
  mergeTopicVariants(db, examId);
  return result;
}
