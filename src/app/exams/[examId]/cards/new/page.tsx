import Link from "next/link";
import { notFound } from "next/navigation";

import { CardSetEditor } from "@/components/cards/card-set-editor";
import { getExam } from "@/lib/queries";

export default async function AddCardsPage(
  props: PageProps<"/exams/[examId]/cards/new">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  return (
    <div className="space-y-2">
      <Link
        href={`/exams/${examId}/cards`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Flashcards
      </Link>
      <CardSetEditor examId={examId} deckTitle={exam.title} />
    </div>
  );
}
