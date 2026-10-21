/**
 * The disk side of copying a deck.
 *
 * `duplicateExamSources` copies rows; the uploads and rendered slide images
 * they point at live under the original deck's folders, which go when that
 * deck is deleted. This gives the copy files of its own, under its own ids.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";

import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { sourceFiles, sourceSlides } from "@/db/schema";
import { absolutePathFor, storedPath } from "@/lib/ingest/storage";

import type { DuplicatedExam } from "./index";

async function copyStored(from: string, to: string) {
  const target = absolutePathFor(to);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(absolutePathFor(from), target);
}

/**
 * Copies the uploads and slide images the new deck's rows share with the
 * original, and points the rows at the copies. A file that cannot be copied
 * keeps pointing at the original rather than at nothing.
 */
export async function copyDuplicatedFiles(db: Db, copy: DuplicatedExam) {
  const files = db
    .select({ id: sourceFiles.id, rawPath: sourceFiles.rawPath })
    .from(sourceFiles)
    .where(eq(sourceFiles.examId, copy.id))
    .all();

  for (const file of files) {
    const rawPath = storedPath(copy.id, `${file.id}${extname(file.rawPath)}`);
    try {
      await copyStored(file.rawPath, rawPath);
      db.update(sourceFiles).set({ rawPath }).where(eq(sourceFiles.id, file.id)).run();
    } catch {
      // Left shared; the original is still there.
    }
  }

  const newSlideIds = Object.values(copy.slideIds);
  if (newSlideIds.length === 0) return;
  const oldFor = Object.fromEntries(
    Object.entries(copy.slideIds).map(([oldId, newId]) => [newId, oldId]),
  );

  const slides = db
    .select({ id: sourceSlides.id, imagePath: sourceSlides.imagePath })
    .from(sourceSlides)
    .where(inArray(sourceSlides.id, newSlideIds))
    .all();

  for (const slide of slides) {
    if (!slide.imagePath) continue;
    // Rendered images are named after the slide: `<slideId>.png`,
    // `<slideId>.whole.png`. Keep the suffix, change the id.
    const name = slide.imagePath.split("/").pop() ?? "";
    const oldId = oldFor[slide.id];
    const suffix = oldId && name.startsWith(oldId) ? name.slice(oldId.length) : extname(name);
    const imagePath = storedPath("rendered", copy.id, `${slide.id}${suffix}`);
    try {
      await copyStored(slide.imagePath, imagePath);
      db.update(sourceSlides).set({ imagePath }).where(eq(sourceSlides.id, slide.id)).run();
    } catch {
      // Left shared, as above.
    }
  }
}
