import Link from "next/link";
import { notFound } from "next/navigation";

import { StudyDeck, type StudyCardView } from "@/components/study/study-deck";
import {
  countDueCards,
  getExam,
  getOpenStudySession,
  listStudyCards,
  listTopics,
} from "@/lib/queries";

export default async function StudyPage(
  props: PageProps<"/exams/[examId]/study">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [cards, topics, session, dueCount] = await Promise.all([
    listStudyCards(examId),
    listTopics(examId),
    getOpenStudySession(examId),
    countDueCards(examId),
  ]);

  // Mapped here rather than passed whole: the client needs a flat view, and
  // Drizzle rows carry relations the deck never reads.
  const views: StudyCardView[] = cards.map((card) => ({
    id: card.id,
    topic: card.topic,
    question: card.question,
    directAnswer: card.directAnswer,
    fullExplanation: card.fullExplanation,
    cardType: card.cardType,
    starred: card.starred,
    excluded: card.excluded,
    isUserEdited: card.isUserEdited,
    hasAiSupplement: card.hasAiSupplement,
    essentialPoints: card.rubric?.essentialPoints ?? [],
    lastGrade: card.progress?.lastGrade ?? null,
    source: card.sourceSlide
      ? {
          label: `${card.sourceSlide.sourceFile.fileType === "pptx" ? "Slide" : "Page"} ${card.sourceSlide.index} of ${card.sourceSlide.sourceFile.filename}`,
          excerpt: card.sourceExcerpt,
          title: card.sourceSlide.title,
          text: card.sourceSlide.rawText,
          speakerNotes: card.sourceSlide.speakerNotes,
        }
      : null,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
      </div>

      <StudyDeck
        examId={examId}
        cards={views}
        topics={topics}
        dueCount={dueCount}
        session={
          session
            ? {
                id: session.id,
                cardOrder: session.cardOrder,
                position: session.position,
                scope: session.scope,
                topic: session.topic,
                shuffled: session.shuffled,
                missedCount: session.missedCount,
                difficultCount: session.difficultCount,
                easyCount: session.easyCount,
              }
            : null
        }
      />
    </div>
  );
}
