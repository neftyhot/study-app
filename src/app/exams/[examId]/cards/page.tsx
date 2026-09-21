import Link from "next/link";
import { notFound } from "next/navigation";

import { CardBuilder } from "@/components/cards/card-builder";
import { DeckCardList, type DeckCardView } from "@/components/search/deck-card-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getExam, listCoursesWithExams, listFlashcards } from "@/lib/queries";

export default async function CardsPage(
  props: PageProps<"/exams/[examId]/cards">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [cards, courses] = await Promise.all([
    listFlashcards(examId),
    listCoursesWithExams(),
  ]);

  const decks = courses.flatMap((course) =>
    course.exams.map((deck) => ({
      id: deck.id,
      title: deck.title,
      courseId: course.id,
      courseTitle: course.title,
    })),
  );

  const views: DeckCardView[] = cards.map((card) => {
    const label = card.sourceSlide
      ? `${card.sourceSlide.sourceFile.fileType === "pptx" ? "Slide" : card.sourceSlide.sourceFile.fileType === "pdf" ? "Page" : "Section"} ${card.sourceSlide.index} of ${card.sourceSlide.sourceFile.filename}`
      : null;

    return {
      id: card.id,
      topic: card.topic ?? "Untitled",
      question: card.question,
      directAnswer: card.directAnswer,
      fullExplanation: card.fullExplanation,
      cardType: card.cardType,
      hasAiSupplement: card.hasAiSupplement,
      isUserEdited: card.isUserEdited,
      essentialPoints: card.rubric?.essentialPoints ?? [],
      source: label ? { label, excerpt: card.sourceExcerpt } : null,
      // Searching the excerpt too means "where did I read this" works from here.
      haystack: [
        card.topic ?? "",
        card.question,
        card.directAnswer,
        card.fullExplanation ?? "",
        card.sourceExcerpt ?? "",
      ].join("\n"),
    };
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Flashcards
            <Badge variant="secondary" className="ml-2 align-middle">
              {cards.length}
            </Badge>
          </h1>
          <div className="flex flex-wrap gap-2">
            <CardBuilder decks={decks} defaultExamId={examId} />
            {cards.length > 0 ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/exams/${examId}/study`}>Study these</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No cards yet. Generate them from the exam overview, or write one
          yourself.
        </p>
      ) : (
        <DeckCardList
          examId={examId}
          cards={views}
          decks={decks.filter((deck) => deck.id !== examId)}
        />
      )}
    </div>
  );
}
