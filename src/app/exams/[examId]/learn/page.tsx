import Link from "next/link";
import { notFound } from "next/navigation";

import { LearnMode } from "@/components/learn/learn-mode";
import { db } from "@/db";
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
        cardCount={stats.flashcards}
        dueCount={dueCount}
        initialSessionId={session?.id ?? null}
        initialStatus={status}
      />
    </div>
  );
}
