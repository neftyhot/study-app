import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneratePanel } from "@/components/generate/generate-panel";
import {
  countAnswerSlides,
  getCoverageStats,
  getExam,
  getExamStats,
} from "@/lib/queries";

export default async function ExamPage(props: PageProps<"/exams/[examId]">) {
  const { examId } = await props.params;
  const exam = await getExam(examId);

  if (!exam) notFound();

  const [stats, slideCount, coverage] = await Promise.all([
    getExamStats(examId),
    countAnswerSlides(examId),
    getCoverageStats(examId),
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
          <>
            <Button asChild>
              <Link href={`/exams/${examId}/learn`}>Learn</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/exams/${examId}/study`}>Flashcards</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/exams/${examId}/cards`}>Browse cards</Link>
            </Button>
          </>
        ) : null}
        {stats.objectives > 0 ? (
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/coverage`}>Coverage matrix</Link>
          </Button>
        ) : null}
      </div>

      <GeneratePanel
        examId={examId}
        scopeMode={exam.scopeMode}
        slideCount={slideCount}
      />

      {stats.objectives > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Study-guide coverage</CardTitle>
            <CardDescription>
              {coverage.analyzed === 0
                ? "Not analyzed yet — the coverage matrix checks each objective against your cards and slides."
                : `${coverage.covered} of ${coverage.analyzed} objectives fully covered · ${coverage.partiallyCovered} partial · ${coverage.missing} not covered.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={coverage.analyzed === 0 ? "default" : "outline"}>
              <Link href={`/exams/${examId}/coverage`}>
                {coverage.analyzed === 0 ? "Analyze coverage" : "Open matrix"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
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
