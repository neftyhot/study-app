import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getExam, getExamStats } from "@/lib/queries";

export default async function ExamPage(props: PageProps<"/exams/[examId]">) {
  const { examId } = await props.params;
  const exam = await getExam(examId);

  if (!exam) notFound();

  const stats = await getExamStats(examId);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next up: ingestion</CardTitle>
          <CardDescription>
            Upload and extraction (Phase 1) lands here — see docs/TASKS.md.
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
