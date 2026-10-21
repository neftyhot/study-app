/**
 * Writes a whole deck — cards, rubrics and a study guide — into a new deck of
 * the student's own, in one transaction.
 *
 * Shared by everything that brings a finished deck in from outside: the
 * catalog, the bundled sample deck and `.meganstudy` files. Takes the database
 * as an argument, so it runs the same in tests against an in-memory copy.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  cardRubrics,
  cardTypes,
  courses,
  exams,
  flashcards,
  primerGuides,
  primerSections,
  primerTopics,
} from "@/db/schema";
import type { CitedSentence, CounterExample } from "@/lib/primer/types";

export type DeckCard = {
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  sourceExcerpt: string | null;
  essentialPoints: string[];
  /** Wrong answers students give; a paper's multiple-choice options without a model. */
  misconceptions?: string[];
};

export type DeckSection = {
  conceptName: string;
  definition: string[];
  breakdown: string[];
  example: string[];
  /** A common mistake about the concept, shown in the guide. */
  misconception?: CounterExample | null;
};

export type DeckGuide = {
  overview: string | null;
  topics: { title: string; intro: string; sections: DeckSection[] }[];
};

export type DeckSnapshot = {
  title: string;
  course: string;
  term: string | null;
  cards: DeckCard[];
  guide: DeckGuide | null;
  /** Recorded as the guide's model, so it is clear where the guide came from. */
  origin: string;
};

const cite = (text: string): CitedSentence => ({
  text,
  source_document_index: null,
  source_slide_number: null,
  source_excerpt: null,
});

/** Inserts the deck and returns its exam id. A course with the same title is reused. */
export function insertDeck(db: Db, deck: DeckSnapshot): string {
  if (deck.cards.length === 0) throw new Error("That deck has no cards.");

  return db.transaction((tx) => {
    const course =
      tx.select().from(courses).where(eq(courses.title, deck.course)).get() ??
      tx.insert(courses).values({ title: deck.course, term: deck.term }).returning().get();
    const exam = tx
      .insert(exams)
      .values({ courseId: course.id, title: deck.title })
      .returning()
      .get();

    for (const card of deck.cards) {
      const inserted = tx
        .insert(flashcards)
        .values({
          examId: exam.id,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation,
          // Whatever the source says, only a type this app knows is stored.
          cardType: (cardTypes as readonly string[]).includes(card.cardType)
            ? (card.cardType as (typeof cardTypes)[number])
            : "atomic",
          sourceExcerpt: card.sourceExcerpt,
        })
        .returning({ id: flashcards.id })
        .get();
      tx.insert(cardRubrics)
        .values({
          flashcardId: inserted.id,
          essentialPoints: card.essentialPoints.length > 0 ? card.essentialPoints : [card.directAnswer],
          commonMisconceptions: card.misconceptions ?? [],
        })
        .run();
    }

    if (deck.guide && deck.guide.topics.length > 0) {
      const created = tx
        .insert(primerGuides)
        .values({
          examId: exam.id,
          depth: "balanced",
          format: "explained",
          model: deck.origin,
          overview: deck.guide.overview,
        })
        .returning()
        .get();
      let order = 0;
      deck.guide.topics.forEach((topic, topicIndex) => {
        const t = tx
          .insert(primerTopics)
          .values({ guideId: created.id, orderIndex: topicIndex, title: topic.title, intro: topic.intro })
          .returning()
          .get();
        for (const s of topic.sections) {
          tx.insert(primerSections)
            .values({
              guideId: created.id,
              topicId: t.id,
              orderIndex: order++,
              conceptName: s.conceptName,
              definition: s.definition.map(cite),
              breakdown: s.breakdown.map(cite),
              example: s.example.map(cite),
              ...(s.misconception
                ? { counterExample: s.misconception, counterExampleAt: new Date().toISOString() }
                : {}),
            })
            .run();
        }
      });
    }
    return exam.id;
  });
}
