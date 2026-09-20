import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneratePanel } from "@/components/generate/generate-panel";
import { countAnswerSlides, getExam, getExamStats } from "@/lib/queries";

export default async function ExamPage(props: PageProps<"/exams/[examId]">) {
  const { examId } = await props.params;
  const exam = await getExam(examId);

  if (!exam) notFound();

  const [stats, slideCount] = await Promise.all([
    getExamStats(examId),
    countAnswerSlides(examId),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.course.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {exam.title}
          </h1>
          <Badge variant="secondary">
            {exam.scopeMode === "objectives"
              ? "Study-guide focus"
              : "Cover everything"}
          </Badge>
        </div>
        {exam.date ? (
          <p className="text-muted-foreground text-sm">Exam date {exam.date}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Source files" value={stats.sourceFiles} />
        <StatCard label="Study-guide objectives" value={stats.objectives} />
        <StatCard label="Flashcards" value={stats.flashcards} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/exams/${examId}/sources`}>
            {stats.sourceFiles === 0 ? "Upload sources" : "Manage sources"}
          </Link>
        </Button>
        {stats.flashcards > 0 ? (
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/cards`}>Browse cards</Link>
          </Button>
        ) : null}
      </div>

      <GeneratePanel
        examId={examId}
        scopeMode={exam.scopeMode}
        slideCount={slideCount}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next up: coverage matrix</CardTitle>
          <CardDescription>
            Phase 3 maps each study-guide objective to the cards and slides
            that cover it — see docs/TASKS.md.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
