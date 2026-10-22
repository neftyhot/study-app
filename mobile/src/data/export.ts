/**
 * A deck as a `.meganstudy` file: the iOS twin of the desktop's
 * `buildShareFile` (src/lib/share/meganstudy.ts). Cards the student excluded
 * stay behind, and nothing of the sender's own goes in it — no review
 * history, no ids, no citations.
 */
import type { DeckGuide } from "@megan/core/decks/types";
import type { SqlDriver } from "@megan/core/platform/types";
import { SHARE_FORMAT, SHARE_VERSION, type ShareFile } from "@megan/core/share/meganstudy";

import { loadCards } from "./cards";
import { loadDeck } from "./decks";
import { loadGuide } from "./guides";

export async function buildShareFile(
  db: SqlDriver,
  examId: string,
  options: { includeGuide?: boolean } = {},
  now = new Date(),
): Promise<ShareFile | null> {
  const deck = await loadDeck(db, examId);
  if (!deck) return null;
  const [{ term } = { term: null }] = await db.all<{ term: string | null }>(
    "SELECT c.term AS term FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?",
    [examId],
  );

  const cards = (await loadCards(db, examId))
    .filter((card) => !card.excluded)
    .map((card) => ({
      topic: card.topic,
      question: card.question,
      directAnswer: card.directAnswer,
      fullExplanation: card.fullExplanation,
      cardType: card.cardType,
      sourceExcerpt: card.sourceExcerpt,
      essentialPoints: card.essentialPoints,
    }));

  let guide: DeckGuide | null = null;
  if (options.includeGuide) {
    const found = await loadGuide(db, examId);
    if (found) {
      const texts = (list: { text: string }[]) => list.map((s) => s.text);
      guide = {
        overview: found.overview,
        topics: found.topics.map((topic) => ({
          title: topic.title || deck.title,
          intro: topic.intro,
          sections: topic.sections.map((s) => ({
            conceptName: s.conceptName,
            definition: texts(s.definition),
            breakdown: texts(s.breakdown),
            example: texts(s.example),
            misconception: s.counterExample,
          })),
        })),
      };
    }
  }

  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    deck: { title: deck.title, course: deck.course, term, cards, guide },
  };
}
