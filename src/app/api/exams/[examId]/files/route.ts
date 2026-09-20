/**
 * Upload + ingest endpoint.
 *
 * A Route Handler rather than a Server Action on purpose: Server Actions cap
 * request bodies at 1MB by default, and lecture decks routinely run 20-100MB.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { exams, sourceFiles } from "@/db/schema";
import { ingestSourceFile } from "@/lib/ingest";
import {
  absolutePathFor,
  detectFileType,
  storeUpload,
  SUPPORTED_TYPES,
} from "@/lib/ingest/storage";

const ROLES = ["slides", "study_guide", "notes"] as const;
type Role = (typeof ROLES)[number];

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/files">,
) {
  const { examId } = await ctx.params;

  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  const form = await request.formData();
  const uploads = form.getAll("files").filter((f) => f instanceof File);
  const roleInput = form.get("role");
  const role: Role =
    typeof roleInput === "string" && ROLES.includes(roleInput as Role)
      ? (roleInput as Role)
      : "slides";

  if (uploads.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  const results = [];

  for (const upload of uploads) {
    const fileType = detectFileType(upload.name);

    if (!fileType || !SUPPORTED_TYPES.includes(fileType)) {
      results.push({
        filename: upload.name,
        status: "rejected" as const,
        error: `Unsupported file type. The MVP ingests ${SUPPORTED_TYPES.join(" and ")}.`,
      });
      continue;
    }

    const fileId = randomUUID();
    const data = Buffer.from(await upload.arrayBuffer());
    const { rawPath, checksum } = await storeUpload(
      examId,
      fileId,
      upload.name,
      data,
    );

    // Re-uploading identical bytes is a no-op: skip extraction entirely so
    // existing units, cards, and progress are left alone.
    const unchanged = db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.examId, examId))
      .all()
      .find((f) => f.checksum === checksum && f.status === "ready");

    if (unchanged) {
      results.push({
        filename: upload.name,
        sourceFileId: unchanged.id,
        status: "unchanged" as const,
        unitCount: unchanged.unitCount,
      });
      continue;
    }

    const record = db
      .insert(sourceFiles)
      .values({
        id: fileId,
        examId,
        filename: upload.name,
        fileType,
        role,
        rawPath,
        sizeBytes: data.byteLength,
        checksum,
      })
      .returning()
      .get();

    try {
      // Inline for the MVP. `ingestSourceFile` is queue-ready as-is.
      const outcome = await ingestSourceFile(
        db,
        record,
        absolutePathFor(rawPath),
      );
      results.push({
        filename: upload.name,
        sourceFileId: record.id,
        status: "ready" as const,
        unitCount: outcome.unitCount,
        objectiveCount: outcome.objectiveCount,
        warnings: outcome.warnings,
      });
    } catch (error) {
      results.push({
        filename: upload.name,
        sourceFileId: record.id,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({ results });
}
