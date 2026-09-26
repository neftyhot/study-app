import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BookOpen,
  ClipboardCheck,
  Layers,
  MessageCircleQuestion,
  Upload,
} from "lucide-react";

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
import { DeckActionsMenu } from "@/components/manage/deck-actions-menu";
import { Hint } from "@/components/ui/tooltip";
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
  missing_prerequisite: "needs an earlier idea first",
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
      <div className="flex items-start justify-between gap-3">
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
              courses={courses.map((course) => ({
                id: course.id,
                title: course.title,
              }))}
              size="icon-sm"
            />
            <Badge variant="secondary">
              {exam.scopeMode === "objectives"
                ? "Study-guide focus"
                : "Cover everything"}
            </Badge>
          </div>
          {exam.date ? (
            <p className="text-muted-foreground text-sm">
              Exam date {exam.date}
            </p>
          ) : null}
        </div>
        <DeckActionsMenu
          examId={examId}
          examTitle={exam.title}
          cardCount={stats.flashcards}
          hasStudyGuide={stats.objectives > 0}
          hasDate={Boolean(exam.date)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Files" value={stats.sourceFiles} />
        <StatCard label="Study-guide topics" value={stats.objectives} />
        <StatCard label="Flashcards" value={stats.flashcards} />
      </div>

      {stats.sourceFiles === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Start by adding your slides
            </CardTitle>
            <CardDescription>
              Add lecture slides (PDF or PowerPoint) and your study guide, then
              we&apos;ll make a study guide, flashcards and a practice exam from
              them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href={`/exams/${examId}/sources`}>
                <Upload className="size-4" />
                Add your slides
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Your study path
              {stats.flashcards > 0 ? (
                <Badge variant="secondary">
                  {plan.today.studyDay
                    ? `Today: about ${formatMinutes(plan.today.minutes)}`
                    : "Day off"}
                </Badge>
              ) : null}
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
            {stats.flashcards > 0 ? (
              <CardDescription>
                {dueCount > 0
                  ? `${dueCount} card${dueCount === 1 ? "" : "s"} to review`
                  : "Nothing to review right now"}
                {plan.today.fresh > 0
                  ? ` · ${plan.today.fresh} new to learn`
                  : ""}
                {plan.today.struggling > 0
                  ? ` · ${plan.today.struggling} you keep missing`
                  : ""}
                {mastery.studied > 0
                  ? ` · ${mastery.retained} remembered across days`
                  : ""}
                .
              </CardDescription>
            ) : (
              <CardDescription>
                Read the study guide, then make flashcards below.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 sm:grid-cols-3">
              <PathStep
                step={1}
                icon={<BookOpen className="size-4" />}
                title="Study Guide"
                blurb="A plain-English summary of your slides, with each point linked to its slide."
                href={`/exams/${examId}/primer`}
                action="Read Study Guide"
                primary={stats.flashcards === 0}
              />
              <PathStep
                step={2}
                icon={<Layers className="size-4" />}
                title="Flashcards"
                blurb={
                  stats.flashcards === 0
                    ? "Make your flashcards below first."
                    : "Short questions that come back just before you'd forget them."
                }
                href={
                  dueCount === 0 && plan.today.fresh > 0
                    ? `/exams/${examId}/learn`
                    : `/exams/${examId}/study`
                }
                action={
                  dueCount > 0
                    ? `Review ${dueCount} card${dueCount === 1 ? "" : "s"}`
                    : plan.today.fresh > 0
                      ? "Learn new cards"
                      : "Study flashcards"
                }
                primary={
                  stats.flashcards > 0 && (dueCount > 0 || plan.today.fresh > 0)
                }
                disabled={stats.flashcards === 0}
              />
              <PathStep
                step={3}
                icon={<ClipboardCheck className="size-4" />}
                title="Practice Exam"
                blurb="A timed test from your cards, marked as you'd be marked."
                href={`/exams/${examId}/practice`}
                action="Start Practice Exam"
                primary={
                  stats.flashcards > 0 &&
                  dueCount === 0 &&
                  plan.today.fresh === 0
                }
                disabled={stats.flashcards === 0}
              />
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {stats.flashcards > 0 && dueCount > 0 && plan.today.fresh > 0 ? (
          <Hint label="Meet cards you haven't seen yet, a few at a time">
            <Button asChild variant="outline" size="sm">
              <Link href={`/exams/${examId}/learn`}>Learn new cards</Link>
            </Button>
          </Hint>
        ) : null}
        {stats.flashcards > 0 ? (
          <Hint label="See, edit or remove any of your cards">
            <Button asChild variant="outline" size="sm">
              <Link href={`/exams/${examId}/cards`}>Browse cards</Link>
            </Button>
          </Hint>
        ) : null}
        {drills.length > 0 ? (
          <Hint label="Label the parts of diagrams from your slides">
            <Button asChild variant="outline" size="sm">
              <Link href={`/exams/${examId}/diagrams`}>
                Diagram quizzes ({drills.length})
              </Link>
            </Button>
          </Hint>
        ) : null}
        <TutorPanel
          examId={examId}
          trigger={
            <Button variant="outline" size="sm">
              <MessageCircleQuestion className="size-4" />
              Ask a question
            </Button>
          }
        />
      </div>

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
            <CardTitle className="text-base">Study-guide check</CardTitle>
            <CardDescription>
              {coverage.analyzed === 0
                ? "Not checked yet: see which study-guide topics your cards cover."
                : `${coverage.covered} of ${coverage.analyzed} topics fully covered · ${coverage.partiallyCovered} partly · ${coverage.missing} not yet.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/exams/${examId}/coverage`}>
                {coverage.analyzed === 0
                  ? "Check my study guide"
                  : "See results"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {diagnoses.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cards you keep missing</CardTitle>
            <CardDescription>
              Why you&apos;re missing them, based on what you actually wrote.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnoses.map((item) => (
              <div
                key={item.cardId}
                className="space-y-1 rounded-md border p-3"
              >
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

function PathStep({
  step,
  icon,
  title,
  blurb,
  href,
  action,
  primary,
  disabled = false,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  href: string;
  action: string;
  primary: boolean;
  disabled?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        <span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[0.7rem]">
          {step}
        </span>
        {title}
      </p>
      <p className="text-muted-foreground flex-1 text-sm">{blurb}</p>
      {disabled ? (
        <Button variant="outline" disabled>
          {icon}
          {action}
        </Button>
      ) : (
        <Button asChild variant={primary ? "default" : "outline"}>
          <Link href={href}>
            {icon}
            {action}
          </Link>
        </Button>
      )}
    </li>
  );
}
