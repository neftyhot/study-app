/**
 * Writing a study guide: POST starts it, GET reports how far it has got.
 *
 * The run happens in the background so the page can poll; a server action
 * would hold the client's action queue for the whole run.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams } from "@/db/schema";
import { getProvider } from "@/lib/llm";
import { readSkipLogistics } from "@/lib/logistics";
import { isPrimerDepth } from "@/lib/primer";
import { primerRun, startPrimerRun } from "@/lib/primer/runs";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/exams/[examId]/primer">) {
  const { examId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  if (!isPrimerDepth(body?.depth)) {
    return Response.json({ error: "Unknown depth." }, { status: 400 });
  }
  if (!db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId)).get()) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }

  let provider;
  try {
    provider = getProvider(undefined, "primer");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }

  if (!startPrimerRun(db, provider, examId, body.depth, {
      skipLogistics: readSkipLogistics(body?.skipLogistics),
    })) {
    return Response.json({ error: "This study guide is already being written." }, { status: 409 });
  }
  return Response.json({ run: primerRun(examId, body.depth) }, { status: 202 });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/exams/[examId]/primer">) {
  const { examId } = await ctx.params;
  const depth = request.nextUrl.searchParams.get("depth");
  if (!isPrimerDepth(depth)) {
    return Response.json({ error: "Unknown depth." }, { status: 400 });
  }
  return Response.json({ run: primerRun(examId, depth) });
}
