/**
 * The whole file a slide belongs to, for the source viewer to scroll through.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sourceFiles, sourceSlides } from "@/db/schema";
import { sourceDocument } from "@/lib/ingest/document";
import { deckPictures } from "@/lib/ingest/slide-render";

// The first look at a slideshow may wait for its slides to be drawn.
export const maxDuration = 200;

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/slides/[slideId]/document">,
) {
  const { slideId } = await ctx.params;
  const file = db
    .select({
      id: sourceFiles.id,
      examId: sourceFiles.examId,
      rawPath: sourceFiles.rawPath,
      fileType: sourceFiles.fileType,
    })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(eq(sourceSlides.id, slideId))
    .get();
  const slidesDrawn =
    file?.fileType === "pptx" && (await deckPictures(db, file)) !== null;

  const document = sourceDocument(db, slideId, slidesDrawn);
  if (!document) {
    return Response.json(
      { error: "That source is no longer in this library." },
      { status: 404 },
    );
  }
  return Response.json(document);
}
