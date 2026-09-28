/**
 * A whole source file laid out for reading, opened at one of its units.
 *
 * "Show original slide" opens the deck (or transcript) the card came from and
 * scrolls to the cited page, so the student can look at what comes before and
 * after it rather than one page on its own.
 */
import { asc, eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { sourceFiles, sourceSlides } from "@/db/schema";

export type SourceUnitView = {
  id: string;
  index: number;
  title: string | null;
  text: string;
  speakerNotes: string | null;
  /** Whether a picture can be drawn for this unit (every PDF page; PPTX slides with images). */
  hasImage: boolean;
};

export type SourceDocumentView = {
  filename: string;
  fileType: string;
  /** "Slide", "Page" or "Section", as the student sees units of this file. */
  unitLabel: string;
  /** Pictures first (slideshows and PDFs); text flows as one document (transcripts). */
  layout: "pages" | "text";
  /** Each picture is the whole page as it looks (PDFs, and slideshows a presentation program could draw). */
  wholePages: boolean;
  targetId: string;
  units: SourceUnitView[];
};

export function unitLabelFor(fileType: string): string {
  if (fileType === "pptx") return "Slide";
  if (fileType === "pdf" || fileType === "image") return "Page";
  return "Section";
}

/**
 * `slidesDrawn` says a slideshow's slides can be drawn whole (see
 * slide-render.ts); otherwise a slide shows its text and its largest picture.
 */
export function sourceDocument(
  db: Db,
  slideId: string,
  slidesDrawn = false,
): SourceDocumentView | null {
  const target = db
    .select({ fileId: sourceSlides.sourceFileId })
    .from(sourceSlides)
    .where(eq(sourceSlides.id, slideId))
    .get();
  if (!target) return null;

  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, target.fileId)).get();
  if (!file) return null;

  const units = db
    .select()
    .from(sourceSlides)
    .where(eq(sourceSlides.sourceFileId, file.id))
    .orderBy(asc(sourceSlides.index))
    .all();

  const pictured = file.fileType === "pdf" || file.fileType === "pptx" || file.fileType === "image";

  return {
    filename: file.filename,
    fileType: file.fileType,
    unitLabel: unitLabelFor(file.fileType),
    layout: pictured ? "pages" : "text",
    wholePages: file.fileType !== "pptx" || slidesDrawn,
    targetId: slideId,
    units: units.map((unit) => ({
      id: unit.id,
      index: unit.index,
      title: unit.title,
      text: unit.rawText,
      speakerNotes: unit.speakerNotes,
      hasImage:
        file.fileType === "pdf" || file.fileType === "image"
          ? true
          : file.fileType === "pptx"
            ? slidesDrawn || unit.hasDiagram || Boolean(unit.imagePath)
            : false,
    })),
  };
}
