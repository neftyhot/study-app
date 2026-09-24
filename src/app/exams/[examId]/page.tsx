import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";

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
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { ExamSettings } from "@/components/manage/exam-settings";
import { EditExamDialog } from "@/components/manage/edit-dialogs";
import { db } from "@/db";
import { listDrills } from "@/lib/diagrams";
import { latestJob, measuredYields } from "@/lib/generate/jobs";
import { readLicenseStatus } from "@/lib/license/status";
import { bulkModelName } from "@/lib/llm";
import {
  countAnswerSlides,
  listAnswerSources,
  countDueCards,
  getCoverageStats,
  getExam,
  getExamStats,
  getMasteryBreakdown,
  listCoursesWithExams,
  listDiagnosedCards,
  loadPlanCards,
} from "@/lib/queries";
import { buildPlan, formatMinutes } from "@/lib/plan";

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

  const job = latestJob(db, examId);
  const drills = listDrills(db, examId);

  const [
    stats,
    slideCount,
    coverage,
    dueCount,
    mastery,
    diagnoses,
    planData,
    sources,
    courses,
  ] = await Promise.all([
      getExamStats(examId),
      countAnswerSlides(examId),
      getCoverageStats(examId),
      countDueCards(examId),
      getMasteryBreakdown(examId),
      listDiagnosedCards(examId),
      loadPlanCards(examId),
      listAnswerSources(examId),
      listCoursesWithExams(),
    ]);

  // What this deck has actually produced per slide so far, which is a better
  // guide to what another run will produce than any preset ratio.
  const observedRatio =
    stats.flashcards > 0 && slideCount > 0
      ? stats.flashcards / slideCount
      : null;

  const plan = buildPlan({
    cards: planData.cards,
    examDate: exam.date,
    studyDays: exam.studyDays,
    hasCoverage: planData.hasCoverage,
  });

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
          <EditExamDialog
            exam={{
              id: exam.id,
              title: exam.title,
              date: exam.date,
              courseId: exam.courseId,
            }}
            courses={courses.map((course) => ({ id: course.id, title: course.title }))}
            size="icon-sm"
          />
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
        {drills.length > 0 ? (
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/diagrams`}>
              Diagram drills ({drills.length})
            </Link>
          </Button>
        ) : null}
        <TutorPanel
          examId={examId}
          trigger={
            <Button variant="outline">
              <MessageCircleQuestion className="size-4" />
              Ask the tutor
            </Button>
          }
        />
        {stats.objectives > 0 ? (
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/coverage`}>Coverage matrix</Link>
          </Button>
        ) : null}
      </div>

      {stats.flashcards > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Today
              <Badge variant="secondary">
                {plan.today.studyDay
                  ? `about ${formatMinutes(plan.today.minutes)}`
                  : "Day off"}
              </Badge>
              {plan.daysLeft !== null && plan.studyDaysLeft !== null ? (
                <Badge variant="outline">
                  {plan.daysLeft === 0
                    ? "Exam today"
                    : `${plan.studyDaysLeft} study day${plan.studyDaysLeft === 1 ? "" : "s"} left`}
                </Badge>
              ) : null}
              {plan.overloaded ? (
                <Badge variant="destructive">More material than time</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {dueCount > 0
                ? `${dueCount} review${dueCount === 1 ? "" : "s"} due`
                : "Nothing due"}
              {plan.today.fresh > 0
                ? ` · ${plan.today.fresh} new concept${plan.today.fresh === 1 ? "" : "s"}`
                : ""}
              {plan.today.struggling > 0
                ? ` · ${plan.today.struggling} keep going wrong`
                : ""}
              {mastery.studied > 0
                ? ` · ${mastery.retained} retained across days`
                : ""}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {dueCount > 0 ? (
              <Button asChild>
                <Link href={`/exams/${examId}/study`}>Review now</Link>
              </Button>
            ) : null}
            {plan.today.fresh > 0 ? (
              <Button asChild variant={dueCount > 0 ? "outline" : "default"}>
                <Link href={`/exams/${examId}/learn`}>Learn something new</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/exams/${examId}/practice`}>Practice exam</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/exams/${examId}/plan`}>
                {exam.date ? "Study plan" : "Set an exam date"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <GeneratePanel
        examId={examId}
        scopeMode={exam.scopeMode}
        slideCount={slideCount}
        existingCards={stats.flashcards}
        includeApplication={exam.includeApplication}
        sources={sources}
        density={exam.extractionDensity}
        densityRatio={exam.extractionRatio}
        observedRatio={observedRatio}
        bulkModel={bulkModelName()}
        measured={measuredYields(db, bulkModelName())}
        isAdmin={readLicenseStatus()?.type === "admin"}
        initialJob={
          job
            ? {
                id: job.id,
                status: job.status,
                mode: job.mode,
                examId: job.targetExamId ?? job.examId,
                batchIndex: job.batchIndex,
                batchCount: job.batchCount,
                cardsCreated: job.cardsCreated,
                cardsRejected: job.cardsRejected,
                error: job.error,
                summary: (job.summary as never) ?? null,
                finishedAt: job.finishedAt,
              }
            : null
        }
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

      <ExamSettings
        examId={examId}
        examTitle={exam.title}
        cardCount={stats.flashcards}
      />
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
