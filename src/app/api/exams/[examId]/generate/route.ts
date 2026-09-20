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
import { clearGeneratedCards, generateCardsForExam } from "@/lib/generate";
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

    const summary = await generateCardsForExam(db, provider, targetId);

    return Response.json({
      mode: summary.mode,
      target: mode,
      examId: targetId,
      createdExam,
      cleared,
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
