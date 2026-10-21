/**
 * A deck as plain cards and a study guide, ready for `insertDeck` on the
 * other end: no ids, no review history, no slides or citations.
 *
 * What the catalog publishes and what a `.meganstudy` file carries. Cards the
 * student excluded from study are left out.
 */
import { asc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { cardRubrics, flashcards, primerGuides, primerSections, primerTopics } from "@/db/schema";
import type { CitedSentence } from "@/lib/primer/types";

import type { DeckCard, DeckGuide, DeckSection } from "./insert";

export function snapshotCards(db: Db, examId: string): DeckCard[] {
  const rows = db
    .select({
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      fullExplanation: flashcards.fullExplanation,
      cardType: flashcards.cardType,
      sourceExcerpt: flashcards.sourceExcerpt,
      excluded: flashcards.excluded,
      essentialPoints: cardRubrics.essentialPoints,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .orderBy(
      asc(flashcards.sourceDocumentIndex),
      asc(flashcards.sourcePageNumber),
      asc(flashcards.documentOrderIndex),
    )
    .all();
  return rows
    .filter((r) => !r.excluded)
    .map((r) => ({
      topic: r.topic,
      question: r.question,
      directAnswer: r.directAnswer,
      fullExplanation: r.fullExplanation,
      cardType: r.cardType,
      sourceExcerpt: r.sourceExcerpt,
      essentialPoints: r.essentialPoints ?? [],
    }));
}

const texts = (sentences: CitedSentence[] | null) => (sentences ?? []).map((s) => s.text);

/** The fullest guide the deck has: the one with the most sections. */
export function snapshotGuide(db: Db, examId: string): DeckGuide | null {
  const guides = db.select().from(primerGuides).where(eq(primerGuides.examId, examId)).all();
  let best: { guide: (typeof guides)[number]; count: number } | null = null;
  for (const guide of guides) {
    const count = db
      .select({ id: primerSections.id })
      .from(primerSections)
      .where(eq(primerSections.guideId, guide.id))
      .all().length;
    if (count > 0 && (!best || count > best.count)) best = { guide, count };
  }
  if (!best) return null;

  const topics = db
    .select()
    .from(primerTopics)
    .where(eq(primerTopics.guideId, best.guide.id))
    .orderBy(asc(primerTopics.orderIndex))
    .all();
  const sections = db
    .select()
    .from(primerSections)
    .where(eq(primerSections.guideId, best.guide.id))
    .orderBy(asc(primerSections.orderIndex))
    .all();

  const toSection = (s: (typeof sections)[number]): DeckSection => ({
    conceptName: s.conceptName,
    definition: texts(s.definition),
    breakdown: texts(s.breakdown),
    example: texts(s.example),
  });

  const grouped = topics.map((t) => ({
    title: t.title,
    intro: t.intro,
    sections: sections.filter((s) => s.topicId === t.id).map(toSection),
  }));
  const loose = sections.filter((s) => !s.topicId || !topics.some((t) => t.id === s.topicId));
  if (loose.length > 0) grouped.push({ title: "Concepts", intro: "", sections: loose.map(toSection) });

  return { overview: best.guide.overview, topics: grouped.filter((t) => t.sections.length > 0) };
}
