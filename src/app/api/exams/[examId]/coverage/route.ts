/**
 * Coverage analysis endpoint.
 *
 * Inline like ingestion and generation; `analyzeCoverageForExam` is queue-ready
 * unchanged. Conflict detection is opt-out via `?conflicts=false` because it is
 * the slowest pass and is pointless with a single source file.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams } from "@/db/schema";
import { analyzeCoverageForExam } from "@/lib/coverage";
import { getProvider, LlmError } from "@/lib/llm";

export const maxDuration = 300;

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

  const skipConflicts =
    request.nextUrl.searchParams.get("conflicts") === "false";

  try {
    const summary = await analyzeCoverageForExam(db, provider, examId, {
      skipConflicts,
    });

    return Response.json(summary);
  } catch (error) {
    const status = error instanceof LlmError ? 502 : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
