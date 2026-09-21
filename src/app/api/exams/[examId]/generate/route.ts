/**
 * Card generation endpoint.
 *
 * Inline like ingestion: a large deck takes a while, and the job queue that
 * will replace this calls `generateCardsForExam` unchanged.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams } from "@/db/schema";
import { clearGeneratedCards, type UnitRange } from "@/lib/generate";
import {
  isDensityMode,
  MAX_RATIO,
  MIN_RATIO,
  type DensityMode,
} from "@/lib/generate/density";
import {
  activeJob,
  latestJob,
  startGenerationJob,
} from "@/lib/generate/jobs";
import { getProvider, LlmError } from "@/lib/llm";
import { duplicateExamSources } from "@/lib/manage";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/generate">,
) {
  const { examId } = await ctx.params;

  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  // One run at a time per deck: two concurrent runs would duplicate cards and
  // race each other's progress.
  const running = activeJob(db, examId);
  if (running) {
    return Response.json(
      {
        error: "Generation is already running for this deck.",
        jobId: running.id,
      },
      { status: 409 },
    );
  }

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    // A missing API key is a setup problem, not a server fault.
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }

  /**
   * What to do when the deck already has cards.
   *
   * Generating twice with different scopes used to stack both sets silently,
   * which is how a deck ends up with two near-duplicate cards for every fact.
   * The caller now has to say which it wants.
   */
  const body = await request.json().catch(() => ({}));
  const mode: "append" | "replace" | "separate" =
    body?.mode === "replace" || body?.mode === "separate" ? body.mode : "append";

  // How finely to cut, and which pages to cut up. Density sticks to the deck;
  // a range belongs to the run that asked for it, since the pages worth
  // generating from change every time.
  const density: DensityMode = isDensityMode(body?.density)
    ? body.density
    : exam.extractionDensity;
  const densityRatio =
    typeof body?.densityRatio === "number" && Number.isFinite(body.densityRatio)
      ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, body.densityRatio))
      : exam.extractionRatio;

  const ranges = parseRanges(body?.ranges);
  const sourceFileIds = Array.isArray(body?.sourceFileIds)
    ? body.sourceFileIds.filter((id: unknown) => typeof id === "string")
    : undefined;

  if (density !== exam.extractionDensity || densityRatio !== exam.extractionRatio) {
    db.update(exams)
      .set({ extractionDensity: density, extractionRatio: densityRatio })
      .where(eq(exams.id, examId))
      .run();
  }

  let targetId = examId;
  let cleared: { deleted: number; kept: number } | undefined;
  let createdExam: { id: string; title: string } | undefined;

  try {
    if (mode === "replace") {
      cleared = clearGeneratedCards(db, examId);
    }

    if (mode === "separate") {
      const copy = duplicateExamSources(
        db,
        examId,
        typeof body?.title === "string" && body.title.trim()
          ? body.title
          : `${exam.title} (${exam.scopeMode === "objectives" ? "study-guide focus" : "full coverage"})`,
      );
      if (!copy) {
        return Response.json({ error: "Could not create the deck" }, { status: 400 });
      }
      targetId = copy.id;
      createdExam = { id: copy.id, title: copy.title };
    }

    // Started, not awaited: generation writes each batch as it finishes and
    // can run for minutes. The job row is what the client watches, so closing
    // the page or navigating away no longer loses the run.
    const job = startGenerationJob(db, provider, examId, {
      mode,
      targetExamId: targetId,
      density,
      densityRatio,
      ranges,
      sourceFileIds: sourceFileIds?.length ? sourceFileIds : undefined,
    });

    return Response.json({
      jobId: job.id,
      status: job.status,
      target: mode,
      examId: targetId,
      createdExam,
      cleared,
    });
  } catch (error) {
    const status = error instanceof LlmError ? 502 : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

/**
 * Page ranges arrive as untrusted numbers from a form.
 *
 * A reversed or fractional range would silently select nothing, so it is
 * normalised here rather than deeper down where the mistake is invisible.
 */
function parseRanges(input: unknown): Record<string, UnitRange> | undefined {
  if (!input || typeof input !== "object") return undefined;

  const ranges: Record<string, UnitRange> = {};
  for (const [fileId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { from, to } = value as { from?: unknown; to?: unknown };
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

    ranges[fileId] = {
      from: Math.max(1, Math.floor(Math.min(from, to))),
      to: Math.max(1, Math.floor(Math.max(from, to))),
    };
  }

  return Object.keys(ranges).length > 0 ? ranges : undefined;
}

/** Progress for the panel to poll. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/generate">,
) {
  const { examId } = await ctx.params;
  const job = latestJob(db, examId);

  if (!job) return Response.json({ job: null });

  return Response.json({
    job: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      examId: job.targetExamId ?? job.examId,
      batchIndex: job.batchIndex,
      batchCount: job.batchCount,
      cardsCreated: job.cardsCreated,
      cardsRejected: job.cardsRejected,
      error: job.error,
      summary: job.summary,
      finishedAt: job.finishedAt,
    },
  });
}
