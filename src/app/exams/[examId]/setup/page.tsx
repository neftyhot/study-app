import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";

import { GeneratePanel } from "@/components/generate/generate-panel";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { latestJob, measuredYields } from "@/lib/generate/jobs";
import { readLicenseStatus } from "@/lib/license/status";
import { bulkModelName } from "@/lib/llm";
import {
  countAnswerSlides,
  getExam,
  getExamStats,
  listAnswerSources,
} from "@/lib/queries";

/**
 * The step between dropping files on the home screen and having cards: how
 * many, and from which files and pages. Nothing is generated until the
 * student says so here.
 */
export default async function SetupPage(props: PageProps<"/exams/[examId]/setup">) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [stats, slideCount, sources] = await Promise.all([
    getExamStats(examId),
    countAnswerSlides(examId),
    listAnswerSources(examId),
  ]);
  const job = latestJob(db, examId);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-sm">{exam.course.title}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
        <p className="text-muted-foreground text-sm">
          Your files are in. Choose how many cards you want and what to make
          them from.
        </p>
      </div>

      <GeneratePanel
        variant="setup"
        examId={examId}
        scopeMode={exam.scopeMode}
        slideCount={slideCount}
        existingCards={stats.flashcards}
        includeApplication={exam.includeApplication}
        sources={sources}
        density={exam.extractionDensity}
        densityRatio={exam.extractionRatio}
        observedRatio={null}
        bulkModel={bulkModelName()}
        measured={measuredYields(db, bulkModelName())}
        isAdmin={readLicenseStatus()?.type === "admin"}
        initialJob={
          job?.status === "running"
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
                summary: null,
                finishedAt: job.finishedAt,
              }
            : null
        }
      />

      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/exams/${examId}/sources`}>
            <FolderOpen className="size-4" />
            Change files ({stats.sourceFiles})
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/exams/${examId}`}>Skip for now</Link>
        </Button>
      </div>
    </div>
  );
}
