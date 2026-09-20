/**
 * Pasted-text ingest endpoint (PRD §1).
 *
 * Plenty of course material never arrives as a file — it is a syllabus in an
 * email, a study guide in a course portal, or notes in a chat. Pasted text is
 * written to the uploads directory as a .txt file and then ingested through
 * exactly the same path as an upload, so provenance, re-ingestion and deletion
 * all behave identically rather than needing a special case.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams, sourceFiles } from "@/db/schema";
import { ingestSourceFile } from "@/lib/ingest";
import { absolutePathFor, storeUpload } from "@/lib/ingest/storage";

const ROLES = ["slides", "study_guide", "notes"] as const;
type Role = (typeof ROLES)[number];

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/paste">,
) {
  const { examId } = await ctx.params;

  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const role: Role = ROLES.includes(body?.role) ? body.role : "notes";

  if (text.trim().length === 0) {
    return Response.json({ error: "Nothing to add" }, { status: 400 });
  }

  const fileId = randomUUID();
  const filename = `${title || "Pasted notes"}.txt`;

  const stored = await storeUpload(
    examId,
    fileId,
    filename,
    Buffer.from(text, "utf8"),
  );

  const file = db
    .insert(sourceFiles)
    .values({
      id: fileId,
      examId,
      filename,
      fileType: "pasted",
      role,
      rawPath: stored.rawPath,
      checksum: stored.checksum,
    })
    .returning()
    .get();

  try {
    const result = await ingestSourceFile(
      db,
      file,
      absolutePathFor(stored.rawPath),
    );

    return Response.json({
      filename,
      status: "ready",
      unitCount: result.unitCount,
      objectiveCount: result.objectiveCount,
      warnings: result.warnings,
    });
  } catch (error) {
    return Response.json(
      {
        filename,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
