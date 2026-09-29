import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { LearnMode } from "@/components/learn/learn-mode";
import { db } from "@/db";
import { flashcards } from "@/db/schema";
import { chronologicalCardOrder } from "@/lib/order";
import { getLearnStatus, learnTopics } from "@/lib/learn/actions";
import { openLearnSession } from "@/lib/learn/session";
import { countDueCards, getExam, getExamStats } from "@/lib/queries";

export default async function LearnPage(
  props: PageProps<"/exams/[examId]/learn">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const session = openLearnSession(db, examId);
  const [topics, stats, status, dueCount] = await Promise.all([
    learnTopics(examId),
    getExamStats(examId),
    session ? getLearnStatus(session.id) : Promise.resolve(null),
    countDueCards(examId),
  ]);

  // Every card, numbered as the card list and the tutor number them, so "#32"
  // here is the same card everywhere; excluded ones keep their number but
  // cannot be started from.
  const cards = db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      question: flashcards.question,
      excluded: flashcards.excluded,
    })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .orderBy(...chronologicalCardOrder())
    .all()
    .flatMap(({ excluded, ...card }, index) =>
      excluded ? [] : [{ ...card, number: index + 1 }],
    );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Learn</h1>
      </div>

      <LearnMode
        examId={examId}
        topics={topics}
        cards={cards}
        cardCount={stats.flashcards}
        dueCount={dueCount}
        initialSessionId={session?.id ?? null}
        initialStatus={status}
      />
    </div>
  );
}
