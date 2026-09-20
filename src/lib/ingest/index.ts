/**
 * Ingestion orchestrator: file on disk -> extracted units -> database rows.
 *
 * Deliberately a plain async function rather than logic buried in a route
 * handler, so the job queue that eventually replaces inline execution can call
 * it unchanged.
 */
import { readFile } from "node:fs/promises";

import { and, eq, inArray, notInArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  type SourceFile,
} from "@/db/schema";

import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import { extractPptx } from "./pptx";
import { parseStudyGuide } from "./study-guide";
import {
  classifyLegibility,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

export type IngestOutcome = {
  sourceFileId: string;
  unitCount: number;
  objectiveCount: number;
  warnings: ExtractionWarning[];
};

export async function extractFile(
  absolutePath: string,
  fileType: SourceFile["fileType"],
): Promise<ExtractionResult> {
  const buffer = await readFile(absolutePath);

  switch (fileType) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "pptx":
      return extractPptx(buffer);
    default:
      // Image/OCR ingestion is deferred past the MVP.
      throw new Error(`Unsupported file type for extraction: ${fileType}`);
  }
}

/**
 * Extracts `file` and writes its units.
 *
 * Non-destructive by design (ARCHITECTURE principle #3): source units are
 * upserted on `(source_file_id, index)` so their IDs survive, which keeps every
 * `flashcards.source_slide_id` pointing at the same slide. Flashcards and
 * StudyProgress are never touched here.
 */
export async function ingestSourceFile(
  db: Db,
  file: SourceFile,
  absolutePath: string,
): Promise<IngestOutcome> {
  db.update(sourceFiles)
    .set({ status: "extracting", errorMessage: null })
    .where(eq(sourceFiles.id, file.id))
    .run();

  try {
    const { units, warnings } = await extractFile(absolutePath, file.fileType);

    const existing = db
      .select({ id: sourceSlides.id, index: sourceSlides.index })
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .all();
    const existingByIndex = new Map(existing.map((row) => [row.index, row.id]));

    db.transaction((tx) => {
      for (const unit of units) {
        const values = {
          sourceFileId: file.id,
          index: unit.index,
          title: unit.title,
          rawText: unit.rawText,
          speakerNotes: unit.speakerNotes,
          tables: unit.tables,
          hasDiagram: unit.imageCount > 0,
          legibilityFlag: classifyLegibility(unit),
        };

        const existingId = existingByIndex.get(unit.index);
        if (existingId) {
          // Update in place: the row ID is a provenance anchor.
          tx.update(sourceSlides)
            .set(values)
            .where(eq(sourceSlides.id, existingId))
            .run();
        } else {
          tx.insert(sourceSlides).values(values).run();
        }
      }

      // A re-ingested file that lost slides leaves orphan rows behind. Remove
      // only the trailing units that no longer exist; cards that referenced
      // them keep their ID and fall back to a null source (ON DELETE SET NULL)
      // rather than being deleted with it.
      const keptIndexes = units.map((u) => u.index);
      if (keptIndexes.length > 0) {
        tx.delete(sourceSlides)
          .where(
            and(
              eq(sourceSlides.sourceFileId, file.id),
              notInArray(sourceSlides.index, keptIndexes),
            ),
          )
          .run();
      }
    });

    // A study guide additionally yields objectives.
    let objectiveCount = 0;
    if (file.role === "study_guide") {
      objectiveCount = syncObjectives(db, file, units);
    }

    db.update(sourceFiles)
      .set({ status: "ready", unitCount: units.length, errorMessage: null })
      .where(eq(sourceFiles.id, file.id))
      .run();

    return {
      sourceFileId: file.id,
      unitCount: units.length,
      objectiveCount,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(sourceFiles)
      .set({ status: "failed", errorMessage: message })
      .where(eq(sourceFiles.id, file.id))
      .run();
    throw error;
  }
}

/**
 * Rewrites the objectives derived from a study guide.
 *
 * Objectives are keyed by their prompt text, so re-ingesting an edited guide
 * keeps the IDs of objectives whose wording did not change — which is what
 * preserves their CoverageMapping rows.
 */
function syncObjectives(
  db: Db,
  file: SourceFile,
  units: { rawText: string; title: string | null }[],
): number {
  const text = units
    .map((u) => [u.title, u.rawText].filter(Boolean).join("\n"))
    .join("\n");
  const parsed = parseStudyGuide(text);

  const existing = db
    .select()
    .from(studyGuideObjectives)
    .where(eq(studyGuideObjectives.sourceFileId, file.id))
    .all();
  const existingByText = new Map(
    existing.map((row) => [row.promptText, row] as const),
  );

  db.transaction((tx) => {
    const keptIds: string[] = [];

    for (const objective of parsed) {
      const match = existingByText.get(objective.promptText);
      if (match) {
        tx.update(studyGuideObjectives)
          .set({ orderIndex: objective.orderIndex, label: objective.label })
          .where(eq(studyGuideObjectives.id, match.id))
          .run();
        keptIds.push(match.id);
      } else {
        const [inserted] = tx
          .insert(studyGuideObjectives)
          .values({
            examId: file.examId,
            sourceFileId: file.id,
            orderIndex: objective.orderIndex,
            label: objective.label,
            promptText: objective.promptText,
          })
          .returning({ id: studyGuideObjectives.id })
          .all();
        keptIds.push(inserted.id);
      }
    }

    // Objectives removed from the guide are dropped; their coverage rows go
    // with them by cascade, but no flashcard is deleted.
    const stale = existing
      .filter((row) => !keptIds.includes(row.id))
      .map((row) => row.id);
    if (stale.length > 0) {
      tx.delete(studyGuideObjectives)
        .where(inArray(studyGuideObjectives.id, stale))
        .run();
    }
  });

  return parsed.length;
}
