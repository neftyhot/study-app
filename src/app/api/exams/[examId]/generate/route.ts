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
import { generateCardsForExam } from "@/lib/generate";
import { getProvider, LlmError } from "@/lib/llm";

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

  try {
    const summary = await generateCardsForExam(db, provider, examId);

    return Response.json({
      mode: summary.mode,
      batchCount: summary.batchCount,
      cardsCreated: summary.cardsCreated,
      cardsRejected: summary.cardsRejected,
      uncoveredNotes: summary.uncoveredNotes,
      // Rejections are the audit trail for "why is this card missing?".
      rejections: summary.rejections.map((r) => ({
        reason: r.reason,
        detail: r.detail,
        question: r.card.question,
      })),
    });
  } catch (error) {
    const status = error instanceof LlmError ? 502 : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
