import Link from "next/link";
import { notFound } from "next/navigation";

import { DrillRunner } from "@/components/diagrams/drill-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { listDrills } from "@/lib/diagrams";
import { getExam } from "@/lib/queries";

export default async function DiagramsPage(
  props: PageProps<"/exams/[examId]/diagrams">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const drills = listDrills(db, examId);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          Diagram drills
          <Badge variant="secondary">{drills.length}</Badge>
        </h1>
      </div>

      {drills.length === 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            No diagram drills yet. Open a page in your sources, cover the
            labels you want to recall, and it becomes a card in this deck.
          </p>
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/sources`}>Go to sources</Link>
          </Button>
        </div>
      ) : (
        <DrillRunner
          examId={examId}
          drills={drills.map((drill) => ({
            id: drill.id,
            flashcardId: drill.flashcardId,
            question: drill.question,
            topic: drill.topic,
            masks: drill.masks,
            sourceLabel: drill.sourceLabel,
            // Served from the drill's own stored picture, so it keeps
            // working after its source file is deleted.
            imageUrl: `/api/drills/${drill.id}/image`,
          }))}
        />
      )}
    </div>
  );
}
