import Link from "next/link";
import { notFound } from "next/navigation";

import { CardSetEditor } from "@/components/cards/card-set-editor";
import { getExam, listFlashcards } from "@/lib/queries";

export default async function AddCardsPage(
  props: PageProps<"/exams/[examId]/cards/new">,
) {
  const { examId } = await props.params;
  const [exam, cards, query] = await Promise.all([
    getExam(examId),
    listFlashcards(examId),
    props.searchParams,
  ]);
  if (!exam) notFound();

  const after = typeof query.after === "string" ? query.after : undefined;

  return (
    <div className="space-y-2">
      <Link
        href={`/exams/${examId}/cards`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Flashcards
      </Link>
      <CardSetEditor
        examId={examId}
        deckTitle={exam.title}
        cards={cards.map((card, index) => ({
          id: card.id,
          number: index + 1,
          question: card.question,
        }))}
        defaultAfter={after}
      />
    </div>
  );
}
