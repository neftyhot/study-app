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
import { ExamSettings } from "@/components/manage/exam-settings";
import {
  countAnswerSlides,
  countDueCards,
  getCoverageStats,
  getExam,
  getExamStats,
  getMasteryBreakdown,
  listDiagnosedCards,
} from "@/lib/queries";

const DIAGNOSIS_LABELS: Record<string, string> = {
  missing_prerequisite: "missing prerequisite",
  term_confusion: "terms getting swapped",
  defective_question: "the card may be at fault",
  not_learned_yet: "not learned yet",
};

export default async function ExamPage(props: PageProps<"/exams/[examId]">) {
  const { examId } = await props.params;
  const exam = await getExam(examId);

  if (!exam) notFound();

  const [stats, slideCount, coverage, dueCount, mastery, diagnoses] =
    await Promise.all([
      getExamStats(examId),
      countAnswerSlides(examId),
      getCoverageStats(examId),
      countDueCards(examId),
      getMasteryBreakdown(examId),
      listDiagnosedCards(examId),
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

      {stats.flashcards > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {dueCount > 0
                ? `${dueCount} card${dueCount === 1 ? "" : "s"} due for review`
                : "Nothing due today"}
            </CardTitle>
            <CardDescription>
              {mastery.studied === 0
                ? "Reviews are scheduled as you study — nothing has been graded yet."
                : `${mastery.retained} retained across days · ${mastery.immediateRecall} recalled unaided · ${mastery.recognition} recognized · ${stats.flashcards - mastery.studied} unstudied.`}
            </CardDescription>
          </CardHeader>
          {dueCount > 0 ? (
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={`/exams/${examId}/study`}>Review now</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/exams/${examId}/learn`}>Review in Learn</Link>
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <GeneratePanel
        examId={examId}
        scopeMode={exam.scopeMode}
        slideCount={slideCount}
        existingCards={stats.flashcards}
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

      {diagnoses.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Cards that keep going wrong
            </CardTitle>
            <CardDescription>
              Diagnosed from what you actually wrote, not from how many times
              you missed them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnoses.map((item) => (
              <div key={item.cardId} className="space-y-1 rounded-md border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium break-words">
                  {item.question}
                  <Badge variant="outline">
                    {DIAGNOSIS_LABELS[item.category] ?? item.category}
                  </Badge>
                </p>
                <p className="text-muted-foreground text-xs">
                  {item.explanation}
                </p>
                <p className="text-xs">{item.suggestion}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ExamSettings examId={examId} examTitle={exam.title} />
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
