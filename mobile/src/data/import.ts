/**
 * Writes a whole deck into the student's library: the iOS twin of the
 * desktop's `insertDeck` (src/lib/decks/insert.ts). Same rows, same defaults;
 * `data.test.ts` checks the two produce the same deck.
 */
import type { DeckSnapshot } from "@megan/core/decks/types";
import type { SqlDriver } from "@megan/core/platform/types";
import { parseShareFile, SHARE_ORIGIN } from "@megan/core/share/meganstudy";
import { cardTypes } from "@megan/core/types";

import { newId, nowIso } from "./db";

const cite = (text: string) => ({
  text,
  source_document_index: null,
  source_slide_number: null,
  source_excerpt: null,
});

/** Inserts the deck and returns its exam id. A course with the same title is reused. */
export async function insertDeck(db: SqlDriver, deck: DeckSnapshot): Promise<string> {
  if (deck.cards.length === 0) throw new Error("That deck has no cards.");

  return db.transaction(async () => {
    const [existing] = await db.all<{ id: string }>("SELECT id FROM courses WHERE title = ? LIMIT 1", [deck.course]);
    let courseId = existing?.id;
    if (!courseId) {
      courseId = newId();
      await db.run("INSERT INTO courses (id, title, term) VALUES (?, ?, ?)", [courseId, deck.course, deck.term]);
    }
    const examId = newId();
    await db.run("INSERT INTO exams (id, course_id, title) VALUES (?, ?, ?)", [examId, courseId, deck.title]);

    for (const card of deck.cards) {
      const cardId = newId();
      const cardType = (cardTypes as readonly string[]).includes(card.cardType) ? card.cardType : "atomic";
      await db.run(
        "INSERT INTO flashcards (id, exam_id, topic, question, direct_answer, full_explanation, card_type, source_excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [cardId, examId, card.topic, card.question, card.directAnswer, card.fullExplanation, cardType, card.sourceExcerpt],
      );
      await db.run(
        "INSERT INTO card_rubrics (id, flashcard_id, essential_points, common_misconceptions) VALUES (?, ?, ?, ?)",
        [
          newId(),
          cardId,
          JSON.stringify(card.essentialPoints.length > 0 ? card.essentialPoints : [card.directAnswer]),
          JSON.stringify(card.misconceptions ?? []),
        ],
      );
    }

    if (deck.guide && deck.guide.topics.length > 0) {
      const guideId = newId();
      await db.run(
        "INSERT INTO primer_guides (id, exam_id, depth, format, model, overview) VALUES (?, ?, 'balanced', 'explained', ?, ?)",
        [guideId, examId, deck.origin, deck.guide.overview],
      );
      let order = 0;
      for (const [topicIndex, topic] of deck.guide.topics.entries()) {
        const topicId = newId();
        await db.run("INSERT INTO primer_topics (id, guide_id, order_index, title, intro) VALUES (?, ?, ?, ?, ?)", [
          topicId,
          guideId,
          topicIndex,
          topic.title,
          topic.intro,
        ]);
        for (const s of topic.sections) {
          await db.run(
            "INSERT INTO primer_sections (id, guide_id, topic_id, order_index, concept_name, definition, breakdown, example, counter_example, counter_example_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              newId(),
              guideId,
              topicId,
              order++,
              s.conceptName,
              JSON.stringify(s.definition.map(cite)),
              JSON.stringify(s.breakdown.map(cite)),
              JSON.stringify(s.example.map(cite)),
              s.misconception ? JSON.stringify(s.misconception) : null,
              s.misconception ? nowIso() : null,
            ],
          );
        }
      }
    }
    return examId;
  });
}

/** Opens a `.meganstudy` file's text as a new deck. Throws `ShareFileError` with a readable reason. */
export async function importShareFile(db: SqlDriver, raw: string): Promise<{ examId: string; title: string; cards: number }> {
  const file = parseShareFile(raw);
  const examId = await insertDeck(db, { ...file.deck, origin: SHARE_ORIGIN });
  return { examId, title: file.deck.title, cards: file.deck.cards.length };
}
