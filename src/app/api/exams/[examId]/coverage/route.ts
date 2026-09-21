/**
 * Coverage analysis endpoint.
 *
 * POST starts a check in the background and returns at once; GET reports its
 * progress. Conflict detection is opt-out via `?conflicts=false` because it is
 * pointless with a single source file.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams } from "@/db/schema";
import { coverageJob, coveragePercent, startCoverageJob } from "@/lib/coverage/jobs";
import { getProvider } from "@/lib/llm";


export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/coverage">,
) {
  const { examId } = await ctx.params;

  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }

  if (coverageJob(examId)?.status === "running") {
    return Response.json(
      { error: "A coverage check is already running for this deck." },
      { status: 409 },
    );
  }

  const skipConflicts =
    request.nextUrl.searchParams.get("conflicts") === "false";

  const job = startCoverageJob(db, provider, examId, { skipConflicts });
  return Response.json({ job: view(job) }, { status: 202 });
}

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/coverage">,
) {
  const { examId } = await ctx.params;
  const job = coverageJob(examId);
  return Response.json({ job: job ? view(job) : null });
}

function view(job: NonNullable<ReturnType<typeof coverageJob>>) {
  return { ...job, percent: coveragePercent(job) };
}
